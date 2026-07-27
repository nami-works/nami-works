"""
Module A - BROADENED RESCUE COHORT (D11).

Rescue target redefined: ALL one-time buyers (numberOfOrders==1) whose only order did
NOT include a DATA HERO (per D9's conclusion). Reuses orders_raw.jsonl.

D9 conclusion (data-driven hero = full-size fidelity drivers with the highest
price-adjusted repeat): CORE = GEB 001 (shampoo), GEB 002 (mascara), GEB 008 (shampoo
a seco). "Any size" adds their travel variants 010 (mask), 013 (shampoo). GEB 003
(leave-in termica), the old trio's 3rd member, is DROPPED - it repeats at base only.

Reports the broadened cohort under the data-hero definition, plus two comparison
definitions (old-trio hero; primer-only), first-product breakdown, emailable count,
and recency buckets.

Usage: python broadened_rescue.py
"""
import datetime as dt, json, sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
GROWTH = HERE.parent
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass

COST = json.loads((GROWTH / "cost-basis.json").read_text(encoding="utf-8"))["skus"]
TODAY = dt.date(2026, 7, 22)

DATA_HERO_ANY = {"GEB 001", "GEB 002", "GEB 008", "GEB 010", "GEB 013"}
OLD_HERO_ANY = {"GEB 001", "GEB 002", "GEB 003", "GEB 010", "GEB 011", "GEB 013"}
PRIMERS = {"GEB 101", "GEB 102"}


def as_int(x):
    try: return int(x)
    except (TypeError, ValueError): return None

def name(sku): return COST.get(sku, {}).get("name", sku)
def cat(sku): return COST.get(sku, {}).get("line", "other/uncosted")

def bucket(days):
    if days < 30: return "<30"
    if days < 60: return "30-60"
    if days < 90: return "60-90"
    if days < 180: return "90-180"
    if days < 365: return "180-365"
    return "365+"
BUCKETS = ["<30", "30-60", "60-90", "90-180", "180-365", "365+"]


def main():
    seen = {}
    with open(HERE / "orders_raw.jsonl", encoding="utf-8") as f:
        for line in f:
            o = json.loads(line)
            if as_int(o.get("num_orders")) == 1 and o.get("customer_id"):
                if o["customer_id"] not in seen:
                    seen[o["customer_id"]] = o
    one_time = list(seen.values())

    def skus(o): return {l["sku"] for l in o["lines"] if l["sku"]}

    def cohort(hero_set):
        return [o for o in one_time if not (skus(o) & hero_set)]

    data_cohort = cohort(DATA_HERO_ANY)
    old_cohort = cohort(OLD_HERO_ANY)
    primer_only = [o for o in one_time if (skus(o) & PRIMERS) and not (skus(o) & OLD_HERO_ANY)]

    # first-product + category breakdown of the data cohort
    fp = Counter(); fc = Counter()
    for o in data_cohort:
        for sku in skus(o):
            fp[f"{sku} ({name(sku)})"] += 1
        for c in {cat(sku) for sku in skus(o)}:
            fc[c] += 1
    rec = Counter()
    for o in data_cohort:
        d = dt.date.fromisoformat(o["created_at"][:10])
        rec[bucket((TODAY - d).days)] += 1
    n_email = sum(1 for o in data_cohort if o.get("email"))

    out = {
        "one_time_buyers_total": len(one_time),
        "broadened_data_hero_definition": sorted(DATA_HERO_ANY),
        "broadened_cohort_size": len(data_cohort),
        "broadened_emailable": n_email,
        "recency_buckets": {k: rec.get(k, 0) for k in BUCKETS},
        "first_product_breakdown_top": fp.most_common(20),
        "first_category_breakdown": dict(fc.most_common()),
        "comparison": {
            "primer_only_prev_cohort": len(primer_only),
            "old_trio_hero_no_hero_cohort": len(old_cohort),
            "data_hero_no_hero_cohort": len(data_cohort),
        },
    }
    (HERE / "broadened-rescue.out.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
