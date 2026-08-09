"""
Module A -- does a booster + partner-product COMBO break the "boosters are
anti-heroes" belief? (Lucas, 2026-08-08)

The existing premise (docs/retention-hero-products-study.md, hero_repeat_premise.py):
customers whose FIRST order is a sole booster repeat far less than customers whose
first order is a hero product (001/002/008-ish) or the wash routine. This script tests
whether that belief breaks down for specific booster+partner COMBOS bought together on
the first order -- e.g. "shampoo sem sulfato + booster fortificante together" or
"leave-in + booster definicao together" (Lucas's own examples) -- by comparing, per
(booster, partner) pair, three first-order cohorts:

  both      -- first order contains BOTH the booster and the partner
  booster_only -- first order contains the booster, NOT that partner
  partner_only -- first order contains the partner, NOT that booster

against each other and against the catalogue-wide baseline repeat rate, using the same
full-history / mature-cohort methodology as hero_repeat_premise.py (so results are
directly comparable to the existing hero-vs-non-hero numbers).

Boosters: GEB 019/020/021/022/023 (fortificante/hidratante/definicao/antifrizz/antioxidante).
Partners: every other costed catalogue SKU (hero trio candidates 001/002/008, leave-ins
003/120, travel sizes, primers 101/102, mayday 121, melon mood 024/029) -- run against
ALL of them, not just the two illustrative examples, since the ask is "is there ANY
scenario where the belief is wrong."

Data: orders_raw.jsonl (dumped 2026-07-22, n=50,409 orders, 2025-06-01 to 2026-07-22).
~2.5 weeks stale relative to today; fine for a repeat-rate study on a 90-day-mature
cohort (a couple weeks of staleness barely shifts a 90-day cutoff) -- flagged, not
silently ignored. Re-pull orders_raw.jsonl for a fresher cut if this analysis ever needs
to support a real go/no-go decision rather than a "is our belief right" sanity check.

Usage: python booster_combo_repeat.py
"""
import datetime as dt, json, statistics, sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
GROWTH = HERE.parent
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass

TODAY = dt.date(2026, 8, 8)
MATURE_CUT = TODAY - dt.timedelta(days=90)
MIN_N = 25  # minimum cohort size to trust a repeat-rate number at all

COST = json.loads((GROWTH / "cost-basis.json").read_text(encoding="utf-8"))["skus"]
BOOSTERS = {"GEB 019", "GEB 020", "GEB 021", "GEB 022", "GEB 023"}
HERO_TRIO_DOC = {"GEB 001", "GEB 002", "GEB 008"}     # per docs/retention-hero-products-study.md
HERO_TRIO_CODE = {"GEB 001", "GEB 002", "GEB 003"}    # per market_basket.py / hero_repeat_premise.py
# discrepancy between doc (008=shampoo a seco) and code (003=leave-in termica) is real,
# unresolved -- flagged in the write-up, not silently picked one. Both stay in PARTNERS.
CATALOG = set(COST.keys())
PARTNERS = sorted(CATALOG - BOOSTERS)


def name(sku):
    return COST.get(sku, {}).get("name", sku)


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
            if not cid:
                continue
            by_cust[cid].append(o)
            num_orders[cid] = as_int(o.get("num_orders"))

    full = {}
    for cid, os in by_cust.items():
        os.sort(key=lambda x: x["created_at"])
        if num_orders.get(cid) is not None and len(os) == num_orders[cid]:
            full[cid] = os

    def skus(o):
        return {l["sku"] for l in o["lines"] if l["sku"] in CATALOG}

    def line_rev(o):
        s = 0.0
        for l in o["lines"]:
            try: s += float(l["rev"])
            except (TypeError, ValueError): pass
        return s

    # first-order SKU set + maturity, computed once per customer
    first_set, first_date, mature = {}, {}, {}
    for cid, os in full.items():
        first = os[0]
        first_set[cid] = skus(first)
        d = dt.date.fromisoformat(first["created_at"][:10])
        first_date[cid] = d
        mature[cid] = d <= MATURE_CUT

    def analyze(cids):
        cids = [c for c in cids if mature[c]]
        n = len(cids)
        if n < MIN_N:
            return {"n": n, "note": f"below MIN_N={MIN_N}, not reported"}
        repeaters = 0; t2 = []; orders_per = []; ltv12 = []
        for cid in cids:
            os = full[cid]
            orders_per.append(len(os))
            fd = first_date[cid]
            if len(os) >= 2:
                repeaters += 1
                sd = dt.date.fromisoformat(os[1]["created_at"][:10])
                t2.append((sd - fd).days)
            ltv12.append(sum(line_rev(o) for o in os
                              if (dt.date.fromisoformat(o["created_at"][:10]) - fd).days <= 365))
        t2.sort()
        return {
            "n": n, "repeat_rate": round(repeaters / n, 4), "repeaters": repeaters,
            "median_time_to_2nd_days": statistics.median(t2) if t2 else None,
            "avg_orders_per_customer": round(statistics.mean(orders_per), 3),
            "avg_12mo_product_rev_brl": round(statistics.mean(ltv12), 2),
        }

    # catalogue-wide baseline (mature, full-history) for comparison
    baseline = analyze(list(full.keys()))

    # per-booster sole-booster baseline (first order = booster(s) only, no partner at all,
    # i.e. first order's SKU set is a non-empty subset of BOOSTERS) -- recomputed fresh,
    # should land near the doc's 13.7%/12.7% anti-hero figures as a sanity check.
    booster_alone = {}
    for b in sorted(BOOSTERS):
        cids = [cid for cid, s in first_set.items() if b in s and s <= BOOSTERS]
        booster_alone[b] = {"name": name(b), **analyze(cids)}

    results = []
    for b in sorted(BOOSTERS):
        for p in PARTNERS:
            both = [cid for cid, s in first_set.items() if b in s and p in s]
            booster_only = [cid for cid, s in first_set.items() if b in s and p not in s]
            partner_only = [cid for cid, s in first_set.items() if p in s and b not in s]
            r_both = analyze(both)
            if r_both.get("n", 0) < MIN_N:
                continue  # not enough combo buyers to say anything -- skip, don't fabricate
            r_bo = analyze(booster_only)
            r_po = analyze(partner_only)
            rr_both = r_both.get("repeat_rate")
            rr_bo = r_bo.get("repeat_rate")
            rr_base = baseline.get("repeat_rate")
            results.append({
                "booster": b, "booster_name": name(b),
                "partner": p, "partner_name": name(p),
                "both_first": r_both,
                "booster_only_first": r_bo,
                "partner_only_first": r_po,
                "lift_vs_booster_alone_pp": round((rr_both - rr_bo) * 100, 1) if (rr_both is not None and rr_bo is not None) else None,
                "lift_vs_catalogue_baseline_pp": round((rr_both - rr_base) * 100, 1) if (rr_both is not None and rr_base is not None) else None,
                "beats_baseline": bool(rr_both is not None and rr_base is not None and rr_both > rr_base),
            })

    results.sort(key=lambda r: (r["lift_vs_catalogue_baseline_pp"] or -999), reverse=True)

    out = {
        "generated": TODAY.isoformat(),
        "data_as_of": "2026-07-22 (orders_raw.jsonl dump date)",
        "mature_cut": MATURE_CUT.isoformat(),
        "min_cohort_n": MIN_N,
        "full_history_customers": len(full),
        "catalogue_baseline": baseline,
        "booster_alone_baselines": booster_alone,
        "hero_trio_discrepancy_note": "doc (retention-hero-products-study.md) says 001/002/008; "
            "code (market_basket.py, hero_repeat_premise.py) says 001/002/003 -- unresolved, both "
            "008 and 003 are included as partner candidates below rather than picking one.",
        "combo_results_ranked": results,
    }
    (HERE / "booster-combo-repeat.out.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"catalogue baseline repeat rate: {baseline.get('repeat_rate')} (n={baseline.get('n')})")
    print(f"booster-alone baselines:")
    for b, v in booster_alone.items():
        print(f"  {b} ({v['name']}): repeat_rate={v.get('repeat_rate')} n={v.get('n')}")
    print(f"\n{len(results)} (booster, partner) combos with n>={MIN_N} combo-buyers, ranked by lift vs catalogue baseline:")
    for r in results[:20]:
        print(f"  {r['booster_name']:20} + {r['partner_name']:30} both_n={r['both_first']['n']:5} "
              f"both_rr={r['both_first'].get('repeat_rate')}  vs_booster_alone={r['lift_vs_booster_alone_pp']:+.1f}pp  "
              f"vs_baseline={r['lift_vs_catalogue_baseline_pp']:+.1f}pp  beats_baseline={r['beats_baseline']}")


if __name__ == "__main__":
    main()
