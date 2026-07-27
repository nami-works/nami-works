"""
Module A - market-basket / co-purchase affinity (deliverable 8).

Reads orders_raw.jsonl. (a) Co-purchase pairs + triples across multi-item orders with
confidence + lift, zoomed on the hero trio (001/002/003) + adjacent formula SKUs
(booster line 019-023, primers 101/102, leave-in pluma 120). (b) Evaluates "buy A+B
get C free" hero combos, ranking by co-purchase strength and by
retail(paid-pair) / COGS(free-item). (c) Primer->hero next-purchase direction among
primer-first repeaters.

Retail + COGS from cost-basis.json (confirmed). Freight/fulfillment intentionally
excluded (params under revision).

Usage: python market_basket.py
"""
import datetime as dt, itertools, json, sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
GROWTH = HERE.parent
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass

COST = json.loads((GROWTH / "cost-basis.json").read_text(encoding="utf-8"))["skus"]
HERO_FULL = {"GEB 001", "GEB 002", "GEB 003"}
HERO_ANY = HERO_FULL | {"GEB 010", "GEB 011", "GEB 013"}
PRIMERS = {"GEB 101", "GEB 102"}
# "real" catalog SKUs (drop empty; drop obvious non-retail). Keep only costed +
# known formula/booster SKUs so kit/brinde noise doesn't dominate.
CATALOG = set(COST.keys())


def as_int(x):
    try: return int(x)
    except (TypeError, ValueError): return None


def name(sku):
    return COST.get(sku, {}).get("name", sku)


def main():
    orders = []
    by_cust = defaultdict(list)
    num_orders = {}
    with open(HERE / "orders_raw.jsonl", encoding="utf-8") as f:
        for line in f:
            o = json.loads(line)
            orders.append(o)
            cid = o.get("customer_id")
            if cid:
                by_cust[cid].append(o)
                num_orders[cid] = as_int(o.get("num_orders"))

    # basket = distinct catalog SKUs in an order
    baskets = []
    item_count = Counter()
    for o in orders:
        s = {l["sku"] for l in o["lines"] if l["sku"] in CATALOG}
        if s:
            baskets.append(s)
            for sku in s:
                item_count[sku] += 1
    total_baskets = len(baskets)
    multi = [b for b in baskets if len(b) >= 2]

    # pair counts
    pair = Counter()
    triple = Counter()
    for b in multi:
        for combo in itertools.combinations(sorted(b), 2):
            pair[combo] += 1
        for combo in itertools.combinations(sorted(b), 3):
            triple[combo] += 1

    def conf_lift(a, b, ab):
        # confidence A->B and lift
        ca, cb = item_count[a], item_count[b]
        conf = ab / ca if ca else 0
        supp_b = cb / total_baskets if total_baskets else 0
        lift = (conf / supp_b) if supp_b else 0
        return conf, lift

    top_pairs = []
    for (a, b), c in pair.most_common(40):
        confab, lift = conf_lift(a, b, c)
        confba, _ = conf_lift(b, a, c)
        top_pairs.append({
            "a": a, "b": b, "a_name": name(a), "b_name": name(b),
            "orders_together": c,
            "conf_a_to_b": round(confab, 3), "conf_b_to_a": round(confba, 3),
            "lift": round(lift, 2),
        })

    top_triples = []
    for (a, b, cc), c in triple.most_common(25):
        top_triples.append({"skus": [a, b, cc],
                            "names": [name(a), name(b), name(cc)],
                            "orders_together": c})

    # (b) buy A+B get C free candidates.
    # paid pair support/confidence from pair counts; free item cost from cost-basis.
    def retail(sku): return COST.get(sku, {}).get("retail_brl")
    def cogs(sku): return COST.get(sku, {}).get("unit_cost_brl")

    candidates = []
    # hero pair -> third hero free
    hero_pairs = list(itertools.combinations(sorted(HERO_FULL), 2))
    adjacent_free = ["GEB 001", "GEB 002", "GEB 003", "GEB 013", "GEB 010", "GEB 011",
                     "GEB 120", "GEB 101", "GEB 102"]
    for (a, b) in hero_pairs:
        ab = pair.get((a, b), 0)
        confab, lift = conf_lift(a, b, ab)
        confba, _ = conf_lift(b, a, ab)
        pair_retail = (retail(a) or 0) + (retail(b) or 0)
        # free = the remaining hero, plus alternative free items
        for free in adjacent_free:
            if free in (a, b):
                continue
            fc = cogs(free)
            if fc is None:
                continue
            candidates.append({
                "paid_pair": [a, b], "paid_names": [name(a), name(b)],
                "free": free, "free_name": name(free),
                "pair_orders_together": ab,
                "pair_confidence_max": round(max(confab, confba), 3),
                "pair_lift": round(lift, 2),
                "paid_pair_retail_brl": round(pair_retail, 2),
                "free_item_cogs_brl": round(fc, 2),
                "retail_to_freecost_ratio": round(pair_retail / fc, 1) if fc else None,
            })
    # rank: primarily by co-purchase orders_together, then by retail/freecost ratio
    candidates.sort(key=lambda x: (x["pair_orders_together"], x["retail_to_freecost_ratio"] or 0), reverse=True)

    # (c) primer-first repeaters -> what hero next
    primer_next_hero = Counter()
    primer_repeaters = 0
    for cid, os in by_cust.items():
        os.sort(key=lambda x: x["created_at"])
        if not os:
            continue
        first_skus = {l["sku"] for l in os[0]["lines"] if l["sku"]}
        if not (first_skus & PRIMERS):
            continue
        if (num_orders.get(cid) or len(os)) < 2:
            continue
        primer_repeaters += 1
        for o in os[1:]:
            for l in o["lines"]:
                if l["sku"] in HERO_ANY:
                    primer_next_hero[l["sku"]] += 1

    out = {
        "total_baskets": total_baskets,
        "multi_item_baskets": len(multi),
        "item_frequency_top": item_count.most_common(20),
        "top_pairs": top_pairs,
        "top_triples": top_triples,
        "bxgy_candidates_ranked": candidates[:15],
        "primer_first_repeaters": primer_repeaters,
        "primer_repeaters_next_hero_sku": {f"{k} ({name(k)})": v
                                           for k, v in primer_next_hero.most_common()},
    }
    (HERE / "market-basket.out.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
