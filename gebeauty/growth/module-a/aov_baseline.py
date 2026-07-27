"""
Module A - AOV baseline: giveaway vs normal (deliverable 3).

Reads orders_raw.jsonl. Computes product AOV and total-rev AOV (+5% freight) for the
last 30d and 90d, split into: overall (giveaway-excluded), the free-travel-size
acquisition cohort, and normal orders. Giveaway detection replicates contribution.py
(a travel SKU line billed <= R$5/unit, or the gift code). Count/AOV metrics only -
no freight/fulfillment net line (params under revision).

Usage: python aov_baseline.py
"""
import datetime as dt, json, sys
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
FREIGHT_REV = 0.05
TODAY = dt.date(2026, 7, 22)


def main():
    orders = []
    with open(HERE / "orders_raw.jsonl", encoding="utf-8") as f:
        for line in f:
            orders.append(json.loads(line))

    def econ(o):
        rev = 0.0
        giveaway = False
        for l in o["lines"]:
            try: lr = float(l["rev"])
            except (TypeError, ValueError): lr = 0.0
            rev += lr
            if l["sku"] in TRAVEL_SKUS and lr <= EPS * max(l.get("qty", 1), 1):
                giveaway = True
        if set(o.get("discount_codes") or []) & GIFT_CODES:
            giveaway = True
        return rev, giveaway

    def window(days):
        cut = TODAY - dt.timedelta(days=days)
        normal, give = [], []
        for o in orders:
            d = dt.date.fromisoformat(o["created_at"][:10])
            if d < cut:
                continue
            rev, gw = econ(o)
            if rev <= 0:
                continue
            (give if gw else normal).append(rev)
        def agg(vals):
            n = len(vals)
            if n == 0: return None
            p = sum(vals)
            return {"orders": n, "product_net": round(p, 2),
                    "product_aov": round(p / n, 2),
                    "total_rev_aov": round(p / n * (1 + FREIGHT_REV), 2)}
        allv = normal + give
        return {
            "days": days,
            "overall_giveaway_excluded": agg(normal),
            "giveaway_cohort": agg(give),
            "all_incl_giveaway": agg(allv),
            "giveaway_share_of_orders": round(len(give) / len(allv), 4) if allv else None,
            "aov_gap_normal_minus_giveaway": (
                round(agg(normal)["product_aov"] - agg(give)["product_aov"], 2)
                if agg(normal) and agg(give) else None),
        }

    out = {"w30": window(30), "w90": window(90)}
    (HERE / "aov-baseline.out.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
