"""
Retail sales MTD revenue — Apr 1 → today (2026-04-18), POS orders only.

Mirrors the canonical "Total sales by channel" formula that matched Shopify
admin in audit_retail_goals_totals.py: sum(max(0, currentTotalPrice - totalRefunded))
across non-cancelled / non-voided orders from IGLU POS (206755758081) + Shopify
POS (pos). Read-only.
"""

import json
import time
import urllib.request
from collections import defaultdict
from datetime import date
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

TODAY = date.today()  # 2026-04-18 per system clock
MONTH_START = date(TODAY.year, TODAY.month, 1)
RANGE_START = MONTH_START.isoformat()
RANGE_END = TODAY.isoformat()


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
        print("[mtd] GraphQL errors:", json.dumps(result["errors"], indent=2))
    ext = result.get("extensions", {}).get("cost", {})
    available = ext.get("throttleStatus", {}).get("currentlyAvailable", 4000)
    if available < 300:
        print(f"  [throttle] available={available}, sleeping 2s...")
        time.sleep(2)
    return result


ORDERS_QUERY = """
query MtdRetail($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      sourceName
      cancelledAt
      displayFinancialStatus
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      totalRefundedSet     { shopMoney { amount } }
    }
  }
}
"""


def num(node, *path):
    cur = node
    for key in path:
        if cur is None:
            return 0.0
        cur = cur.get(key)
    return float(cur) if cur is not None else 0.0


def fetch_all():
    q = f"created_at:>={RANGE_START} created_at:<={RANGE_END}"
    after = None
    rows = []
    page = 0
    while True:
        page += 1
        res = graphql(ORDERS_QUERY, {"first": PAGE_SIZE, "after": after, "query": q})
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


def main():
    print(f"[mtd] shop={SHOP}  range={RANGE_START} .. {RANGE_END}")
    orders = fetch_all()
    print(f"[mtd] total orders fetched: {len(orders)}")

    by_source = defaultdict(list)
    for o in orders:
        by_source[o.get("sourceName") or "<null>"].append(o)

    iglu = by_source.get("206755758081", [])
    pos = by_source.get("pos", [])

    def non_cancelled_non_voided(lst):
        return [
            o
            for o in lst
            if not o.get("cancelledAt")
            and o.get("displayFinancialStatus") != "VOIDED"
        ]

    groups = {
        "IGLU POS (206755758081)": non_cancelled_non_voided(iglu),
        "Shopify POS (pos)":       non_cancelled_non_voided(pos),
    }

    print()
    print("=" * 72)
    print(f"Retail Sales — Month-to-Date  ({RANGE_START} .. {RANGE_END})")
    print("=" * 72)
    grand_count = 0
    grand_total = 0.0
    currency = "BRL"
    for label, group in groups.items():
        count = len(group)
        total = 0.0
        for o in group:
            ct = num(o, "currentTotalPriceSet", "shopMoney", "amount")
            ref = num(o, "totalRefundedSet", "shopMoney", "amount")
            total += max(0.0, ct - ref)
            cur = (
                o.get("currentTotalPriceSet", {})
                .get("shopMoney", {})
                .get("currencyCode")
            )
            if cur:
                currency = cur
        grand_count += count
        grand_total += total
        print(f"  {label:<28s}  orders={count:>4d}   revenue={currency} {total:>12,.2f}")
    print("-" * 72)
    print(f"  {'COMBINED (Retail MTD)':<28s}  orders={grand_count:>4d}   revenue={currency} {grand_total:>12,.2f}")
    print("=" * 72)

    print("\n[mtd] source name distribution (diagnostic):")
    for source, rows in sorted(by_source.items(), key=lambda kv: -len(kv[1])):
        print(f"  {source:<30s} {len(rows)}")


if __name__ == "__main__":
    main()
