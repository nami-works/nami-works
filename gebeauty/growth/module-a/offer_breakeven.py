"""Campaign / offer breakeven tool — the CGO's standard pre-launch gate.

Given an offer (products + prices/discounts + gifts + shipping mode), returns the
full contribution breakdown, the breakeven price floor, and the CAC ceilings, on
Module A's ABSOLUTE + AD-VALOREM cost model (params.json + cost-basis.json):

  ABSOLUTE per-order R$ (fixed under discount/GWP): COGS (per unit), freight,
                                                    fulfillment, packaging
  AD-VALOREM % of revenue (scale with price):       tax, payment, Boniteca(qualifying)

Reusable across the repo:
    from offer_breakeven import evaluate_offer
    r = evaluate_offer({"lines": [...], "shipping": "free"})

CLI:
    python offer_breakeven.py --example
    python offer_breakeven.py --offer path/to/offer.json

Offer schema (JSON):
{
  "name": "New-customer shampoo GWP",
  "lines": [
    {"sku": "GEB 001", "qty": 1, "price": 95.0},   # paid line: unit price customer pays
    {"sku": "GEB 001", "qty": 1, "discount_pct": 0.5},   # OR discount off retail
    {"sku": "GEB 002", "qty": 1, "gift": true},    # GWP: price 0, COGS counts, excluded from Boniteca
    {"sku": "GEB 011", "qty": 1, "gift": true}
  ],
  "shipping": "free",         # "free" (GE absorbs) | "passthrough" (customer pays exact, net 0)
                              #  | {"customer_charge": 19.9} (customer pays flat, GE eats the gap)
  "freight": {"mode": "exact", "cep": "01310-000"}   # exact weight x zone; or {"mode":"avg"} (default)
}
"""
import argparse
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
GROWTH = HERE.parent
REPO = GROWTH.parent.parent
PARAMS = json.loads((GROWTH / "params.json").read_text(encoding="utf-8"))
COST = json.loads((GROWTH / "cost-basis.json").read_text(encoding="utf-8"))["skus"]

# freight engine (gebeauty/scripts/_unilog_freight.py) — optional, only for exact mode
sys.path.insert(0, str(REPO / "gebeauty" / "scripts"))
try:
    import _unilog_freight as _uf
    _FREIGHT_OK = True
except Exception:
    _FREIGHT_OK = False


def _line_price(ln):
    """Resolve unit price a customer pays for a line."""
    if ln.get("gift"):
        return 0.0
    if "price" in ln:
        return float(ln["price"])
    cb = COST.get(ln["sku"], {})
    retail = float(cb.get("retail_brl", 0.0))
    if "discount_pct" in ln:
        return retail * (1.0 - float(ln["discount_pct"]))
    return retail  # full price default


def _exact_freight(lines, freight_cfg):
    """Exact Unilog freight for the parcel; returns (R$, note) or (None, reason)."""
    if not _FREIGHT_OK:
        return None, "freight engine unavailable (Unilog workbook not loadable)"
    weight_g, missing = 0.0, []
    nf_value = 0.0
    for ln in lines:
        cb = COST.get(ln["sku"], {})
        qty = ln.get("qty", 1)
        w = cb.get("weight_g")
        if w is None:
            missing.append(ln["sku"])
        else:
            weight_g += w * qty
        nf_value += float(cb.get("retail_brl", 0.0)) * qty   # declared goods value for GRIS/AdVal
    if missing:
        return None, f"missing weight_g for {missing} — fell back to avg"
    matrix, idx = _uf.load()
    cep = freight_cfg.get("cep")
    if not cep:
        return None, "exact mode needs a destination cep — fell back to avg"
    fr = _uf.freight(matrix, idx, cep, weight_g / 1000.0, nf_value)
    if not fr:
        return None, f"cep {cep} not costable — fell back to avg"
    return fr["total"], f"exact: {weight_g:.0f} g to {fr['zone']}"


def evaluate_offer(offer):
    lines = offer["lines"]
    adv = PARAMS["ad_valorem_pct"]
    per_order = PARAMS["per_order_brl"]
    bon_pct = PARAMS["boniteca"]["resolved_pct"]

    # --- revenue + COGS + qualifying base ---
    product_rev = 0.0
    qualifying_rev = 0.0
    cogs = 0.0
    line_detail = []
    for ln in lines:
        sku = ln["sku"]
        qty = ln.get("qty", 1)
        cb = COST.get(sku)
        price = _line_price(ln)
        rev = price * qty
        product_rev += rev
        unit_cost = float(cb["unit_cost_brl"]) if cb else 0.0
        cogs += unit_cost * qty
        # Boniteca base: cosmetic, paid (not gift/brinde), qualifying flag
        qualifies = bool(cb) and cb.get("boniteca_qualifying", True) and not ln.get("gift")
        if qualifies:
            qualifying_rev += rev
        line_detail.append({
            "sku": sku, "name": (cb or {}).get("name", sku), "qty": qty,
            "unit_price": round(price, 2), "revenue": round(rev, 2),
            "cogs": round(unit_cost * qty, 2), "gift": bool(ln.get("gift")),
            "unknown_sku": cb is None,
        })

    # --- freight (absolute) + who pays ---
    freight_cfg = offer.get("freight", {"mode": "avg"})
    freight_note = "avg (per_order_brl.freight)"
    freight = float(per_order["freight"])
    if freight_cfg.get("mode") == "exact":
        val, note = _exact_freight(lines, freight_cfg)
        freight_note = note
        if val is not None:
            freight = val

    fulfillment = float(per_order["fulfillment"])
    total_units = sum(ln.get("qty", 1) for ln in lines)
    _pt = per_order.get("packaging_tiers_brl")
    if _pt:
        packaging = float(_pt["small"] if total_units <= _pt["small_max"]
                          else _pt["medium"] if total_units <= _pt["medium_max"]
                          else _pt["large"])
    else:
        packaging = float(per_order.get("packaging") or 0.0)

    # shipping mode -> freight_revenue (what the customer reimburses)
    shipping = offer.get("shipping", "free")
    if shipping == "free":
        freight_rev, ship_note = 0.0, "free (GE absorbs freight)"
    elif shipping == "passthrough":
        freight_rev, ship_note = freight, "pass-through (customer pays exact freight)"
    elif isinstance(shipping, dict) and "customer_charge" in shipping:
        freight_rev = float(shipping["customer_charge"])
        ship_note = f"customer pays flat R${freight_rev:.2f}; GE eats the gap"
    else:
        freight_rev, ship_note = 0.0, "free (GE absorbs freight)"

    total_rev = product_rev + freight_rev

    # --- ad-valorem ---
    tax = total_rev * adv["tax"]
    payment = total_rev * adv["payment_fee"]
    boniteca = qualifying_rev * bon_pct

    absolute = cogs + freight + fulfillment + packaging
    advalorem = tax + payment + boniteca
    contrib = total_rev - absolute - advalorem

    # --- breakeven price floor: scale the PAID lines by k until contrib == 0 ---
    def contrib_at(scale):
        prod = 0.0; qual = 0.0
        for ld in line_detail:
            if ld["gift"]:
                continue
            r = ld["revenue"] * scale
            prod += r
            cb = COST.get(ld["sku"])
            if cb and cb.get("boniteca_qualifying", True):
                qual += r
        frev = {"free": 0.0, "passthrough": freight}.get(shipping, freight_rev) \
            if not isinstance(shipping, dict) else freight_rev
        trev = prod + frev
        return trev - (cogs + freight + fulfillment + packaging) - trev * (adv["tax"] + adv["payment_fee"]) - qual * bon_pct

    lo, hi = 0.0, 20.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if contrib_at(mid) < 0:
            lo = mid
        else:
            hi = mid
    be_scale = (lo + hi) / 2
    floor_mult = be_scale if contrib < 0 else None  # only meaningful if currently underwater

    floor_pct = PARAMS["profit_floor_pct"]
    result = {
        "name": offer.get("name", "offer"),
        "lines": line_detail,
        "shipping": ship_note,
        "freight_basis": freight_note,
        "revenue": {"product": round(product_rev, 2), "freight_billed": round(freight_rev, 2),
                    "total": round(total_rev, 2), "qualifying_for_boniteca": round(qualifying_rev, 2)},
        "costs_absolute_brl": {"cogs": round(cogs, 2), "freight": round(freight, 2),
                               "fulfillment": round(fulfillment, 2), "packaging": round(packaging, 2),
                               "subtotal": round(absolute, 2)},
        "costs_ad_valorem_brl": {"tax": round(tax, 2), "payment": round(payment, 2),
                                 "boniteca": round(boniteca, 2), "subtotal": round(advalorem, 2)},
        "contribution_pre_media_brl": round(contrib, 2),
        "contribution_margin_pct": round(contrib / total_rev, 4) if total_rev else None,
        "cac_ceiling_breakeven_brl": round(max(contrib, 0.0), 2),
        "cac_ceiling_at_floor_brl": round(max(contrib - floor_pct * total_rev, 0.0), 2),
        "meets_floor_pre_media": contrib >= floor_pct * total_rev,
        "breakeven_price_multiplier": round(floor_mult, 3) if floor_mult else None,
        "rough_assumptions": (["packaging (placeholder R$3/5/6.5 by units)",
                               "fulfillment storage (~R$2.10 rough)"]
                              + (["boniteca tier (manual, not yet projected)"]
                                 if PARAMS["boniteca"]["resolved_mode"].startswith("manual") else [])),
    }
    return result


def _fmt(r):
    L = []
    L.append(f"=== OFFER BREAKEVEN — {r['name']} ===")
    L.append(f"shipping: {r['shipping']}  |  freight: {r['freight_basis']}")
    L.append("lines:")
    for ld in r["lines"]:
        g = " [GIFT]" if ld["gift"] else ""
        u = " [UNKNOWN SKU]" if ld["unknown_sku"] else ""
        L.append(f"  {ld['sku']:<9} x{ld['qty']}  price R${ld['unit_price']:.2f}  "
                 f"rev R${ld['revenue']:.2f}  cogs R${ld['cogs']:.2f}{g}{u}")
    rv = r["revenue"]; ca = r["costs_absolute_brl"]; cv = r["costs_ad_valorem_brl"]
    L.append(f"revenue: product R${rv['product']:.2f} + freight R${rv['freight_billed']:.2f} "
             f"= R${rv['total']:.2f}  (Boniteca base R${rv['qualifying_for_boniteca']:.2f})")
    L.append(f"absolute:  COGS {ca['cogs']:.2f} | freight {ca['freight']:.2f} | "
             f"fulfil {ca['fulfillment']:.2f} | box {ca['packaging']:.2f}  = R${ca['subtotal']:.2f}")
    L.append(f"ad-valorem: tax {cv['tax']:.2f} | pay {cv['payment']:.2f} | "
             f"boniteca {cv['boniteca']:.2f}  = R${cv['subtotal']:.2f}")
    c = r["contribution_pre_media_brl"]; m = r["contribution_margin_pct"]
    L.append(f">> CONTRIBUTION (pre-media): R${c:+.2f}  ({100*m:+.1f}%)" if m is not None
             else f">> CONTRIBUTION: R${c:+.2f}")
    L.append(f"   CAC ceiling (breakeven): R${r['cac_ceiling_breakeven_brl']:.2f}  |  "
             f"at 10% floor: R${r['cac_ceiling_at_floor_brl']:.2f}")
    if r["breakeven_price_multiplier"]:
        L.append(f"   underwater — paid prices must x{r['breakeven_price_multiplier']} to break even")
    if r["rough_assumptions"]:
        L.append(f"   rough assumptions: {', '.join(r['rough_assumptions'])}")
    return "\n".join(L)


EXAMPLE = {
    "name": "New-customer: shampoo + free máscara + free travel leave-in",
    "lines": [
        {"sku": "GEB 001", "qty": 1, "price": 95.0},
        {"sku": "GEB 002", "qty": 1, "gift": True},
        {"sku": "GEB 011", "qty": 1, "gift": True},
    ],
    "shipping": "free",
    "freight": {"mode": "exact", "cep": "01310-000"},
}


def main():
    ap = argparse.ArgumentParser(description="Campaign/offer breakeven (CGO gate)")
    ap.add_argument("--offer", help="path to offer JSON")
    ap.add_argument("--example", action="store_true", help="run the built-in shampoo-GWP example")
    ap.add_argument("--json", action="store_true", help="emit raw JSON result")
    a = ap.parse_args()
    if a.example:
        offer = EXAMPLE
    elif a.offer:
        offer = json.loads(Path(a.offer).read_text(encoding="utf-8"))
    else:
        ap.error("pass --example or --offer <path>")
    r = evaluate_offer(offer)
    print(json.dumps(r, ensure_ascii=False, indent=2) if a.json else _fmt(r))


if __name__ == "__main__":
    main()
