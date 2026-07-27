"""
Module A - PAST-MECHANIC REPEAT INSIGHT (D12).

Do value-add (gift / free-travel) acquisition redeemers repeat more than discount
(%-off) redeemers, in OUR data? Reuses orders_raw.jsonl.

Control for first-vs-returning: we classify each customer's FIRST order's acquisition
mechanic and measure whether they placed a 2nd order (repeat). Universe = mature
full-history customers (first order >=90d ago) so everyone had time to repeat.

First-order mechanic classes (by order.discountCodes + giveaway detection):
  value_add_giveaway : free travel-size unit (gift code MINI-GRATIS or travel line <=R$5)
  value_add_gift_code: code names a gift/kit/GWP mechanic (MONTE/KIT/GANHE/PLUMA+/GRUPINHO/PRESENTE/NECESSAIRE)
  discount_firstbuy  : PRIMEIRACOMPRA* (canonical first-purchase %-off)
  discount_other     : any other %-off / R$-off code
  organic_fullprice  : no code, not a giveaway

IMPORTANT CONFOUND (stated plainly): Shopify order.discountCodes captures only
CODE-entered discounts. Most historical GWPs (compre e ganhe, COMPRE-GANHE-SET24, WE
LOVE BOOSTER, ganhe necessaire) were AUTOMATIC discounts and carry no code, so they are
invisible here. The clean, fully-detectable value-add signal is the free-travel
giveaway; the gift-code class is partial. Per-campaign GWP redemption counts come from
discounts.out.json (asyncUsageCount), reported separately.

Usage: python mechanic_repeat.py
"""
import datetime as dt, json, re, sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
GROWTH = HERE.parent
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass

COST = json.loads((GROWTH / "cost-basis.json").read_text(encoding="utf-8"))["skus"]
TRAVEL_SKUS = {s for s, cb in COST.items() if cb.get("size") == "travel"}
GIFT_CODES = {"MINI-GRATIS_2PDR1FZ"}
EPS = 5.00
TODAY = dt.date(2026, 7, 22)
MATURE_CUT = dt.date(2026, 4, 23)
GIFT_PAT = re.compile(r"MINI-?GRATIS|MONTE|KIT|GANHE|PLUMA\+|GRUPINHO|PRESENTE|NECESSAIRE|COMPRE", re.I)


def as_int(x):
    try: return int(x)
    except (TypeError, ValueError): return None


def main():
    by_cust = defaultdict(list)
    num_orders = {}
    with open(HERE / "orders_raw.jsonl", encoding="utf-8") as f:
        for line in f:
            o = json.loads(line)
            cid = o.get("customer_id")
            if not cid: continue
            by_cust[cid].append(o)
            num_orders[cid] = as_int(o.get("num_orders"))

    def is_giveaway(o):
        for l in o["lines"]:
            try: lr = float(l["rev"])
            except (TypeError, ValueError): lr = 0.0
            if l["sku"] in TRAVEL_SKUS and lr <= EPS * max(l.get("qty", 1), 1):
                return True
        return bool(set(o.get("discount_codes") or []) & GIFT_CODES)

    def classify(o):
        codes = [c for c in (o.get("discount_codes") or [])]
        if is_giveaway(o):
            return "value_add_giveaway"
        if any(GIFT_PAT.search(c) for c in codes):
            return "value_add_gift_code"
        if any(c.upper().startswith("PRIMEIRACOMPRA") for c in codes):
            return "discount_firstbuy"
        if codes:
            return "discount_other"
        return "organic_fullprice"

    classes = ["value_add_giveaway", "value_add_gift_code", "discount_firstbuy",
               "discount_other", "organic_fullprice"]
    stat = {c: {"n": 0, "repeaters": 0} for c in classes}

    for cid, os in by_cust.items():
        n = num_orders.get(cid)
        if n is None or len(os) != n:      # full-history
            continue
        os.sort(key=lambda x: x["created_at"])
        first = os[0]
        fd = dt.date.fromisoformat(first["created_at"][:10])
        if fd > MATURE_CUT:                # mature
            continue
        cls = classify(first)
        stat[cls]["n"] += 1
        if len(os) >= 2:
            stat[cls]["repeaters"] += 1

    out = {"mature_full_history_universe": sum(s["n"] for s in stat.values()),
           "by_first_order_mechanic": {}}
    for c in classes:
        s = stat[c]
        rr = round(s["repeaters"] / s["n"], 4) if s["n"] else None
        out["by_first_order_mechanic"][c] = {"n": s["n"], "repeaters": s["repeaters"], "repeat_rate": rr}

    va = stat["value_add_giveaway"]
    dfb = stat["discount_firstbuy"]
    dot = stat["discount_other"]
    def rate(s): return s["repeaters"] / s["n"] if s["n"] else None
    out["headline"] = {
        "value_add_giveaway_repeat": round(rate(va), 4) if va["n"] else None,
        "discount_firstbuy_repeat": round(rate(dfb), 4) if dfb["n"] else None,
        "discount_other_repeat": round(rate(dot), 4) if dot["n"] else None,
        "giveaway_minus_discount_firstbuy_pp": (
            round((rate(va) - rate(dfb)) * 100, 1) if va["n"] and dfb["n"] else None),
    }
    # per-campaign GWP confirmation from discounts.out.json
    try:
        drows = json.load(open(HERE / "discounts.out.json", encoding="utf-8"))
        want = {"compre e ganhe", "COMPRE-GANHE-SET24", "WE LOVE BOOSTER",
                "MONTE_SEU_KIT_15OFF", "MONTE_SEU_KIT_10OFF"}
        gwp = {}
        for r in drows:
            key = r.get("title") or (r["codes_sample"][0] if r["codes_sample"] else "")
            if key in want:
                gwp[key] = r.get("redemptions")
        out["gwp_campaign_redemptions_confirmed"] = gwp
    except Exception as e:
        out["gwp_campaign_redemptions_confirmed"] = f"unavailable: {e}"

    (HERE / "mechanic-repeat.out.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
