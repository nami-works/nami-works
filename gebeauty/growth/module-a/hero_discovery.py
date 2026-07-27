"""
Module A - HERO DISCOVERY (D9) + ONE-OFF DRIVERS (D10).

Data-driven: which first-order products/combos actually make customers come back,
controlling for the price confound (big first-order buyers repeat more regardless of
product). Reuses orders_raw.jsonl.

Universe: FULL-HISTORY customers (orders seen == lifetime numberOfOrders, so the
earliest order is genuinely their first) whose FIRST order is MATURE (>=90d ago, i.e.
on/before 2026-04-23) so they had time to repeat.

Per first-order single product (n>=150) and per co-purchase combo (pair n>=150,
trio n>=120): repeat rate, median time-to-2nd, 12-mo product LTV, sample size.

Confound control: bucket every customer by FIRST-ORDER product_net into value bands,
compute each band's baseline repeat rate, then for each product/combo compute the
EXPECTED repeat given its members' first-order-value mix. residual = actual - expected.
A driver whose actual repeat is high but residual ~0 is PRICE-CONFOUNDED; a positive
residual = genuinely product-driven stickiness.

D10 mirror: among products, the ascending-repeat tail = the one-and-done universe.

Usage: python hero_discovery.py
"""
import datetime as dt, itertools, json, statistics, sys
from collections import defaultdict, Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
GROWTH = HERE.parent
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass

COST = json.loads((GROWTH / "cost-basis.json").read_text(encoding="utf-8"))["skus"]
TODAY = dt.date(2026, 7, 22)
MATURE_CUT = dt.date(2026, 4, 23)
BASE_DECK = 0.158  # deck reference base repeat rate (kpi_sweep 13mo all-customers)
FULL_SKUS = {s for s, cb in COST.items() if cb.get("size") == "full"}


def as_int(x):
    try: return int(x)
    except (TypeError, ValueError): return None

def name(sku): return COST.get(sku, {}).get("name", sku)
def is_full(sku): return sku in FULL_SKUS  # unknown SKUs -> False (flagged separately)

def band(v):
    if v < 100: return "<100"
    if v < 150: return "100-150"
    if v < 200: return "150-200"
    if v < 250: return "200-250"
    if v < 350: return "250-350"
    return "350+"
BANDS = ["<100", "100-150", "150-200", "200-250", "250-350", "350+"]


def load_universe():
    by_cust = defaultdict(list)
    num_orders = {}
    with open(HERE / "orders_raw.jsonl", encoding="utf-8") as f:
        for line in f:
            o = json.loads(line)
            cid = o.get("customer_id")
            if not cid: continue
            by_cust[cid].append(o)
            num_orders[cid] = as_int(o.get("num_orders"))
    universe = []  # list of dicts: first-order facts + repeat facts
    for cid, os in by_cust.items():
        os.sort(key=lambda x: x["created_at"])
        n = num_orders.get(cid)
        if n is None or len(os) != n:      # full-history only
            continue
        first = os[0]
        fd = dt.date.fromisoformat(first["created_at"][:10])
        if fd > MATURE_CUT:                # mature only
            continue
        first_skus = {l["sku"] for l in first["lines"] if l["sku"]}
        def line_rev(o):
            s = 0.0
            for l in o["lines"]:
                try: s += float(l["rev"])
                except (TypeError, ValueError): pass
            return s
        fval = line_rev(first)
        repeated = len(os) >= 2
        t2 = None
        if repeated:
            sd = dt.date.fromisoformat(os[1]["created_at"][:10])
            t2 = (sd - fd).days
        ltv12 = sum(line_rev(o) for o in os
                    if (dt.date.fromisoformat(o["created_at"][:10]) - fd).days <= 365)
        universe.append({"cid": cid, "first_skus": first_skus, "first_val": fval,
                         "band": band(fval), "repeated": repeated, "t2": t2, "ltv12": ltv12})
    return universe


def main():
    U = load_universe()
    N = len(U)
    base = sum(1 for u in U if u["repeated"]) / N

    # band baseline repeat rates (the confound control reference)
    band_n = Counter(); band_rep = Counter()
    for u in U:
        band_n[u["band"]] += 1
        if u["repeated"]: band_rep[u["band"]] += 1
    band_rate = {b: (band_rep[b] / band_n[b] if band_n[b] else 0) for b in BANDS}

    def cohort_stats(members):
        n = len(members)
        rep = sum(1 for m in members if m["repeated"])
        t2 = sorted(m["t2"] for m in members if m["t2"] is not None)
        ltv = [m["ltv12"] for m in members]
        expected = sum(band_rate[m["band"]] for m in members) / n
        avg_val = statistics.mean(m["first_val"] for m in members)
        return {
            "n": n, "repeat_rate": round(rep / n, 4),
            "expected_repeat_price_adj": round(expected, 4),
            "residual_vs_price": round(rep / n - expected, 4),
            "median_t2": statistics.median(t2) if t2 else None,
            "ltv12_product": round(statistics.mean(ltv), 2),
            "avg_first_order_val": round(avg_val, 2),
            "beats_deck_base_pp": round((rep / n - BASE_DECK) * 100, 1),
        }

    # ---- singles ----
    single = {}
    sku_members = defaultdict(list)
    for u in U:
        for sku in u["first_skus"]:
            sku_members[sku].append(u)
    for sku, members in sku_members.items():
        if len(members) >= 150:
            s = cohort_stats(members)
            s["sku"] = sku; s["name"] = name(sku); s["full_size"] = is_full(sku)
            single[sku] = s

    # ---- combos (pairs + trios) as first-order signatures ----
    pair_members = defaultdict(list)
    trio_members = defaultdict(list)
    for u in U:
        fs = sorted(s for s in u["first_skus"] if is_full(s))  # combos on full-size only
        for c in itertools.combinations(fs, 2):
            pair_members[c].append(u)
        for c in itertools.combinations(fs, 3):
            trio_members[c].append(u)
    combos = []
    for combo, members in pair_members.items():
        if len(members) >= 150:
            s = cohort_stats(members)
            s["combo"] = list(combo); s["names"] = [name(x) for x in combo]; s["type"] = "pair"
            combos.append(s)
    for combo, members in trio_members.items():
        if len(members) >= 120:
            s = cohort_stats(members)
            s["combo"] = list(combo); s["names"] = [name(x) for x in combo]; s["type"] = "trio"
            combos.append(s)

    singles_ranked = sorted(single.values(), key=lambda x: -x["repeat_rate"])
    combos_ranked = sorted(combos, key=lambda x: -x["repeat_rate"])

    # D10: one-and-done = ascending repeat among singles, with one-time share
    oneoff = sorted(single.values(), key=lambda x: x["repeat_rate"])

    # by category (line) singles
    cat_members = defaultdict(list)
    for u in U:
        lines_hit = {COST.get(s, {}).get("line", "other") for s in u["first_skus"] if is_full(s)}
        for c in lines_hit:
            cat_members[c].append(u)
    by_cat = {}
    for c, members in cat_members.items():
        if len(members) >= 100:
            by_cat[c] = cohort_stats(members)

    out = {
        "universe": {"mature_full_history_customers": N,
                     "universe_base_repeat": round(base, 4),
                     "deck_base_repeat": BASE_DECK},
        "price_band_baseline_repeat": {b: {"n": band_n[b], "repeat_rate": round(band_rate[b], 4)}
                                       for b in BANDS},
        "singles_ranked_by_repeat": singles_ranked,
        "combos_ranked_by_repeat": combos_ranked,
        "one_and_done_ascending": oneoff,
        "by_category": by_cat,
    }
    (HERE / "hero-discovery.out.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"universe (mature full-history): {N}  base repeat {base:.1%}  (deck base {BASE_DECK:.1%})")
    print("\nprice-band baseline repeat (confound control):")
    for b in BANDS:
        print(f"  {b:8s} n={band_n[b]:6d}  repeat {band_rate[b]:.1%}")
    print("\n=== SINGLES (first order included X), ranked by repeat ===")
    print(f"{'SKU':9s} {'name':30s} {'n':>6} {'repeat':>7} {'exp(price)':>10} {'resid':>7} {'t2':>4} {'LTV12':>8} {'AOV1':>7} full")
    for s in singles_ranked:
        print(f"{s['sku']:9s} {s['name'][:30]:30s} {s['n']:6d} {s['repeat_rate']*100:6.1f}% {s['expected_repeat_price_adj']*100:9.1f}% {s['residual_vs_price']*100:+6.1f}% {str(s['median_t2']):>4} {s['ltv12_product']:8.0f} {s['avg_first_order_val']:7.0f} {s['full_size']}")
    print("\n=== COMBOS (first order contained ALL of), ranked by repeat ===")
    for s in combos_ranked:
        print(f"{'+'.join(x.split()[-1] for x in s['combo']):14s} n={s['n']:5d} repeat {s['repeat_rate']*100:5.1f}% exp {s['expected_repeat_price_adj']*100:5.1f}% resid {s['residual_vs_price']*100:+5.1f}% LTV12 {s['ltv12_product']:.0f}  | {' + '.join(s['names'])}")
    print("\n=== BY CATEGORY (full-size line) ===")
    for c, s in sorted(by_cat.items(), key=lambda kv: -kv[1]["repeat_rate"]):
        print(f"  {c:10s} n={s['n']:6d} repeat {s['repeat_rate']*100:5.1f}% resid {s['residual_vs_price']*100:+5.1f}% LTV12 {s['ltv12_product']:.0f}")

if __name__ == "__main__":
    main()
