"""
Audit retail goals total sales against Shopify's admin "Total sales by channel"
report for 2026-04-01 → 2026-04-15.

Target numbers (from inputs/Total-sales-by-sales-channel_260401-260415.csv):
  - IGLU POS (source_name=206755758081): 336 orders, R$52,868.08 total sales
  - Point of Sale (source_name=pos):      113 orders, R$22,135.04 total sales
  - Combined:                             449 orders, R$75,003.12

For each order, pulls every candidate amount field and computes multiple
"Total sales" formulas so we can identify which one matches the admin report.

Read-only. Paginates through orders with an explicit source_name filter.
"""

import json
import os
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

PAGE_SIZE = 100  # cost-heavy query; keep small


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
        print("[audit] GraphQL errors:", json.dumps(result["errors"], indent=2))
    ext = result.get("extensions", {}).get("cost", {})
    available = ext.get("throttleStatus", {}).get("currentlyAvailable", 4000)
    if available < 300:
        print(f"  [throttle] available={available}, sleeping 2s...")
        time.sleep(2)
    return result


ORDERS_QUERY = """
query AuditOrders($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      sourceName
      cancelledAt
      displayFinancialStatus
      subtotalPriceSet              { shopMoney { amount } }
      currentSubtotalPriceSet       { shopMoney { amount } }
      currentTotalPriceSet          { shopMoney { amount } }
      totalPriceSet                 { shopMoney { amount } }
      currentTotalDiscountsSet      { shopMoney { amount } }
      totalDiscountsSet             { shopMoney { amount } }
      totalShippingPriceSet         { shopMoney { amount } }
      currentTotalTaxSet            { shopMoney { amount } }
      totalTaxSet                   { shopMoney { amount } }
      totalRefundedSet              { shopMoney { amount } }
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


def fetch_all_orders():
    # Diagnostic: fetch ALL orders in the date range (no source filter), then
    # bucket by sourceName so we can inspect what IGLU POS actually uses.
    # Range: Apr 1 through Apr 15 (inclusive), 2026 — matches the CSV export.
    q = "created_at:>=2026-04-01 created_at:<=2026-04-15"
    after = None
    all_rows = []
    page = 0
    while True:
        page += 1
        res = graphql(
            ORDERS_QUERY,
            {"first": PAGE_SIZE, "after": after, "query": q},
        )
        data = res.get("data", {}).get("orders")
        if not data:
            print("[audit] No data returned; aborting.")
            break
        nodes = data.get("nodes", [])
        all_rows.extend(nodes)
        print(f"  page={page} fetched={len(nodes)} total={len(all_rows)}")
        if not data["pageInfo"]["hasNextPage"]:
            break
        after = data["pageInfo"]["endCursor"]
    return all_rows


def summarize(orders, label):
    """Return a dict of candidate totals + count for this order subset."""
    sums = defaultdict(float)
    for o in orders:
        subtotal = num(o, "subtotalPriceSet", "shopMoney", "amount")
        current_subtotal = num(o, "currentSubtotalPriceSet", "shopMoney", "amount")
        current_total = num(o, "currentTotalPriceSet", "shopMoney", "amount")
        total = num(o, "totalPriceSet", "shopMoney", "amount")
        current_disc = num(o, "currentTotalDiscountsSet", "shopMoney", "amount")
        total_disc = num(o, "totalDiscountsSet", "shopMoney", "amount")
        shipping = num(o, "totalShippingPriceSet", "shopMoney", "amount")
        current_tax = num(o, "currentTotalTaxSet", "shopMoney", "amount")
        total_tax = num(o, "totalTaxSet", "shopMoney", "amount")
        refunded = num(o, "totalRefundedSet", "shopMoney", "amount")

        sums["A_currentTotalPrice"] += current_total
        sums["B_totalPrice"] += total
        sums["C_netPlusShippingPlusTax"] += current_subtotal + shipping + current_tax
        sums["D_gross_minus_disc_plus_ship_plus_tax_minus_ref"] += (
            subtotal - total_disc + shipping + total_tax - refunded
        )
        sums["E_currentTotal_minusRefunds"] += current_total - refunded
        sums["F_currentTotal_minusTax"] += current_total - current_tax
        sums["G_subtotal_plus_shipping"] += subtotal + shipping
        sums["H_currentSubtotal_plus_shipping"] += current_subtotal + shipping
        sums["I_max0_currentTotal_minusRefunded"] += max(
            0.0, current_total - refunded
        )

    return {"label": label, "count": len(orders), **sums}


def filter_nonvoided(orders):
    return [
        o
        for o in orders
        if not o.get("cancelledAt")
        and o.get("displayFinancialStatus") != "VOIDED"
    ]


def filter_not_cancelled(orders):
    return [o for o in orders if not o.get("cancelledAt")]


def filter_not_voided(orders):
    return [o for o in orders if o.get("displayFinancialStatus") != "VOIDED"]


def dump_excluded(orders, label):
    """Print the orders that fail either filter so we can see which flag matters."""
    cancelled = [o for o in orders if o.get("cancelledAt")]
    voided = [o for o in orders if o.get("displayFinancialStatus") == "VOIDED"]
    if not cancelled and not voided:
        return
    print(f"\n  [cancelled/voided rows in {label}]")
    for o in cancelled:
        amt = num(o, "currentTotalPriceSet", "shopMoney", "amount")
        refunded = num(o, "totalRefundedSet", "shopMoney", "amount")
        print(
            f"    {o['name']:<10s}  cancelledAt={str(o.get('cancelledAt'))[:19]}"
            f"  finStatus={o.get('displayFinancialStatus'):<18s}"
            f"  currentTotal=R${amt:,.2f}  refunded=R${refunded:,.2f}"
        )
    for o in voided:
        if o.get("cancelledAt"):
            continue  # already printed
        amt = num(o, "currentTotalPriceSet", "shopMoney", "amount")
        refunded = num(o, "totalRefundedSet", "shopMoney", "amount")
        print(
            f"    {o['name']:<10s}  VOIDED-only (no cancelledAt)"
            f"  currentTotal=R${amt:,.2f}  refunded=R${refunded:,.2f}"
        )


TARGETS = {
    "IGLU POS (206755758081)": {"count": 336, "total": 52868.08},
    "Point of Sale (pos)": {"count": 113, "total": 22135.04},
    "Combined": {"count": 449, "total": 75003.12},
}


def match_marker(candidate_value, target_value):
    """OK if exact to the cent, ~ if within 1 BRL, blank otherwise."""
    delta = abs(candidate_value - target_value)
    if delta < 0.005:
        return "OK"
    if delta < 1.0:
        return "~"
    return "  "


def print_report(summaries_by_group):
    candidate_keys = [
        "A_currentTotalPrice",
        "B_totalPrice",
        "C_netPlusShippingPlusTax",
        "D_gross_minus_disc_plus_ship_plus_tax_minus_ref",
        "E_currentTotal_minusRefunds",
        "F_currentTotal_minusTax",
        "G_subtotal_plus_shipping",
        "H_currentSubtotal_plus_shipping",
        "I_max0_currentTotal_minusRefunded",
    ]
    print()
    print("=" * 100)
    print("Retail goals query audit — candidate totals vs Shopify admin report")
    print("=" * 100)
    for group_label, variants in summaries_by_group.items():
        target = TARGETS.get(group_label, {})
        print()
        print(f">> {group_label}")
        print(f"  target:  count={target.get('count')}  total=R${target.get('total'):.2f}")
        for variant_label, s in variants.items():
            count_mark = match_marker(s["count"], target.get("count", -1))
            print(
                f"\n  [{variant_label}]  n={s['count']} {count_mark}"
            )
            for k in candidate_keys:
                val = s[k]
                mark = match_marker(val, target.get("total", -1))
                print(f"    {mark} {k:<50s}  R${val:,.2f}")
    print()
    print("=" * 100)
    print("Legend: OK = exact match (<R$0.005)   ~ = within R$1.00   blank = no match")
    print("=" * 100)


def main():
    print(f"[audit] Fetching orders from {SHOP} for 2026-04-01..2026-04-15...")
    print(f"[audit] Source filter: source_name:pos OR source_name:206755758081")
    orders = fetch_all_orders()
    print(f"[audit] Fetched {len(orders)} orders total.")

    by_source = defaultdict(list)
    for o in orders:
        by_source[o.get("sourceName") or "<null>"].append(o)

    iglu = by_source.get("206755758081", [])
    pos = by_source.get("pos", [])
    combined = iglu + pos

    summaries_by_group = {
        "IGLU POS (206755758081)": {
            "raw (all)": summarize(iglu, "raw"),
            "exclude cancelledAt only": summarize(filter_not_cancelled(iglu), "no-cancel"),
            "exclude VOIDED only": summarize(filter_not_voided(iglu), "no-voided"),
            "exclude both": summarize(filter_nonvoided(iglu), "filtered"),
        },
        "Point of Sale (pos)": {
            "raw (all)": summarize(pos, "raw"),
            "exclude cancelledAt only": summarize(filter_not_cancelled(pos), "no-cancel"),
            "exclude VOIDED only": summarize(filter_not_voided(pos), "no-voided"),
            "exclude both": summarize(filter_nonvoided(pos), "filtered"),
        },
        "Combined": {
            "raw (all)": summarize(combined, "raw"),
            "exclude cancelledAt only": summarize(filter_not_cancelled(combined), "no-cancel"),
            "exclude VOIDED only": summarize(filter_not_voided(combined), "no-voided"),
            "exclude both": summarize(filter_nonvoided(combined), "filtered"),
        },
    }

    dump_excluded(iglu, "IGLU POS")
    dump_excluded(pos, "Point of Sale")

    # Diagnostic: distribution of unexpected source names pulled in.
    print("\n[audit] Source name distribution:")
    for source, rows in sorted(by_source.items(), key=lambda kv: -len(kv[1])):
        print(f"  {source:<30s} {len(rows)}")

    print_report(summaries_by_group)


if __name__ == "__main__":
    main()
