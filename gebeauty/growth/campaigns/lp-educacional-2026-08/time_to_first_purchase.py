#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Measures the distribution of time from first touch to FIRST purchase.

Purpose: replace the 14-day placeholder floor on the r95 engaged-non-converter
audience with a measured p75.

Source: Shopify Order.customerJourneySummary
  customerOrderIndex == 1  -> this order IS that customer's first order
  daysToConversion         -> days from the journey's first visit to the conversion

CAVEAT TO CHECK, NOT ASSUME: Shopify's customer journey has a bounded lookback, so
daysToConversion may be right-censored. The script measures the censoring boundary
empirically (mass piling at the max) and reports it. A censored p75 is not usable as
an audience floor and the script says so rather than quietly returning a number.

Resumable: appends to raw_journeys.jsonl, so run it repeatedly to grow the sample.
  python3 time_to_first_purchase.py --pages 12
  python3 time_to_first_purchase.py --report
"""
import argparse
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ENV = os.path.join(HERE, "..", "..", "..", ".env")
CACHE = os.path.join(HERE, "raw_journeys.jsonl")
STATE = os.path.join(HERE, ".journey_cursor")
PAGE = 100


def env():
    vals = {}
    with open(ENV, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                vals[k.strip()] = v.strip().strip('"').strip("'")
    return vals


E = env()
DOMAIN = E.get("SHOPIFY_SHOP_DOMAIN") or "ge-beauty-cosmeticos.myshopify.com"
TOKEN = E["SHOPIFY_ADMIN_ACCESS_TOKEN"]
VERSION = E.get("SHOPIFY_API_VERSION") or "2026-01"
URL = f"https://{DOMAIN}/admin/api/{VERSION}/graphql.json"

QUERY = """
query($cursor: String) {
  orders(first: %d, after: $cursor, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id
      createdAt
      customerJourneySummary {
        ready
        customerOrderIndex
        daysToConversion
        momentsCount { count }
        firstVisit { occurredAt source referrerUrl }
      }
    } }
  }
}
""" % PAGE


def graphql(cursor=None, tries=4):
    body = json.dumps({"query": QUERY, "variables": {"cursor": cursor}}).encode()
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and attempt < tries - 1:
                time.sleep(2 * (attempt + 1))
                continue
            raise
    raise RuntimeError("exhausted retries")


def fetch(pages):
    cursor = open(STATE).read().strip() or None if os.path.exists(STATE) else None
    seen = set()
    if os.path.exists(CACHE):
        with open(CACHE, encoding="utf-8") as f:
            for line in f:
                try:
                    seen.add(json.loads(line)["id"])
                except Exception:
                    pass
    added = 0
    with open(CACHE, "a", encoding="utf-8") as out:
        for p in range(pages):
            data = graphql(cursor)
            if "errors" in data:
                print("GraphQL errors:", json.dumps(data["errors"])[:600])
                return added
            conn = data["data"]["orders"]
            for e in conn["edges"]:
                n = e["node"]
                if n["id"] in seen:
                    continue
                j = n.get("customerJourneySummary") or {}
                rec = {
                    "id": n["id"],
                    "createdAt": n["createdAt"],
                    "ready": j.get("ready"),
                    "orderIndex": j.get("customerOrderIndex"),
                    "days": j.get("daysToConversion"),
                    "moments": (j.get("momentsCount") or {}).get("count"),
                    "firstVisit": (j.get("firstVisit") or {}).get("occurredAt"),
                    "source": (j.get("firstVisit") or {}).get("source"),
                }
                out.write(json.dumps(rec) + "\n")
                seen.add(n["id"])
                added += 1
            cost = data.get("extensions", {}).get("cost", {})
            avail = cost.get("throttleStatus", {}).get("currentlyAvailable", 9999)
            cursor = conn["pageInfo"]["endCursor"]
            with open(STATE, "w") as s:
                s.write(cursor or "")
            sys.stdout.write(f"\r  page {p+1}/{pages}  total cached {len(seen)}  throttle {avail}   ")
            sys.stdout.flush()
            if not conn["pageInfo"]["hasNextPage"]:
                print("\n  reached end of orders")
                break
            if avail < 300:
                time.sleep(2.0)
    print()
    return added


def pct(sorted_vals, q):
    if not sorted_vals:
        return None
    k = (len(sorted_vals) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


def report():
    rows = []
    with open(CACHE, encoding="utf-8") as f:
        for line in f:
            try:
                rows.append(json.loads(line))
            except Exception:
                pass
    total = len(rows)
    ready = [r for r in rows if r.get("ready")]
    firsts = [r for r in ready if r.get("orderIndex") == 1]
    with_days = [r for r in firsts if r.get("days") is not None]
    days = sorted(float(r["days"]) for r in with_days)

    print("=" * 78)
    print("TIME FROM FIRST TOUCH TO FIRST PURCHASE")
    print("=" * 78)
    print(f"orders scanned                 {total:>8,}")
    print(f"  journey ready                {len(ready):>8,}  ({len(ready)/total:.1%})" if total else "")
    print(f"  first orders (index == 1)     {len(firsts):>8,}")
    print(f"  with daysToConversion         {len(with_days):>8,}")
    if not days:
        print("\nNo usable rows yet. Run with --pages to grow the sample.")
        return
    print(f"\ndate range of orders           {min(r['createdAt'] for r in rows)[:10]} to "
          f"{max(r['createdAt'] for r in rows)[:10]}")
    print("\ndistribution of days to first purchase")
    for q in (0.10, 0.25, 0.50, 0.75, 0.90, 0.95):
        print(f"  p{int(q*100):<3}                        {pct(days, q):>8.1f} days")
    print(f"  mean                         {statistics.mean(days):>8.1f} days")
    print(f"  max                          {max(days):>8.1f} days")

    # same-day share matters: it tells you how much of the base never deliberates
    same_day = sum(1 for d in days if d < 1)
    print(f"\nsame-day conversions           {same_day:>8,}  ({same_day/len(days):.1%})")

    # censoring check: mass piling at the maximum means the lookback is bounded
    mx = max(days)
    at_max = sum(1 for d in days if d >= mx - 0.5)
    near_max = sum(1 for d in days if d >= mx * 0.9)
    print("\ncensoring check")
    print(f"  observed max                 {mx:>8.1f} days")
    print(f"  rows at the max              {at_max:>8,}  ({at_max/len(days):.2%})")
    print(f"  rows within 10% of max       {near_max:>8,}  ({near_max/len(days):.2%})")
    censored = at_max / len(days) > 0.02 or mx in (29.0, 30.0, 31.0)
    print(f"  verdict                      {'RIGHT-CENSORED, p75 not usable as a floor' if censored else 'no obvious censoring'}")

    print("\nhistogram (days, share of first purchases)")
    buckets = [(0, 1, "same day"), (1, 3, "1 to 2"), (3, 7, "3 to 6"), (7, 14, "7 to 13"),
               (14, 30, "14 to 29"), (30, 60, "30 to 59"), (60, 10**6, "60+")]
    for lo, hi, lab in buckets:
        n = sum(1 for d in days if lo <= d < hi)
        bar = "#" * int(round(n / len(days) * 50))
        print(f"  {lab:<10} {n:>6,} {n/len(days):>7.1%} {bar}")

    p75 = pct(days, 0.75)
    print("\n" + "-" * 78)
    print(f"MEASURED p75 = {p75:.1f} days" + ("  (CENSORED, treat as a lower bound)" if censored else ""))
    print("-" * 78)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, default=0)
    ap.add_argument("--report", action="store_true")
    a = ap.parse_args()
    if a.pages:
        n = fetch(a.pages)
        print(f"  added {n} new order records")
    if a.report or not a.pages:
        report()
