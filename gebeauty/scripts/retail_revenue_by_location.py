"""
Retail sales — per-location breakdown for an arbitrary date range.

Usage:
  python retail_revenue_by_location.py --start=YYYY-MM-DD --end=YYYY-MM-DD

Applies the same source+location resolution as app/sales-goals/classification.ts:
  - Shopify POS (sourceName=pos)          -> physicalLocation.id = retail location
  - IGLU POS    (sourceName=206755758081) -> match retail location name in tags
  - Web / other                            -> excluded
Excludes cancelled / VOIDED. Revenue = sum(max(0, currentTotalPrice - totalRefunded)).
"""

import argparse
import json
import time
import urllib.request
from collections import defaultdict
from pathlib import Path


def load_env():
    env_path = Path(__file__).resolve().parent.parent / ".env"
    env = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


ENV = load_env()
SHOP = ENV["SHOPIFY_SHOP_DOMAIN"]
TOKEN = ENV["SHOPIFY_ADMIN_ACCESS_TOKEN"]
API_VERSION = ENV.get("SHOPIFY_API_VERSION", "2026-01")
URL = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"

PAGE_SIZE = 100
IGLU_APP_SOURCE = "206755758081"


def graphql(query, variables=None):
    body = {"query": query}
    if variables:
        body["variables"] = variables
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        URL,
        data=data,
        headers={
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": TOKEN,
        },
    )
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read().decode("utf-8"))
    if "errors" in result:
        print("[by-loc] GraphQL errors:", json.dumps(result["errors"], indent=2))
    ext = result.get("extensions", {}).get("cost", {})
    available = ext.get("throttleStatus", {}).get("currentlyAvailable", 4000)
    if available < 300:
        print(f"  [throttle] available={available}, sleeping 2s...")
        time.sleep(2)
    return result


LOCATIONS_QUERY = """
query RetailLocations {
  locations(first: 50) {
    nodes {
      id
      name
      isActive
      isFulfillmentService
      fulfillmentService { id }
    }
  }
}
"""

ORDERS_QUERY = """
query OrdersByLocation($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      sourceName
      cancelledAt
      displayFinancialStatus
      tags
      physicalLocation { id name }
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      totalRefundedSet     { shopMoney { amount } }
    }
  }
}
"""


def fetch_retail_locations():
    res = graphql(LOCATIONS_QUERY)
    raw = res.get("data", {}).get("locations", {}).get("nodes", [])
    return [
        {"id": n["id"], "name": n["name"]}
        for n in raw
        if n.get("isActive") is not False
        and n.get("isFulfillmentService") is not True
        and not n.get("fulfillmentService")
    ]


def fetch_orders(start, end):
    q = f"created_at:>={start} created_at:<={end}"
    after = None
    rows = []
    page = 0
    while True:
        page += 1
        res = graphql(
            ORDERS_QUERY, {"first": PAGE_SIZE, "after": after, "query": q}
        )
        data = res.get("data", {}).get("orders")
        if not data:
            break
        nodes = data.get("nodes", [])
        rows.extend(nodes)
        print(f"  page={page} fetched={len(nodes)} running={len(rows)}")
        if not data["pageInfo"]["hasNextPage"]:
            break
        after = data["pageInfo"]["endCursor"]
    return rows


def num(node, *path):
    cur = node
    for key in path:
        if cur is None:
            return 0.0
        cur = cur.get(key)
    return float(cur) if cur is not None else 0.0


def classify_source(source_name):
    if source_name == "pos":
        return "shopify-pos"
    if source_name == IGLU_APP_SOURCE:
        return "iglu-pos"
    return None


def resolve_location(order, retail_locations):
    source = classify_source(order.get("sourceName"))
    if not source:
        return None

    if source == "shopify-pos":
        pl = order.get("physicalLocation") or {}
        match = next(
            (loc for loc in retail_locations if loc["id"] == pl.get("id")), None
        )
        if not match:
            return None
        return {"locationId": match["id"], "locationName": match["name"], "source": source}

    # iglu-pos — match tag to location name
    tags_lower = [str(t).lower() for t in (order.get("tags") or [])]
    match = next(
        (loc for loc in retail_locations if loc["name"].lower() in tags_lower),
        None,
    )
    if not match:
        return None
    return {"locationId": match["id"], "locationName": match["name"], "source": source}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", required=True)
    ap.add_argument("--end", required=True)
    args = ap.parse_args()

    print(f"[by-loc] shop={SHOP}  range={args.start} .. {args.end}")
    retail_locations = fetch_retail_locations()
    print(f"[by-loc] active retail locations: {len(retail_locations)}")

    orders = fetch_orders(args.start, args.end)
    print(f"[by-loc] total orders fetched: {len(orders)}")

    per_location_orders = defaultdict(int)
    per_location_revenue = defaultdict(float)
    per_location_source = {}
    currency = "BRL"
    unmatched_pos = 0
    unmatched_iglu = 0
    excluded_cancelled_voided = 0

    for o in orders:
        if o.get("cancelledAt") or o.get("displayFinancialStatus") == "VOIDED":
            excluded_cancelled_voided += 1
            continue
        resolved = resolve_location(o, retail_locations)
        if not resolved:
            src = classify_source(o.get("sourceName"))
            if src == "shopify-pos":
                unmatched_pos += 1
            elif src == "iglu-pos":
                unmatched_iglu += 1
            continue
        ct = num(o, "currentTotalPriceSet", "shopMoney", "amount")
        ref = num(o, "totalRefundedSet", "shopMoney", "amount")
        per_location_orders[resolved["locationName"]] += 1
        per_location_revenue[resolved["locationName"]] += max(0.0, ct - ref)
        per_location_source[resolved["locationName"]] = resolved["source"]
        cur = (
            o.get("currentTotalPriceSet", {})
            .get("shopMoney", {})
            .get("currencyCode")
        )
        if cur:
            currency = cur

    print()
    print("=" * 78)
    print(f"Retail Sales by Location  ({args.start} .. {args.end})")
    print("=" * 78)
    print(f"  {'Location':<30s}  {'Channel':<14s}  {'Orders':>7s}   {'Revenue':>14s}")
    print("-" * 78)
    rows = sorted(
        per_location_revenue.items(), key=lambda kv: -kv[1]
    )
    grand_orders = 0
    grand_revenue = 0.0
    for name, revenue in rows:
        orders_count = per_location_orders[name]
        source = per_location_source[name]
        channel = "Shopify POS" if source == "shopify-pos" else "IGLU POS"
        grand_orders += orders_count
        grand_revenue += revenue
        print(
            f"  {name:<30s}  {channel:<14s}  {orders_count:>7d}   {currency} {revenue:>11,.2f}"
        )
    print("-" * 78)
    print(
        f"  {'TOTAL':<30s}  {'':<14s}  {grand_orders:>7d}   {currency} {grand_revenue:>11,.2f}"
    )
    print("=" * 78)
    print()
    print(
        f"[by-loc] excluded: cancelled/voided={excluded_cancelled_voided} "
        f"unmatched_pos={unmatched_pos} unmatched_iglu_by_tag={unmatched_iglu}"
    )


if __name__ == "__main__":
    main()
