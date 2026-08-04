#!/usr/bin/env python3
"""
Offer margin check for the 5 educational-post landing pages (campaign lp-educacional-2026-08).

Uses the ABSOLUTE cost model mandated by gebeauty/growth/params.json:
  total_revenue = product_net + freight_revenue(0 if free-ship)
  contribution  = total_revenue - COGS(units) - per_order_brl - total_revenue*ad_valorem
                  - qualifying_revenue*boniteca
  Floor is checked AFTER media allocation: (contribution - media) / total_revenue >= profit_floor.

Reads params.json + cost-basis.json live. No hardcoded money.
"""
import json
import os

BASE = os.path.join(os.path.dirname(__file__), "..", "..")
P = json.load(open(os.path.join(BASE, "params.json"), encoding="utf-8"))
SKUS = json.load(open(os.path.join(BASE, "cost-basis.json"), encoding="utf-8"))["skus"]

FLOOR = P["profit_floor_pct"]
FREIGHT_REV_PCT = P["freight_revenue_pct"]
FREE_SHIP = P["free_shipping_threshold_brl"]
PO = P["per_order_brl"]
AV = P["ad_valorem_pct"]["tax"] + P["ad_valorem_pct"]["payment_fee"]
BONITECA = P["boniteca"]["resolved_pct"]

# CAC ceiling from brand-context.md (as_of 2026-07, source CGO-TEAM.md prose)
CAC_CEILING = 68.0


def packaging(units):
    t = PO["packaging_tiers_brl"]
    if units <= t["small_max"]:
        return t["small"]
    if units <= t["medium_max"]:
        return t["medium"]
    return t["large"]


def contribution(cart, price_override=None, gwp=(), free_ship=False):
    """cart/gwp = lists of SKU codes. gwp adds COGS + units, adds no revenue."""
    listed = sum(SKUS[s]["retail_brl"] for s in cart)
    product_net = listed if price_override is None else price_override
    units = len(cart) + len(gwp)
    cogs = sum(SKUS[s]["unit_cost_brl"] for s in cart) + sum(SKUS[s]["unit_cost_brl"] for s in gwp)

    # Free shipping is a policy above the threshold; below it freight is billed to the customer.
    bills_freight = (not free_ship) and product_net < FREE_SHIP
    freight_rev = product_net * FREIGHT_REV_PCT if bills_freight else 0.0
    total_rev = product_net + freight_rev

    per_order = PO["freight"] + PO["fulfillment"] + packaging(units)
    ad_val = total_rev * AV
    bon = product_net * BONITECA  # qualifying = cosmetic product revenue, freight excluded

    contrib = total_rev - cogs - per_order - ad_val - bon
    max_media = contrib - FLOOR * total_rev  # media budget that still lands exactly on the floor
    return {
        "listed": listed,
        "product_net": product_net,
        "units": units,
        "cogs": cogs,
        "freight_rev": freight_rev,
        "total_rev": total_rev,
        "per_order": per_order,
        "ad_val": ad_val,
        "boniteca": bon,
        "contribution": contrib,
        "max_media_at_floor": max_media,
        "net_pct_at_ceiling": (contrib - CAC_CEILING) / total_rev,
        "clears_at_ceiling": (contrib - CAC_CEILING) >= FLOOR * total_rev,
        "to_free_ship": max(0.0, FREE_SHIP - product_net),
    }


WASH = ["GEB 001", "GEB 002", "GEB 008"]  # hero trio, the wash routine core

SCENARIOS = {
    # LIVE kits in the primeira-rotina collection (read from the storefront 2026-07-31).
    "LIVE rotina frescor prolongado R$259 (001+002+008)": dict(cart=WASH, price_override=259.00),
    "LIVE rotina protecao termica R$237 (001+002+011)": dict(cart=["GEB 001", "GEB 002", "GEB 011"], price_override=237.00),
    "LIVE rotina R$259 + GWP travel shampoo": dict(cart=WASH, price_override=259.00, gwp=["GEB 013"]),
    "A. rotina completa, full price": dict(cart=WASH),
    "B. rotina + GWP travel leave-in (value-add)": dict(cart=WASH, gwp=["GEB 011"]),
    "C. rotina -15% (kit pricing)": dict(cart=WASH, price_override=round(sum(SKUS[s]["retail_brl"] for s in WASH) * 0.85, 2)),
    "D. rotina -20% (kit pricing)": dict(cart=WASH, price_override=round(sum(SKUS[s]["retail_brl"] for s in WASH) * 0.80, 2)),
    "E. dupla shampoo+mascara, full price": dict(cart=["GEB 001", "GEB 002"]),
    "F. rotina + booster fortificante (hits free-ship)": dict(cart=WASH + ["GEB 019"]),
    "G. shampoo avulso (entry, worst case)": dict(cart=["GEB 001"]),
}

print(f"floor={FLOOR:.0%}  CAC ceiling=R${CAC_CEILING:.0f}  ad-valorem={AV:.2%}  boniteca={BONITECA:.0%}")
print(f"free-ship threshold=R${FREE_SHIP}  per-order freight=R${PO['freight']} (Selia active)")
print("=" * 116)
hdr = f"{'scenario':<44}{'net R$':>9}{'total rev':>11}{'contrib':>10}{'maxCAC':>9}{'net% @68':>10}{'gate':>7}{'→freeship':>11}"
print(hdr)
print("-" * 116)
for name, kw in SCENARIOS.items():
    r = contribution(**kw)
    print(
        f"{name:<44}{r['product_net']:>9.2f}{r['total_rev']:>11.2f}{r['contribution']:>10.2f}"
        f"{r['max_media_at_floor']:>9.2f}{r['net_pct_at_ceiling']:>9.1%}"
        f"{('PASS' if r['clears_at_ceiling'] else 'FAIL'):>7}{r['to_free_ship']:>11.2f}"
    )
print("-" * 116)
print("maxCAC = media spend per order that still lands exactly on the 10% floor.")
print("net% @68 = net margin as % of total revenue if CAC comes in at the R$68 ceiling.")
