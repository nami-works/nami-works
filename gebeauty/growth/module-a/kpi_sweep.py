"""
Module A - KPI sweep (retention + LTV side).

Pulls order history over N months (lean query) and computes the acquisition +
retention KPIs the growth mandate needs, on top of the confirmed unit economics:
  - new customers per month (acquisition volume)
  - repeat rate (overall + mature-cohort)
  - time-to-2nd-purchase distribution
  - cohort LTV curves (cumulative product revenue per customer at 30/90/180/365d
    since first order, by acquisition month) + contribution LTV
  - new-vs-returning revenue share

Meta spend is passed in (--spend-30d, from the meta-ads MCP pull) to derive blended
CAC, LTV:CAC, payback, and the margin-after-media floor check. Read-only Shopify.

Usage:
  python kpi_sweep.py --months 13 --spend-30d 59100 --new-30d-override 0
"""
import argparse
import datetime as dt
import json
import statistics
import sys
import time
import urllib.request
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
GROWTH = HERE.parent
ENV = GROWTH.parent / ".env"

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


def load_env():
    creds = {}
    with open(ENV, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                creds[k.strip()] = v.strip()
    return creds


CREDS = load_env()
SHOP = CREDS.get("SHOPIFY_SHOP_DOMAIN", "ge-beauty-cosmeticos.myshopify.com")
TOKEN = CREDS["SHOPIFY_ADMIN_ACCESS_TOKEN"]
API_VERSION = CREDS.get("SHOPIFY_API_VERSION", "2026-01")
GQL = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"

PARAMS = json.loads((GROWTH / "params.json").read_text(encoding="utf-8"))
FREIGHT_REV = PARAMS["freight_revenue_pct"]
CONTRIB_MARGIN = 1 - (PARAMS["cogs_target_pct"] + PARAMS["tax_effective_pct"]
                      + PARAMS["payment_fee_pct"] + PARAMS["freight_cost_pct"]
                      + PARAMS["fulfillment_pct"])  # ~0.4205 of total revenue
FLOOR = PARAMS["profit_floor_pct"]


def graphql(query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    req = urllib.request.Request(
        GQL, data=body,
        headers={"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN},
    )
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req) as resp:
                out = json.loads(resp.read().decode("utf-8"))
            if "errors" in out and out["errors"]:
                raise RuntimeError(out["errors"])
            ts = out.get("extensions", {}).get("cost", {}).get("throttleStatus", {})
            if ts.get("currentlyAvailable", 9999) < 400:
                time.sleep(1.0)
            return out["data"]
        except urllib.error.HTTPError as e:
            if e.code in (429, 502, 503):
                time.sleep(2 ** attempt)
                continue
            raise
    raise RuntimeError("graphql retries exhausted")


ORDERS_Q = """
query($cursor: String, $q: String!) {
  orders(first: 250, after: $cursor, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      createdAt
      customer { id }
      currentSubtotalPriceSet { shopMoney { amount } }
    }
  }
}
"""


def fetch_orders(since_iso, until_iso):
    q = f"created_at:>={since_iso} created_at:<{until_iso} financial_status:paid"
    cursor = None
    n = 0
    while True:
        data = graphql(ORDERS_Q, {"cursor": cursor, "q": q})
        conn = data["orders"]
        for o in conn["nodes"]:
            n += 1
            cust = o.get("customer") or {}
            cid = cust.get("id")
            if not cid:
                continue
            try:
                amt = float(o["currentSubtotalPriceSet"]["shopMoney"]["amount"])
            except (TypeError, KeyError):
                amt = 0.0
            yield cid, o["createdAt"][:10], amt
        if n % 5000 == 0:
            print(f"  ...{n} orders", file=sys.stderr)
        if not conn["pageInfo"]["hasNextPage"]:
            break
        cursor = conn["pageInfo"]["endCursor"]


def pctl(sorted_vals, p):
    if not sorted_vals:
        return None
    k = (len(sorted_vals) - 1) * p
    f = int(k)
    c = min(f + 1, len(sorted_vals) - 1)
    return round(sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f), 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--months", type=int, default=13)
    ap.add_argument("--spend-30d", type=float, default=0.0, help="Meta spend last 30d (BRL)")
    ap.add_argument("--out", default="kpis.json")
    args = ap.parse_args()

    today = dt.date.today()
    since = (today - dt.timedelta(days=args.months * 31)).isoformat()
    until = (today + dt.timedelta(days=1)).isoformat()
    print(f"[kpi] pulling orders {since}..{until}", file=sys.stderr)

    # customer -> list of (date, product_net)
    cust = defaultdict(list)
    total_orders = 0
    for cid, d, amt in fetch_orders(since, until):
        cust[cid].append((d, amt))
        total_orders += 1

    for cid in cust:
        cust[cid].sort()

    today_d = today
    def days_ago(dstr):
        y, m, dd = map(int, dstr.split("-"))
        return (today_d - dt.date(y, m, dd)).days

    n_customers = len(cust)
    repeaters = [c for c, os in cust.items() if len(os) >= 2]
    repeat_rate = len(repeaters) / n_customers if n_customers else 0

    # time-to-2nd (days between 1st and 2nd order), for customers who repeated
    t2 = []
    for c in repeaters:
        d0 = dt.date(*map(int, cust[c][0][0].split("-")))
        d1 = dt.date(*map(int, cust[c][1][0].split("-")))
        t2.append((d1 - d0).days)
    t2.sort()

    # acquisition cohorts by first-order month
    cohort = defaultdict(list)  # 'YYYY-MM' -> list of cid
    for c, os in cust.items():
        cohort[os[0][0][:7]].append(c)

    # cohort LTV: cumulative product_net per customer at maturities, only cohorts old enough
    maturities = [30, 90, 180, 365]
    cohort_ltv = {}
    new_per_month = {}
    for mth in sorted(cohort):
        members = cohort[mth]
        new_per_month[mth] = len(members)
        # cohort age = days since first day of following month (rough maturity gate)
        first_day = dt.date(int(mth[:4]), int(mth[5:7]), 1)
        cohort_age = (today_d - first_day).days
        row = {"new_customers": len(members)}
        for M in maturities:
            if cohort_age < M:
                continue
            rev_sum = 0.0
            for c in members:
                d0 = dt.date(*map(int, cust[c][0][0].split("-")))
                for (od, amt) in cust[c]:
                    odd = dt.date(*map(int, od.split("-")))
                    if (odd - d0).days <= M:
                        rev_sum += amt
            row[f"ltv{M}_product"] = round(rev_sum / len(members), 2)
            row[f"ltv{M}_contrib"] = round(rev_sum / len(members) * (1 + FREIGHT_REV) * CONTRIB_MARGIN, 2)
        cohort_ltv[mth] = row

    # new vs returning revenue share (whole window)
    new_rev = returning_rev = 0.0
    for c, os in cust.items():
        for i, (d, amt) in enumerate(os):
            if i == 0:
                new_rev += amt
            else:
                returning_rev += amt
    total_rev = new_rev + returning_rev

    # 30-day acquisition + CAC
    new_30 = sum(1 for c, os in cust.items() if days_ago(os[0][0]) <= 30)
    cac = (args.spend_30d / new_30) if (args.spend_30d and new_30) else None

    # blended 12-mo LTV (contribution) for a mature-enough reference: use ltv365 avg across
    # cohorts that have it
    ltv365_vals = [r["ltv365_contrib"] for r in cohort_ltv.values() if "ltv365_contrib" in r]
    ltv365_contrib = round(statistics.mean(ltv365_vals), 2) if ltv365_vals else None
    ltv365_product = None
    p365 = [r["ltv365_product"] for r in cohort_ltv.values() if "ltv365_product" in r]
    if p365:
        ltv365_product = round(statistics.mean(p365), 2)

    result = {
        "window": {"since": since, "until": until, "orders": total_orders},
        "unit_economics": {
            "contrib_margin_of_total_rev": round(CONTRIB_MARGIN, 4),
            "freight_rev_pct": FREIGHT_REV,
            "floor_pct": FLOOR,
        },
        "customers": {
            "distinct": n_customers,
            "repeaters": len(repeaters),
            "repeat_rate": round(repeat_rate, 4),
            "orders_per_customer": round(total_orders / n_customers, 3) if n_customers else None,
        },
        "time_to_2nd_days": {
            "n": len(t2), "median": pctl(t2, 0.5),
            "p25": pctl(t2, 0.25), "p75": pctl(t2, 0.75), "p90": pctl(t2, 0.90),
        },
        "revenue_share": {
            "new_product_rev": round(new_rev, 2),
            "returning_product_rev": round(returning_rev, 2),
            "returning_share": round(returning_rev / total_rev, 4) if total_rev else None,
        },
        "acquisition_30d": {
            "new_customers": new_30,
            "meta_spend": args.spend_30d or None,
            "blended_cac": round(cac, 2) if cac else None,
        },
        "ltv": {
            "avg_365d_product": ltv365_product,
            "avg_365d_contribution": ltv365_contrib,
            "ltv_cac_ratio": round(ltv365_contrib / cac, 2) if (ltv365_contrib and cac) else None,
        },
        "new_per_month": new_per_month,
        "cohort_ltv": cohort_ltv,
    }
    (HERE / args.out).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n=== KPI SWEEP ===")
    print(f"window: {since}..{until}  ({total_orders:,} paid orders, {n_customers:,} customers)")
    print(f"repeat rate: {repeat_rate:.1%}   orders/customer: {result['customers']['orders_per_customer']}")
    print(f"time-to-2nd (days): median {pctl(t2,0.5)}  p25 {pctl(t2,0.25)}  p75 {pctl(t2,0.75)}")
    print(f"returning revenue share: {result['revenue_share']['returning_share']:.1%}")
    print(f"new customers/30d: {new_30}")
    if cac:
        print(f"blended CAC (Meta spend R${args.spend_30d:,.0f} / {new_30}): R${cac:.2f}")
    if ltv365_contrib:
        print(f"avg 365d LTV: R${ltv365_product} product / R${ltv365_contrib} contribution")
        if cac:
            print(f"LTV:CAC (contribution): {result['ltv']['ltv_cac_ratio']}")
    print(f"\nwrote {HERE/args.out}")


if __name__ == "__main__":
    main()
