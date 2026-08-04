"""
Normalized SEND-vs-HOLD cumulative repurchase curve for the decision deck.

Reuses the cached bulk order export (_cache/orders_since_2026-07-06.jsonl) + learning/sends.jsonl.
For each arm, computes the % of that arm's customers who had placed >=1 valid order (on/after their
own sent_at) by each day. RATE-based so the ~8.6:1 arm-size gap cancels out -> the gap between the
two lines IS the causal lift. Prints a JSON blob to paste into the artifact.

  python daily_arm_curve.py            # combined (both waves)
  python daily_arm_curve.py --wave 2026-07-06-ge60d
"""
import json, sys, argparse
from pathlib import Path
from collections import defaultdict
from datetime import date, timedelta

HERE = Path(__file__).resolve().parent
LEARN = HERE / "learning"
CACHE = HERE / "_cache" / "orders_since_2026-07-06.jsonl"
END = date(2026, 7, 14)
sys.stdout.reconfigure(encoding="utf-8")

ap = argparse.ArgumentParser(); ap.add_argument("--wave"); args = ap.parse_args()

recs = [json.loads(l) for l in (LEARN / "sends.jsonl").open(encoding="utf-8") if l.strip()]
if args.wave: recs = [r for r in recs if r["wave"] == args.wave]

# arm -> {gid -> sent_at}   (dedupe by gid, keep earliest sent_at)
arm_send = {}
for r in recs:
    g = r["customer_gid"]; a = r["arm"]
    arm_send.setdefault(a, {})
    if g not in arm_send[a] or r["sent_at"] < arm_send[a][g]:
        arm_send[a][g] = r["sent_at"]

# gid -> sorted list of valid order dates (YYYY-MM-DD)
orders = defaultdict(list)
for line in CACHE.open(encoding="utf-8"):
    o = json.loads(line)
    if "/Order/" not in o.get("id", ""): continue
    if o.get("cancelledAt") or o.get("displayFinancialStatus") in ("REFUNDED", "VOIDED"): continue
    g = (o.get("customer") or {}).get("id")
    if not g: continue
    orders[g].append(o["createdAt"][:10])

start = min(min(v.values()) for v in arm_send.values())
days = []
d = date.fromisoformat(start)
while d <= END:
    days.append(d.isoformat()); d += timedelta(days=1)

out = {"days": days, "arms": {}}
for arm, gids in arm_send.items():
    n = len(gids)
    # first qualifying order date per customer (order on/after their sent_at)
    first = {}
    for g, sent in gids.items():
        q = [od for od in orders.get(g, []) if od >= sent]
        if q: first[g] = min(q)
    series = []
    for day in days:
        cum = sum(1 for fd in first.values() if fd <= day)
        series.append(round(100 * cum / n, 3))
    out["arms"][arm] = {"n": n, "repurchasers": len(first),
                        "final_rate": round(100 * len(first) / n, 3), "cum_rate": series}

s = out["arms"].get("SEND"); h = out["arms"].get("HOLD")
if s and h:
    out["final_lift_pp"] = round(s["final_rate"] - h["final_rate"], 3)
    print(f"SEND n={s['n']} final={s['final_rate']:.2f}%   HOLD n={h['n']} final={h['final_rate']:.2f}%   "
          f"lift={out['final_lift_pp']:+.2f}pp")
print(json.dumps(out, ensure_ascii=False))
