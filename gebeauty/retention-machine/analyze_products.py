"""
Product-level historical analysis from _cache/history_full.jsonl (bulk: order rows + lineItem children).
Answers the retention hypotheses against the archive:
  1. Cadence per product -> archetypes exist? (replenishment priors)
  2. Replenishment vs discovery (do returns add NEW products? which pairs? LTV of breadth?)
  3. Nudge split (are historical returns already incentivized -> is history induced signal?)
Outputs one JSON blob for the interactive case.
"""
import json, sys
from pathlib import Path
from collections import defaultdict, Counter
from datetime import datetime
HERE = Path(__file__).resolve().parent
FULL = HERE / "_cache" / "history_full.jsonl"
CAT = HERE / "_cache" / "catalog.json"
sys.stdout.reconfigure(encoding="utf-8")

cat = json.loads(CAT.read_text(encoding="utf-8"))
def prod_meta(pid):
    m = cat.get(pid)
    if not m: return None
    if m.get("type") not in ("product", "acessorio"): return None
    if m.get("title","").startswith("["): return None
    return m

def canon(title):
    """Collapse travel-size + full-size into one product identity (a TS->full move is the SAME product returning)."""
    t = title.lower().strip()
    if t.startswith("travel size"):
        t = t.split("|",1)[1].strip() if "|" in t else t.replace("travel size","").strip()
    if "melon mood" in t: return "melon mood mist"
    if "mayday" in t: return "máscara mayday"
    if "condicionadora" in t or "condic" in t: return "máscara condicionadora"
    if "shampoo" in t and "seco" in t: return "shampoo a seco"
    if "shampoo" in t and "sulfato" in t: return "shampoo sem sulfato"
    if "pluma" in t: return "leave-in pluma"
    if ("leave" in t) or ("térmica" in t) or ("termica" in t) or ("proteção" in t) or ("protecao" in t): return "leave-in proteção térmica"
    if "primer" in t and "cachos" in t: return "primer cachos definidos"
    if "primer" in t and "liso" in t: return "primer liso intacto"
    if "antifrizz" in t: return "booster antifrizz"
    if "hidratante" in t: return "booster hidratante"
    if "fortificante" in t: return "booster fortificante"
    if "antioxidante" in t: return "booster antioxidante"
    if "definição" in t or "definicao" in t: return "booster definição"
    return t

def pid_canon(pid):
    m = prod_meta(pid)
    return canon(m["title"]) if m else None
def is_consumable(pid):
    m = prod_meta(pid)
    return bool(m) and m.get("type") == "product"

orders = {}; kids = defaultdict(list)
for line in FULL.open(encoding="utf-8"):
    o = json.loads(line)
    pid = o.get("__parentId")
    if pid: kids[pid].append(o)
    elif "/Order/" in o.get("id",""): orders[o["id"]] = o

def dt(s): return datetime.strptime(s[:10], "%Y-%m-%d")
# per customer: list of (date, coreproducts:set(pid), discounted:bool)
cust = defaultdict(list)
n_valid = 0; n_disc = 0
for oid, o in orders.items():
    if o.get("cancelledAt") or o.get("displayFinancialStatus") in ("REFUNDED","VOIDED","PENDING","EXPIRED"): continue
    cid = (o.get("customer") or {}).get("id")
    if not cid: continue
    prods = set()
    for li in kids.get(oid, []):
        p = (li.get("product") or {}).get("id")
        if p and prod_meta(p): prods.add(p)
    disc = bool(o.get("discountCodes"))
    cust[cid].append((o["createdAt"][:10], prods, disc))
    n_valid += 1; n_disc += 1 if disc else 0

# ---- 1. cadence per consumable product ----
prod_intervals = defaultdict(list)
for cid, tl in cust.items():
    tl = sorted(tl, key=lambda x: x[0])
    last_seen = {}
    for d, prods, _ in tl:
        for p in prods:
            if not is_consumable(p): continue
            k = pid_canon(p)
            if k in last_seen:
                g = (dt(d) - dt(last_seen[k])).days
                if 0 < g <= 900: prod_intervals[k].append(g)
            last_seen[k] = d
def med(a):
    if not a: return None
    s = sorted(a); return s[len(s)//2]
cadence = []
for name, arr in prod_intervals.items():
    if len(arr) < 25: continue
    m = med(arr)
    arch = "fast" if m < 75 else ("medium" if m <= 130 else "slow")
    cadence.append({"title": name, "median_days": m, "n": len(arr), "archetype": arch})
cadence.sort(key=lambda x: x["median_days"])

# ---- 2. replenishment vs discovery ----
repeat_orders = 0; pure_replenish = 0; has_discovery = 0
trans = Counter()  # (owned_anchor_title, new_title) -> count
breadth_orders = defaultdict(list)  # distinct core products ever -> [lifetime order counts]
for cid, tl in cust.items():
    tl = sorted(tl, key=lambda x: x[0])
    owned = set()
    for i,(d, prods, disc) in enumerate(tl):
        core = {pid_canon(p) for p in prods if prod_meta(p)}
        if i == 0: owned |= core; continue
        repeat_orders += 1
        new = core - owned
        if new:
            has_discovery += 1
            for n in new:
                for a in owned:
                    trans[(a, n)] += 1
        elif core and core <= owned:
            pure_replenish += 1
        owned |= core
    # breadth vs stickiness
    breadth = len({pid_canon(p) for _,pr,_ in tl for p in pr if prod_meta(p)})
    breadth_orders[breadth].append(len(tl))

def avg(a): return round(sum(a)/len(a),2) if a else 0
stick = {}
for tier,label in [((1,),"1"),((2,),"2"),(tuple(range(3,99)),"3+")]:
    cnts = [c for b,cl in breadth_orders.items() for c in cl if b in tier]
    stick[label] = {"customers": len(cnts), "avg_lifetime_orders": avg(cnts)}

top_pairs = [{"from":a,"to":b,"n":n} for (a,b),n in trans.most_common(12)]

# ---- 3. nudge split (discount code present) ----
disc_repeat = disc_disc = nodisc_repeat = nodisc_disc = 0
for cid, tl in cust.items():
    tl = sorted(tl, key=lambda x: x[0]); owned=set()
    for i,(d,prods,disc) in enumerate(tl):
        core={pid_canon(p) for p in prods if prod_meta(p)}
        if i>0:
            new = bool(core - owned)
            if disc:
                disc_repeat+=1; disc_disc+= 1 if new else 0
            else:
                nodisc_repeat+=1; nodisc_disc+= 1 if new else 0
        owned|=core

out = {
  "valid_orders_with_items": n_valid,
  "pct_orders_discounted": round(100*n_disc/max(1,n_valid),1),
  "cadence": cadence,
  "repeat_orders": repeat_orders,
  "pct_pure_replenish": round(100*pure_replenish/max(1,repeat_orders),1),
  "pct_has_discovery": round(100*has_discovery/max(1,repeat_orders),1),
  "top_discovery_pairs": top_pairs,
  "stickiness_by_breadth": stick,
  "discovery_rate_discounted": round(100*disc_disc/max(1,disc_repeat),1),
  "discovery_rate_nondiscounted": round(100*nodisc_disc/max(1,nodisc_repeat),1),
}
print(json.dumps(out, ensure_ascii=False, indent=1))
