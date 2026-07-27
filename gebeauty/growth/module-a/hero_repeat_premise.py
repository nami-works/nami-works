"""
Module A - HERO = REPEAT premise validation (deliverable 4).

Reads orders_raw.jsonl. Compares repeat behavior of customers whose FIRST order
included a hero (001/002/003 any size) vs those whose first order did NOT. Also
reports the PRIMER-first cohort's repeat baseline. Metrics per group: repeat rate,
median time-to-2nd, avg orders/customer, and params-free 12-mo product-revenue LTV.

To keep "first order" true, the premise is computed on FULL-HISTORY customers only:
those whose captured order count == lifetime numberOfOrders (so the earliest order
seen is genuinely their first). Reported overall AND on a 90-day-mature cut (first
order on/before 2026-04-23) so recent cohorts don't depress the repeat rate.

Usage: python hero_repeat_premise.py
"""
import datetime as dt, json, statistics, sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass

TODAY = dt.date(2026, 7, 22)
MATURE_CUT = dt.date(2026, 4, 23)   # 90d before today
HERO_ANY = {"GEB 001", "GEB 002", "GEB 003", "GEB 010", "GEB 011", "GEB 013"}
PRIMERS = {"GEB 101", "GEB 102"}


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

    # full-history customers: seen count == lifetime count
    full = {}
    for cid, os in by_cust.items():
        os.sort(key=lambda x: x["created_at"])
        if num_orders.get(cid) is not None and len(os) == num_orders[cid]:
            full[cid] = os

    def skus(o):
        return {l["sku"] for l in o["lines"] if l["sku"]}

    def line_rev(o):
        s = 0.0
        for l in o["lines"]:
            try: s += float(l["rev"])
            except (TypeError, ValueError): pass
        return s

    def analyze(cids, label):
        n = len(cids)
        if n == 0:
            return {"group": label, "n": 0}
        repeaters = 0
        t2 = []
        orders_per = []
        ltv12 = []
        for cid in cids:
            os = full[cid]
            orders_per.append(len(os))
            first_d = dt.date.fromisoformat(os[0]["created_at"][:10])
            if len(os) >= 2:
                repeaters += 1
                second_d = dt.date.fromisoformat(os[1]["created_at"][:10])
                t2.append((second_d - first_d).days)
            # 12-mo cumulative product revenue (params-free)
            rev12 = sum(line_rev(o) for o in os
                        if (dt.date.fromisoformat(o["created_at"][:10]) - first_d).days <= 365)
            ltv12.append(rev12)
        t2.sort()
        return {
            "group": label, "n": n,
            "repeat_rate": round(repeaters / n, 4),
            "repeaters": repeaters,
            "median_time_to_2nd_days": statistics.median(t2) if t2 else None,
            "p25_t2": t2[len(t2)//4] if t2 else None,
            "p75_t2": t2[(3*len(t2))//4] if t2 else None,
            "avg_orders_per_customer": round(statistics.mean(orders_per), 3),
            "avg_12mo_product_rev_brl": round(statistics.mean(ltv12), 2),
        }

    # classify by first order
    hero_first, nonhero_first, primer_first = [], [], []
    hero_first_m, nonhero_first_m, primer_first_m = [], [], []
    for cid, os in full.items():
        first = os[0]
        s = skus(first)
        first_d = dt.date.fromisoformat(first["created_at"][:10])
        mature = first_d <= MATURE_CUT
        if s & HERO_ANY:
            hero_first.append(cid)
            if mature: hero_first_m.append(cid)
        else:
            nonhero_first.append(cid)
            if mature: nonhero_first_m.append(cid)
        if s & PRIMERS:
            primer_first.append(cid)
            if mature: primer_first_m.append(cid)

    out = {
        "full_history_customers": len(full),
        "overall": {
            "hero_first": analyze(hero_first, "hero_first"),
            "nonhero_first": analyze(nonhero_first, "nonhero_first"),
            "primer_first": analyze(primer_first, "primer_first"),
        },
        "mature_90d_cut": {
            "hero_first": analyze(hero_first_m, "hero_first_mature"),
            "nonhero_first": analyze(nonhero_first_m, "nonhero_first_mature"),
            "primer_first": analyze(primer_first_m, "primer_first_mature"),
        },
    }
    (HERE / "hero-repeat.out.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
