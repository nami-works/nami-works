"""
Module A - RESCUE COHORT + recency + strict/inclusive mechanics (deliverables 1, 2, 7).

Reads orders_raw.jsonl. The rescue cohort = customers who are ONE-TIME buyers
(numberOfOrders == 1) whose only order included a primer (GEB 101 or 102) AND who
never purchased any HERO (canonical = ANY size incl travel). Split 101-only /
102-only / both / total. Writes the send list to rescue-cohort.csv.

Also: recency distribution (days since only order) and the STRICT (full-size heroes
only) vs INCLUSIVE (any size) cohort-size delta.

Usage: python rescue_cohort.py
"""
import csv, datetime as dt, json, sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass

TODAY = dt.date(2026, 7, 22)
HERO_FULL = {"GEB 001", "GEB 002", "GEB 003"}
HERO_TRAVEL = {"GEB 010", "GEB 011", "GEB 013"}
HERO_ANY = HERO_FULL | HERO_TRAVEL
PRIMERS = {"GEB 101", "GEB 102"}


def as_int(x):
    try: return int(x)
    except (TypeError, ValueError): return None


def load():
    rows = []
    with open(HERE / "orders_raw.jsonl", encoding="utf-8") as f:
        for line in f:
            rows.append(json.loads(line))
    return rows


def bucket(days):
    if days < 30: return "<30"
    if days < 60: return "30-60"
    if days < 90: return "60-90"
    if days < 180: return "90-180"
    if days < 365: return "180-365"
    return "365+"


def main():
    orders = load()
    # one-time buyers: num_orders == 1, non-null customer
    one_time = [o for o in orders if as_int(o.get("num_orders")) == 1 and o.get("customer_id")]
    # de-dup: a one-time customer should appear once; if duplicated in window keep first
    seen = {}
    for o in one_time:
        cid = o["customer_id"]
        if cid not in seen:
            seen[cid] = o
    one_time = list(seen.values())

    def skus(o):
        return {l["sku"] for l in o["lines"] if l["sku"]}

    cohort_incl, cohort_strict = [], []
    for o in one_time:
        s = skus(o)
        if not (s & PRIMERS):
            continue
        if not (s & HERO_ANY):          # inclusive: no hero any size
            cohort_incl.append(o)
        if not (s & HERO_FULL):         # strict: no full-size hero
            cohort_strict.append(o)

    def split(cohort):
        c = Counter()
        for o in cohort:
            s = skus(o)
            has101 = "GEB 101" in s
            has102 = "GEB 102" in s
            if has101 and has102: c["both"] += 1
            elif has101: c["101_only"] += 1
            elif has102: c["102_only"] += 1
        c["total"] = len(cohort)
        return dict(c)

    incl_split = split(cohort_incl)
    strict_split = split(cohort_strict)

    # recency on canonical (inclusive) cohort
    rec = Counter()
    for o in cohort_incl:
        d = dt.date.fromisoformat(o["created_at"][:10])
        rec[bucket((TODAY - d).days)] += 1
    rec_order = ["<30", "30-60", "60-90", "90-180", "180-365", "365+"]

    # write CSV (canonical inclusive cohort = the send list)
    with open(HERE / "rescue-cohort.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["customer_id", "email", "order_id", "order_date", "primer_sku", "order_total_brl"])
        for o in sorted(cohort_incl, key=lambda x: x["created_at"]):
            s = skus(o)
            prm = "|".join(sku for sku in ["GEB 101", "GEB 102"] if sku in s)
            w.writerow([o["customer_id"], o.get("email") or "", o["id"], o["created_at"][:10],
                        prm, o.get("subtotal") or ""])

    result = {
        "one_time_buyers_total": len(one_time),
        "cohort_inclusive_no_hero_any_size": incl_split,
        "cohort_strict_no_full_hero": strict_split,
        "strict_minus_inclusive_delta": strict_split["total"] - incl_split["total"],
        "recency_inclusive": {k: rec.get(k, 0) for k in rec_order},
    }
    (HERE / "rescue-cohort.out.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print(f"\nCSV rows (inclusive cohort): {incl_split['total']} -> rescue-cohort.csv")
    n_email = sum(1 for o in cohort_incl if o.get("email"))
    print(f"cohort rows with an email: {n_email}/{incl_split['total']}")


if __name__ == "__main__":
    main()
