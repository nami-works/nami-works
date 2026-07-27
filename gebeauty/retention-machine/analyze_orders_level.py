"""
Order-level historical analysis from the cached full-order export (no line items needed).
Computes: base sizing, repeat-rate ladder, repurchase-interval distribution, and the
days-between-orders histogram that validates (or not) the 90-270d experimental sweet spot.
"""
import json, sys
from pathlib import Path
from collections import defaultdict
from datetime import datetime
HERE = Path(__file__).resolve().parent
CACHE = HERE / "_cache" / "orders.jsonl"
sys.stdout.reconfigure(encoding="utf-8")

def dt(s): return datetime.strptime(s[:10], "%Y-%m-%d")

per = defaultdict(list)
n_rows = 0; n_valid = 0
dmin = dmax = None
for line in CACHE.open(encoding="utf-8"):
    o = json.loads(line); n_rows += 1
    if "/Order/" not in o.get("id",""): continue
    if o.get("cancelledAt") or o.get("displayFinancialStatus") in ("REFUNDED","VOIDED","PENDING","EXPIRED"): continue
    cid = (o.get("customer") or {}).get("id")
    if not cid: continue
    d = o["createdAt"][:10]
    per[cid].append(d); n_valid += 1
    if dmin is None or d < dmin: dmin = d
    if dmax is None or d > dmax: dmax = d

custs = len(per)
repeat = sum(1 for v in per.values() if len(v) >= 2)
o3 = sum(1 for v in per.values() if len(v) >= 3)
o4 = sum(1 for v in per.values() if len(v) >= 4)

# repurchase intervals (consecutive gaps in days), plus days-to-2nd-order
gaps = []
first_gap = []
for v in per.values():
    if len(v) < 2: continue
    ds = sorted(dt(x) for x in v)
    for a, b in zip(ds, ds[1:]):
        g = (b-a).days
        if 0 < g <= 1000: gaps.append(g)
    fg = (ds[1]-ds[0]).days
    if 0 < fg <= 1000: first_gap.append(fg)

def pct(arr, p):
    if not arr: return 0
    s = sorted(arr); i = int(round((p/100)*(len(s)-1))); return s[i]

# histogram by the SAME bands as the experiment
BANDS = [(0,30,"0-30"),(30,60,"30-60"),(60,90,"60-90"),(90,120,"90-120"),
         (120,180,"120-180"),(180,270,"180-270"),(270,365,"270-365"),(365,10**9,"365+")]
hist = {name:0 for _,_,name in BANDS}
for g in gaps:
    for lo,hi,name in BANDS:
        if lo <= g < hi: hist[name]+=1; break
tot = sum(hist.values()) or 1

out = {
  "date_range":[dmin,dmax], "rows":n_rows, "valid_orders":n_valid, "customers":custs,
  "repeat_customers":repeat, "repeat_rate":round(100*repeat/custs,1),
  "cust_3plus":o3, "rate_3plus":round(100*o3/custs,1),
  "cust_4plus":o4, "rate_4plus":round(100*o4/custs,1),
  "n_intervals":len(gaps),
  "interval_median":pct(gaps,50), "interval_p25":pct(gaps,25), "interval_p75":pct(gaps,75),
  "first_gap_median":pct(first_gap,50), "first_gap_p25":pct(first_gap,25), "first_gap_p75":pct(first_gap,75),
  "interval_hist":{k:round(100*v/tot,1) for k,v in hist.items()},
  "interval_hist_n":hist,
}
print(json.dumps(out, ensure_ascii=False, indent=1))
