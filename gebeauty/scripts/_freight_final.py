"""Final locked free-shipping threshold model for the deliverable.

Locked policy (converged with Lucas):
  - Threshold(region) = regional avg Unilog freight / k, EXCEPT SE frozen at R$199.
  - k_other = 10% for CO/S/NE/N; SE anchored at R$199 (implied k 11.7%).
  - Metric = free-shipping profit hit = freight GE absorbs on free-ship orders
    (orders >= threshold; below-threshold is net-zero pass-through) + 5% returns
    line on gross outbound, all / net merch revenue.
  - Basis: last-12mo Online-Store BR orders, average freight per region.

Emits freight_final.json for the xlsx + HTML mockup builders.
"""
import json, statistics as st
from collections import defaultdict
from pathlib import Path
import _unilog_freight as uf

HERE = Path(__file__).resolve().parent
REGION = {"N":["AC","AP","AM","PA","RO","RR","TO"],
          "NE":["AL","BA","CE","MA","PB","PE","PI","RN","SE"],
          "CO":["DF","GO","MT","MS"], "SE":["ES","MG","RJ","SP"], "S":["PR","RS","SC"]}
REGION_NAME = {"N":"Norte","NE":"Nordeste","CO":"Centro-Oeste","SE":"Sudeste","S":"Sul"}
U2R = {u:r for r,us in REGION.items() for u in us}
LADDER = {"SE":199, "CO":279, "S":319, "NE":399, "N":649}   # locked
RR = 0.05


def money(o,k): return float((o.get(k) or {}).get("shopMoney",{}).get("amount") or 0)


def main():
    matrix, idx = uf.load()
    rows = [json.loads(l) for l in open(HERE/"freight_orders_raw.jsonl", encoding="utf-8")]
    web = [o for o in rows if o.get("sourceName")=="web"
           and (o.get("app") or {}).get("name")=="Online Store"
           and not o.get("cancelledAt") and not o.get("test")]
    med = st.median([float(o.get("totalWeight") or 0) for o in web if float(o.get("totalWeight") or 0)>0])
    O=[]
    for o in web:
        a=o.get("shippingAddress") or {}; z=a.get("zip")
        if not z or a.get("country") not in ("Brazil",None): continue
        wkg=(float(o.get("totalWeight") or 0) or med)/1000; sub=money(o,"currentSubtotalPriceSet")
        fr=uf.freight(matrix,idx,z,wkg,sub)
        if not fr or not fr["uf"]: continue
        O.append({"uf":fr["uf"],"region":U2R[fr["uf"]],"freight":fr["total"],"rev":sub})

    TOTREV=sum(x["rev"] for x in O); GROSS=sum(x["freight"] for x in O); N=len(O)

    def agg(rows, thr_of):
        rev=sum(x["rev"] for x in rows); gross=sum(x["freight"] for x in rows); n=len(rows)
        free=[x for x in rows if x["rev"]>=thr_of(x)]
        absorbed=sum(x["freight"] for x in free)
        return {"n":n, "rev":rev, "rev_share":rev/TOTREV, "avg_freight":gross/n,
                "aov":rev/n, "gross_pct":gross/rev, "free_share":len(free)/n,
                "absorbed":absorbed, "absorbed_pct":absorbed/rev,
                "returns_pct":RR*gross/rev, "hit_pct":(absorbed+RR*gross)/rev}

    thr_of = lambda x: LADDER[x["region"]]
    national = agg(O, thr_of)
    national["k_weighted"] = sum((agg([x for x in O if x["region"]==r], thr_of)["rev_share"]
                                 * agg([x for x in O if x["region"]==r], thr_of)["avg_freight"]/LADDER[r])
                                 for r in LADDER)

    per_region = {}
    for r in LADDER:
        rows=[x for x in O if x["region"]==r]
        d=agg(rows, thr_of); d["threshold"]=LADDER[r]; d["k_design"]=d["avg_freight"]/LADDER[r]
        d["name"]=REGION_NAME[r]; d["ufs"]=REGION[r]; per_region[r]=d

    per_uf={}
    for u in sorted(set(x["uf"] for x in O)):
        rows=[x for x in O if x["uf"]==u]
        d=agg(rows, thr_of); d["region"]=U2R[u]; d["threshold"]=LADDER[U2R[u]]
        d["k_realized"]=d["avg_freight"]/d["threshold"]; per_uf[u]=d

    # baseline: today flat R$299 (net-zero below)
    base=agg(O, lambda x:299)

    out={"meta":{"orders":N,"rev":TOTREV,"gross":GROSS,"gross_pct":GROSS/TOTREV,
                 "return_rate":RR,"ladder":LADDER,"k_se":per_region["SE"]["k_design"],
                 "k_other":0.10,"window":"last 12 months","channel":"Online Store BR"},
         "national":national,"baseline_flat299":base,
         "per_region":per_region,"per_uf":per_uf}
    json.dump(out, open(HERE/"freight_final.json","w"), indent=2, default=float)

    print(f"LOCKED LADDER  (SE R$199, k_other 10%)   weighted-k {100*national['k_weighted']:.1f}%")
    print(f"national: free {100*national['free_share']:.0f}%  profit hit {100*national['hit_pct']:.2f}% "
          f"(absorbed {100*national['absorbed_pct']:.2f}% + returns {100*national['returns_pct']:.2f}%)")
    print(f"today flat R$299: free {100*base['free_share']:.0f}%  hit {100*base['hit_pct']:.2f}%\n")
    print(f"{'Reg':<4}{'thr':>6}{'k_des':>7}{'rev%':>6}{'AOV':>6}{'avgFrt':>7}{'free%':>7}{'hit%':>7}")
    for r in ["SE","CO","S","NE","N"]:
        d=per_region[r]
        print(f"{r:<4}{'R$'+str(d['threshold']):>6}{100*d['k_design']:>6.1f}%{100*d['rev_share']:>5.0f}%"
              f"{d['aov']:>6.0f}{d['avg_freight']:>7.1f}{100*d['free_share']:>6.0f}%{100*d['hit_pct']:>6.1f}%")
    print("\nwrote freight_final.json")


if __name__ == "__main__":
    main()
