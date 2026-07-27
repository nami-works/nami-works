"""
Module A - Attribution & Unit-Economics engine (v0: contribution margin).

Computes, per order over a date window, the real unit economics from the ground up:
  product net sales (post line-discount)  -> the revenue line
  - COGS (per-SKU landed cost, cost-basis.json)
  - payment fees / taxes / shipping subsidy (params.json, FLAGGED assumptions)
  = net contribution (before paid media)

Then aggregates: blended net margin %, new-vs-returning split, distribution vs the
10% net-profit floor, and a by-first-product view. Read-only against Shopify.

This is the trustworthy foundation the growth mandate re-baselines off. Paid-media
allocation (per-channel CAC against this contribution) is a later layer; this file
establishes the margin truth per order first.

Usage:
  python contribution.py --days 30
  python contribution.py --since 2026-06-01 --until 2026-07-01 --out read-jun.json
"""
import argparse
import datetime as dt
import json
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
GROWTH = HERE.parent
REPO = GROWTH.parent.parent
ENV = GROWTH.parent / ".env"  # gebeauty/.env

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

COST = json.loads((GROWTH / "cost-basis.json").read_text(encoding="utf-8"))["skus"]
PARAMS = json.loads((GROWTH / "params.json").read_text(encoding="utf-8"))

# --- Giveaway-campaign exclusion --------------------------------------------
# The "pague so o frete" acquisition campaign gives away a travel-size unit (item
# free, customer pays only shipping). These orders are near-R$0 revenue and distort
# AOV + margin mix, so they are excluded from the baseline read by default.
# Detection is code-independent (catches both the coupon-link and the silent
# auto-apply LP path): a travel-size SKU line billed at ~R$0. Gift codes are a
# backup signal.
TRAVEL_SKUS = {sku for sku, cb in COST.items() if cb.get("size") == "travel"}
GIFT_CODES = {"MINI-GRATIS_2PDR1FZ"}  # travel-size cortesia; extend if more are minted
GIVEAWAY_LINE_EPS = 5.00  # a travel SKU line at/under this R$ = the free unit


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
            cost = out.get("extensions", {}).get("cost", {}).get("throttleStatus", {})
            if cost.get("currentlyAvailable", 9999) < 300:
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
  orders(first: 100, after: $cursor, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      createdAt
      displayFinancialStatus
      discountCodes
      customer { id numberOfOrders }
      currentSubtotalPriceSet { shopMoney { amount } }
      totalDiscountsSet { shopMoney { amount } }
      lineItems(first: 50) {
        nodes {
          quantity
          sku
          discountedTotalSet { shopMoney { amount } }
          product { productType }
        }
      }
    }
  }
}
"""


def money(node, *path):
    cur = node
    for p in path:
        if cur is None:
            return 0.0
        cur = cur.get(p)
    try:
        return float(cur)
    except (TypeError, ValueError):
        return 0.0


def fetch_orders(since_iso, until_iso):
    q = f"created_at:>={since_iso} created_at:<{until_iso} financial_status:paid"
    cursor = None
    while True:
        data = graphql(ORDERS_Q, {"cursor": cursor, "q": q})
        conn = data["orders"]
        for o in conn["nodes"]:
            yield o
        if not conn["pageInfo"]["hasNextPage"]:
            break
        cursor = conn["pageInfo"]["endCursor"]


def _packaging_brl(units, per_order):
    """Tiered shipping-box cost by unit count (placeholder until real BOM)."""
    t = per_order.get("packaging_tiers_brl")
    if not t:
        return float(per_order.get("packaging") or 0.0)
    if units <= t["small_max"]:
        return float(t["small"])
    if units <= t["medium_max"]:
        return float(t["medium"])
    return float(t["large"])


def order_economics(o):
    """Return per-order economics dict, or None if it carries no costed product line."""
    revenue = 0.0   # product net sales (post line-discount), excl. shipping/tax
    raw_cogs = 0.0  # bottom-up per-SKU, pre-calibration
    qualifying_rev = 0.0  # Boniteca base: cosmetic product revenue (realized; free/brinde lines = 0)
    units = 0            # total physical units in the parcel (for packaging tier)
    costed_lines = 0
    first_product = None
    is_giveaway = False
    for li in o["lineItems"]["nodes"]:
        sku = (li.get("sku") or "").strip()
        qty = li.get("quantity", 0)
        line_rev = money(li, "discountedTotalSet", "shopMoney", "amount")
        revenue += line_rev
        units += qty
        if sku in TRAVEL_SKUS and line_rev <= GIVEAWAY_LINE_EPS * max(qty, 1):
            is_giveaway = True  # a travel-size unit billed at ~R$0 = the free cortesia
        cb = COST.get(sku)
        if cb:
            raw_cogs += cb["unit_cost_brl"] * qty
            costed_lines += 1
            if cb.get("boniteca_qualifying", True):
                qualifying_rev += line_rev   # cosmetic lines only; accessories flagged False
            if first_product is None:
                first_product = sku
    if set(o.get("discountCodes") or []) & GIFT_CODES:
        is_giveaway = True
    product_net = revenue  # lineItem discountedTotal, excl freight/tax
    if product_net <= 0:
        return None

    # --- Confirmed unit-economics structure (params.json), % of TOTAL revenue ---
    freight_rev = product_net * PARAMS["freight_revenue_pct"]
    total_rev = product_net + freight_rev

    # ABSOLUTE per-order costs (R$, fixed regardless of discount/GWP)
    cogs = raw_cogs * PARAMS["cogs_calibration_factor"]     # bottom-up per-SKU (factor=1.0)
    per_order = PARAMS["per_order_brl"]
    freight_cost = per_order["freight"]                    # flat avg R$/order (aggregate; campaign tools override exact)
    fulfil = per_order["fulfillment"]
    packaging = _packaging_brl(units, per_order)
    # AD-VALOREM costs (% of the revenue base shown)
    adv = PARAMS["ad_valorem_pct"]
    tax = total_rev * adv["tax"]
    fees = total_rev * adv["payment_fee"]
    boniteca = qualifying_rev * PARAMS["boniteca"]["resolved_pct"]  # % of QUALIFYING (cosmetic) rev, not total

    variable_cost = cogs + freight_cost + fulfil + packaging + tax + fees + boniteca
    contrib = total_rev - variable_cost                    # contribution BEFORE paid media

    cust = o.get("customer") or {}
    n_orders = cust.get("numberOfOrders")
    try:
        n_orders = int(n_orders)
    except (TypeError, ValueError):
        n_orders = None
    is_new = (n_orders == 1) if n_orders is not None else None

    return {
        "id": o["id"].rsplit("/", 1)[-1],
        "created_at": o["createdAt"],
        "product_net": round(product_net, 2),
        "total_rev": round(total_rev, 2),
        "cogs": round(cogs, 2),
        "boniteca": round(boniteca, 2),
        "costed_lines": costed_lines,
        "contrib_before_media": round(contrib, 2),
        "contrib_margin_pct": round(contrib / total_rev, 4),
        "cogs_pct": round(cogs / total_rev, 4),
        "is_new": is_new,
        "first_product": first_product,
        "is_giveaway": is_giveaway,
    }


def summarize(rows):
    def agg(subset):
        n = len(subset)
        if n == 0:
            return None
        prod = sum(r["product_net"] for r in subset)
        rev = sum(r["total_rev"] for r in subset)
        cogs = sum(r["cogs"] for r in subset)
        cb = sum(r["contrib_before_media"] for r in subset)
        return {
            "orders": n,
            "product_net": round(prod, 2),
            "total_revenue": round(rev, 2),
            "product_aov": round(prod / n, 2),
            "total_rev_per_order": round(rev / n, 2),
            "cogs": round(cogs, 2),
            "cogs_pct": round(cogs / rev, 4) if rev else None,
            "contrib_before_media": round(cb, 2),
            "contrib_margin_pct": round(cb / rev, 4) if rev else None,
        }

    out = {"all": agg(rows)}
    new = [r for r in rows if r["is_new"] is True]
    ret = [r for r in rows if r["is_new"] is False]
    unk = [r for r in rows if r["is_new"] is None]
    out["new_customers"] = agg(new)
    out["returning_customers"] = agg(ret)
    out["unknown_newness"] = agg(unk)

    by_first = {}
    for r in rows:
        fp = r["first_product"] or "UNCOSTED"
        by_first.setdefault(fp, []).append(r)
    out["by_first_product"] = {}
    for fp, subset in sorted(by_first.items(), key=lambda kv: -len(kv[1])):
        a = agg(subset)
        cb = COST.get(fp, {})
        a["product_name"] = cb.get("name", fp)
        out["by_first_product"][fp] = a
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--since")
    ap.add_argument("--until")
    ap.add_argument("--out")
    ap.add_argument("--max-orders", type=int, default=0, help="cap for a quick smoke run")
    ap.add_argument("--include-giveaway", action="store_true",
                    help="keep the free travel-size acquisition orders (excluded by default)")
    args = ap.parse_args()

    if args.since:
        since = args.since
        until = args.until or (dt.date.today() + dt.timedelta(days=1)).isoformat()
    else:
        today = dt.date.today()
        since = (today - dt.timedelta(days=args.days)).isoformat()
        until = (today + dt.timedelta(days=1)).isoformat()

    print(f"[module-a] window {since} .. {until}  shop={SHOP}", file=sys.stderr)
    rows, uncosted_rev, total_rev = [], 0.0, 0.0
    n_seen = 0
    giveaway_n, giveaway_rev = 0, 0.0
    for o in fetch_orders(since, until):
        n_seen += 1
        econ = order_economics(o)
        if econ:
            if econ["is_giveaway"] and not args.include_giveaway:
                giveaway_n += 1
                giveaway_rev += econ["product_net"]
                continue
            rows.append(econ)
            if econ["costed_lines"] == 0:
                uncosted_rev += econ["product_net"]
            total_rev += econ["product_net"]
        if args.max_orders and n_seen >= args.max_orders:
            break
        if n_seen % 500 == 0:
            print(f"  ...{n_seen} orders", file=sys.stderr)

    summary = summarize(rows)
    coverage = 1 - (uncosted_rev / total_rev) if total_rev else 0
    result = {
        "window": {"since": since, "until": until},
        "params_status": PARAMS["_meta"]["status"],
        "giveaway_excluded": {"orders": giveaway_n, "revenue": round(giveaway_rev, 2),
                              "included": bool(args.include_giveaway)},
        "cost_coverage_by_revenue": round(coverage, 4),
        "orders_analyzed": len(rows),
        "summary": summary,
    }

    out_path = HERE / (args.out or f"read-{since}_to_{until}.json")
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    a = summary["all"]
    if "PENDING" in PARAMS.get("_meta", {}).get("status", ""):
        print("\n" + "!" * 72)
        print("!! COST MODEL PARTIAL (params.json): fulfillment is picking-only (storage")
        print("!! pending Selia Logistica), packaging/box not yet costed, Boniteca tier is")
        print("!! manual. Contribution is a LOWER-BOUND on cost until these land.")
        print("!" * 72)
    print("\n=== MODULE A - READ (window {}..{}) ===".format(since, until))
    gw_note = "INCLUDED" if args.include_giveaway else "excluded"
    print(f"giveaway (free travel-size acquisition) orders {gw_note}: {giveaway_n} (R${giveaway_rev:,.0f} product rev)")
    print(f"orders analyzed: {a['orders']}   product AOV R${a['product_aov']}   total-rev/order R${a['total_rev_per_order']}   cost coverage {coverage:.1%}")
    print(f"COGS (calibrated):          {a['cogs_pct']:.1%} of total revenue  (target 22%)")
    print(f"CONTRIBUTION before media:  {a['contrib_margin_pct']:.1%}  (R${a['contrib_before_media']:,.0f})")
    for label in ("new_customers", "returning_customers"):
        s = summary[label]
        if s:
            print(f"  {label:22s} n={s['orders']:5d}  total-rev/order R${s['total_rev_per_order']:.0f}  contribution {s['contrib_margin_pct']:.1%}")
    print(f"\nwrote {out_path}")
    print("NOTE: contribution = total_rev - COGS(22%) - tax(12%) - fees(3.95%) - freight(17%) - fulfillment(3%). BEFORE paid media (the 10% floor is a post-media gate -> v1).")


if __name__ == "__main__":
    main()
