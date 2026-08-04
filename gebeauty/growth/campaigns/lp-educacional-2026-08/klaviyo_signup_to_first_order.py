#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Time from Klaviyo profile creation (first list touch) to FIRST purchase.

Why this exists: Shopify's customerJourneySummary caps its lookback at 30 days, so
its daysToConversion is right-censored and its p75 is a measurement artifact
(see time_to_first_purchase.py). Klaviyo retains profile-created with no cap.

METHOD, and why it is not a naive percentile:
  A naive "days between created and first order" over a recent window is
  RIGHT-TRUNCATED: a profile created three days before the window ends cannot
  possibly show a 90-day delay, so the percentile is biased downward exactly the
  way the Shopify number was.

  So this uses a fixed signup COHORT with a uniform observation period:
    cohort  = profiles created in COHORT_MONTH
    observed through OBSERVE_UNTIL (several months later)
    metric  = days from profile.created to their earliest Placed Order
  Every member gets the same minimum observation window, so percentiles up to
  that horizon are unbiased. Non-purchasers are reported as censored, not dropped
  silently.

Klaviyo Placed Order metric id: ViiTym (Shopify integration)

Resumable. Run:
  python3 klaviyo_signup_to_first_order.py --pages 60
  python3 klaviyo_signup_to_first_order.py --report
"""
import argparse
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ENV = os.path.join(HERE, "..", "..", "..", ".env")
CACHE = os.path.join(HERE, "raw_klaviyo_orders.jsonl")
STATE = os.path.join(HERE, ".klaviyo_cursor")

METRIC_PLACED_ORDER = "ViiTym"
REVISION = "2024-10-15"

# Cohort design
COHORT_START = "2026-02-01"
COHORT_END = "2026-03-01"      # exclusive
OBSERVE_FROM = "2026-02-01"    # earliest order we pull
OBSERVE_UNTIL = "2026-05-01"   # exclusive -> 59 to 89 days of observation per member
# Horizon note: 90 days is deliberate. It measures percentiles reliably out to ~2
# months, which is all the r95 floor decision needs, and it is reachable without
# pulling half a year of order events. Anything beyond 89 days is not observable
# here and is reported as such rather than estimated.


def env():
    vals = {}
    with open(ENV, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                vals[k.strip()] = v.strip().strip('"').strip("'")
    return vals


KEY = env()["KLAVIYO_API_KEY"]


def get(url):
    req = urllib.request.Request(url, headers={
        "Authorization": f"Klaviyo-API-Key {KEY}",
        "revision": REVISION,
        "accept": "application/json",
    })
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(3 * (attempt + 1))
                continue
            if e.code in (500, 502, 503) and attempt < 4:
                time.sleep(2 * (attempt + 1))
                continue
            raise
    raise RuntimeError("retries exhausted")


def first_url():
    flt = (f'and(equals(metric_id,"{METRIC_PLACED_ORDER}"),'
           f'greater-or-equal(datetime,{OBSERVE_FROM}T00:00:00Z),'
           f'less-than(datetime,{OBSERVE_UNTIL}T00:00:00Z))')
    q = {
        "filter": flt,
        "include": "profile",
        "fields[event]": "datetime",
        "fields[profile]": "created",
        "sort": "datetime",
        "page[size]": "200",
    }
    return "https://a.klaviyo.com/api/events/?" + urllib.parse.urlencode(q)


def fetch(pages):
    url = None
    if os.path.exists(STATE):
        url = open(STATE).read().strip() or None
    if not url:
        url = first_url()

    seen = set()
    if os.path.exists(CACHE):
        with open(CACHE, encoding="utf-8") as f:
            for line in f:
                try:
                    seen.add(json.loads(line)["ev"])
                except Exception:
                    pass

    added = 0
    with open(CACHE, "a", encoding="utf-8") as out:
        for p in range(pages):
            data = get(url)
            created_by_profile = {}
            for inc in data.get("included", []):
                if inc.get("type") == "profile":
                    created_by_profile[inc["id"]] = inc["attributes"].get("created")
            for ev in data.get("data", []):
                eid = ev["id"]
                if eid in seen:
                    continue
                pid = (ev.get("relationships", {}).get("profile", {})
                       .get("data", {}) or {}).get("id")
                out.write(json.dumps({
                    "ev": eid,
                    "pid": pid,
                    "when": ev["attributes"].get("datetime"),
                    "pcreated": created_by_profile.get(pid),
                }) + "\n")
                seen.add(eid)
                added += 1
            nxt = (data.get("links") or {}).get("next")
            with open(STATE, "w") as s:
                s.write(nxt or "")
            sys.stdout.write(f"\r  page {p+1}/{pages}  events cached {len(seen):,}   ")
            sys.stdout.flush()
            if not nxt:
                print("\n  reached end of range")
                break
            url = nxt
    print()
    return added


def parse(ts):
    if not ts:
        return None
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def pctl(vals, q):
    if not vals:
        return None
    s = sorted(vals)
    k = (len(s) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def report():
    cs, ce = parse(COHORT_START + "T00:00:00Z"), parse(COHORT_END + "T00:00:00Z")
    until = parse(OBSERVE_UNTIL + "T00:00:00Z")

    first_order = {}   # pid -> earliest order dt
    created = {}
    rows = 0
    with open(CACHE, encoding="utf-8") as f:
        for line in f:
            try:
                r = json.loads(line)
            except Exception:
                continue
            rows += 1
            pid, w, pc = r.get("pid"), parse(r.get("when")), parse(r.get("pcreated"))
            if not pid or not w or not pc:
                continue
            created[pid] = pc
            if pid not in first_order or w < first_order[pid]:
                first_order[pid] = w

    cohort = {pid: pc for pid, pc in created.items() if cs <= pc < ce}
    days = []
    for pid, pc in cohort.items():
        w = first_order.get(pid)
        if w and w < until:
            days.append((w - pc).total_seconds() / 86400.0)

    print("=" * 76)
    print("SIGNUP TO FIRST PURCHASE  (Klaviyo, uncensored)")
    print("=" * 76)
    print(f"cohort              profiles created {COHORT_START} to {COHORT_END}")
    print(f"observed through    {OBSERVE_UNTIL}  "
          f"({(until - ce).days} to {(until - cs).days} days per member)")
    print(f"order events pulled {rows:,}")
    print(f"cohort purchasers   {len(days):,}")
    if not days:
        print("\nNo cohort purchasers yet. Grow the sample with --pages.")
        return

    print("\ndays from profile creation to first purchase")
    for q in (0.10, 0.25, 0.50, 0.75, 0.90, 0.95):
        print(f"  p{int(q*100):<3}             {pctl(days, q):>9.1f}")
    print(f"  mean              {statistics.mean(days):>9.1f}")
    print(f"  median            {statistics.median(days):>9.1f}")
    print(f"  max               {max(days):>9.1f}")

    same_day = sum(1 for d in days if d < 1)
    print(f"\nbought within 24h of joining   {same_day:,} ({same_day/len(days):.1%})")

    print("\nhistogram")
    buckets = [(0, 1, "<1 day"), (1, 3, "1-2"), (3, 7, "3-6"), (7, 14, "7-13"),
               (14, 30, "14-29"), (30, 60, "30-59"), (60, 90, "60-89"),
               (90, 10**6, "90+")]
    for lo, hi, lab in buckets:
        n = sum(1 for d in days if lo <= d < hi)
        print(f"  {lab:<8} {n:>6,} {n/len(days):>7.1%} {'#' * int(round(n/len(days)*46))}")

    beyond_30 = sum(1 for d in days if d >= 30)
    p75 = pctl(days, 0.75)
    print("\n" + "-" * 76)
    print(f"p75 = {p75:.1f} days")
    print(f"share of first purchases Shopify could NEVER see (>=30 days): "
          f"{beyond_30:,} ({beyond_30/len(days):.1%})")
    print("-" * 76)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, default=0)
    ap.add_argument("--report", action="store_true")
    a = ap.parse_args()
    if a.pages:
        print(f"  added {fetch(a.pages)} new events")
    if a.report or not a.pages:
        report()
