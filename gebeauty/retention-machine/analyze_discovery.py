"""
'Discovered products' view: for each product, was it bought at first sight, or added later?
entry     = customer's FIRST order contained it
discovered= NOT in the first order, but bought in a later order
Ranks products by discovery volume + discovery share (its role: entry vs expansion product).
Reuses _cache/history_full.jsonl + the canon() merge from analyze_products.
"""
import json, sys
from pathlib import Path
from collections import defaultdict
HERE = Path(__file__).resolve().parent
FULL = HERE / "_cache" / "history_full.jsonl"
CAT = HERE / "_cache" / "catalog.json"
sys.stdout.reconfigure(encoding="utf-8")
cat = json.loads(CAT.read_text(encoding="utf-8"))

def prod_meta(pid):
    m = cat.get(pid)
    if not m or m.get("type") not in ("product","acessorio") or m.get("title","").startswith("["): return None
    return m
def canon(title):
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
def pcanon(pid):
    m = prod_meta(pid); return canon(m["title"]) if m else None

orders = {}; kids = defaultdict(list)
for line in FULL.open(encoding="utf-8"):
    o = json.loads(line); pid = o.get("__parentId")
    if pid: kids[pid].append(o)
    elif "/Order/" in o.get("id",""): orders[o["id"]] = o

cust = defaultdict(list)
for oid, o in orders.items():
    if o.get("cancelledAt") or o.get("displayFinancialStatus") in ("REFUNDED","VOIDED","PENDING","EXPIRED"): continue
    cid = (o.get("customer") or {}).get("id")
    if not cid: continue
    prods = {pcanon(li.get("product",{}).get("id")) for li in kids.get(oid,[]) if pcanon((li.get("product") or {}).get("id"))}
    cust[cid].append((o["createdAt"][:10], prods))

entry = defaultdict(int); disc = defaultdict(int)
for cid, tl in cust.items():
    tl = sorted(tl, key=lambda x: x[0])
    first = tl[0][1]
    later = set().union(*[p for _,p in tl[1:]]) if len(tl) > 1 else set()
    for p in first: entry[p] += 1
    for p in (later - first): disc[p] += 1

rows = []
for p in set(list(entry)+list(disc)):
    e, d = entry[p], disc[p]; tot = e + d
    if tot < 30: continue
    rows.append({"product": p, "entry": e, "discovered": d, "buyers": tot,
                 "discovery_share": round(100*d/tot,1)})
tot_disc = sum(disc.values())
print("total discovery adds:", tot_disc)
print("\nBY DISCOVERY VOLUME (added later most often):")
for r in sorted(rows, key=lambda x:-x["discovered"]):
    print(f"  {r['product']:28} descobriram={r['discovered']:5}  compraram 1a={r['entry']:5}  "
          f"%descoberto={r['discovery_share']:5}  (share do total desc {round(100*r['discovered']/tot_disc,1)}%)")
print("\nBY DISCOVERY SHARE (most 'expansion-natured'):")
for r in sorted(rows, key=lambda x:-x["discovery_share"]):
    print(f"  {r['product']:28} %descoberto={r['discovery_share']:5}  (n descobriram={r['discovered']}, 1a={r['entry']})")
