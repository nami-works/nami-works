"""Free-shipping threshold solver on the Unilog B2C table.

Costs every last-12mo Online-Store BR order under Unilog, then solves free-ship
thresholds at three granularities (flat national / 5 macro-regions / 27 states)
so the BLENDED shipping burden lands on the 12%-of-revenue target.

Model (locked premises):
  - metric tuned on ABSORBED freight (free-ship orders GE eats), pass-through below
  - returns: +5% of outbound freight on ALL shipped orders (GE eats return leg),
    reported as a separate line; target 12% = absorbed_outbound% + returns_line%
  - tax already embedded in tariff; static (no elasticity)
  - threshold rule per zone: T = mean_outbound_freight(zone) / k, single national k
    solved so blended total burden = 12%. Same k => free shipping equally "hard to
    get" in proportion to local freight cost.

Outputs: freight_model_summary.json (+ console). Read-only.
"""
import json, os, statistics as st
from collections import defaultdict
from pathlib import Path
import _unilog_freight as uf

HERE = Path(__file__).resolve().parent
RAW = HERE / "freight_orders_raw.jsonl"
RETURN_RATE = 0.05
TARGET = 0.12

REGION = {
    "N":  {"AC","AP","AM","PA","RO","RR","TO"},
    "NE": {"AL","BA","CE","MA","PB","PE","PI","RN","SE"},
    "CO": {"DF","GO","MT","MS"},
    "SE": {"ES","MG","RJ","SP"},
    "S":  {"PR","RS","SC"},
}
UF2REGION = {u: r for r, ufs in REGION.items() for u in ufs}
NICE = [0, 79, 99, 119, 149, 169, 199, 229, 249, 279, 299, 329, 349, 399, 449, 499, 599, 699, 799, 999]


def round_nice(x):
    return min(NICE, key=lambda n: abs(n - x))


def money(o, k):
    return float((o.get(k) or {}).get("shopMoney", {}).get("amount") or 0)


def load_orders():
    matrix, idx = uf.load()
    rows = [json.loads(l) for l in open(RAW, encoding="utf-8")]
    web = [o for o in rows if o.get("sourceName") == "web"
           and (o.get("app") or {}).get("name") == "Online Store"
           and not o.get("cancelledAt") and not o.get("test")]
    wts = [float(o.get("totalWeight") or 0) for o in web]
    med = st.median([w for w in wts if w > 0])
    out = []
    for o in web:
        addr = o.get("shippingAddress") or {}
        zip_ = addr.get("zip")
        if not zip_ or addr.get("country") not in ("Brazil", None):
            continue
        wkg = (float(o.get("totalWeight") or 0) or med) / 1000.0
        sub = money(o, "currentSubtotalPriceSet")
        fr = uf.freight(matrix, idx, zip_, wkg, sub)
        if fr is None or not fr["uf"]:
            continue
        out.append({"uf": fr["uf"], "region": UF2REGION.get(fr["uf"], "?"),
                    "freight": fr["total"], "rev": sub,
                    "cur_ship": money(o, "currentShippingPriceSet")})
    return out


def blended(orders, thr_of):
    """thr_of(order)->threshold. Returns dict of burden components (% of rev)."""
    rev = sum(o["rev"] for o in orders)
    absorbed = free_n = 0.0
    gross = sum(o["freight"] for o in orders)
    for o in orders:
        if o["rev"] >= thr_of(o):
            absorbed += o["freight"]; free_n += 1
    returns = RETURN_RATE * gross
    return {
        "rev": rev, "gross": gross, "absorbed": absorbed, "returns": returns,
        "absorbed_pct": absorbed / rev, "returns_pct": returns / rev,
        "gross_pct": gross / rev, "total_pct": (absorbed + returns) / rev,
        "free_share": free_n / len(orders),
    }


def solve_k(orders, zone_key, mean_freight):
    """Binary-search national k so T[zone]=mean_freight[zone]/k hits TARGET total."""
    lo, hi = 0.01, 5.0
    for _ in range(60):
        k = (lo + hi) / 2
        thr = lambda o: round_nice(mean_freight[zone_key(o)] / k)
        b = blended(orders, thr)
        if b["total_pct"] > TARGET:   # too much absorbed -> raise thresholds -> lower k
            hi = k
        else:
            lo = k
    return (lo + hi) / 2


def mean_freight_by(orders, key):
    agg = defaultdict(list)
    for o in orders:
        agg[key(o)].append(o["freight"])
    return {k: sum(v) / len(v) for k, v in agg.items()}


def main():
    orders = load_orders()
    rev = sum(o["rev"] for o in orders)
    gross = sum(o["freight"] for o in orders)
    print(f"orders {len(orders)}  rev R${rev:,.0f}  gross freight R${gross:,.0f} "
          f"({100*gross/rev:.2f}%)  +returns line {100*RETURN_RATE*gross/rev:.2f}pp "
          f"=> ceiling {100*(gross+RETURN_RATE*gross)/rev:.2f}%")

    # ---- current-policy baseline: flat R$299 + pass-through ----
    b299 = blended(orders, lambda o: 299)
    print(f"\n[baseline] flat R$299 + pass-through: absorbed {100*b299['absorbed_pct']:.2f}%"
          f" + returns {100*b299['returns_pct']:.2f}pp = {100*b299['total_pct']:.2f}% "
          f"| free share {100*b299['free_share']:.1f}%")

    results = {}
    # ---- 1) flat national threshold ----
    def solve_flat():
        lo, hi = 0.0, 2000.0
        for _ in range(60):
            t = (lo + hi) / 2
            b = blended(orders, lambda o: t)
            if b["total_pct"] > TARGET: lo = t
            else: hi = t
        return (lo + hi) / 2
    tflat = solve_flat(); bflat = blended(orders, lambda o: round_nice(tflat))
    print(f"\n[FLAT] national threshold R${tflat:.0f} (nice R${round_nice(tflat)}): "
          f"total {100*bflat['total_pct']:.2f}%  free {100*bflat['free_share']:.1f}%")
    results["flat"] = {"threshold": round_nice(tflat), **{k: bflat[k] for k in
                       ("total_pct","absorbed_pct","returns_pct","free_share")}}

    # ---- 2) per-region & 3) per-state ----
    for name, key in (("region", lambda o: o["region"]), ("state", lambda o: o["uf"])):
        mf = mean_freight_by(orders, key)
        k = solve_k(orders, key, mf)
        thr = {z: round_nice(mf[z] / k) for z in mf}
        b = blended(orders, lambda o: thr[key(o)])
        # per-UF realized burden under this policy (reveals dispersion)
        per_uf = defaultdict(lambda: {"rev":0.0,"absorbed":0.0,"gross":0.0,"n":0,"free":0})
        for o in orders:
            d = per_uf[o["uf"]]; d["rev"]+=o["rev"]; d["gross"]+=o["freight"]; d["n"]+=1
            if o["rev"] >= thr[key(o)]:
                d["absorbed"]+=o["freight"]; d["free"]+=1
        results[name] = {
            "k": k, "thresholds": thr,
            "blended": {kk: b[kk] for kk in ("total_pct","absorbed_pct","returns_pct","free_share")},
            "per_uf": {u: {"threshold": thr[key({"uf":u,"region":UF2REGION.get(u)})],
                           "burden_pct": (d["absorbed"]+RETURN_RATE*d["gross"])/d["rev"],
                           "free_share": d["free"]/d["n"], "n": d["n"],
                           "rev": d["rev"]} for u, d in per_uf.items()},
        }
        print(f"\n[{name.upper()}] k={k:.3f}  blended total {100*b['total_pct']:.2f}%  "
              f"free {100*b['free_share']:.1f}%")
        for z in sorted(thr, key=lambda z: thr[z]):
            print(f"    {z:<5} T=R${thr[z]:<4}")

    results["meta"] = {"orders": len(orders), "rev": rev, "gross": gross,
                       "gross_pct": gross/rev, "ceiling_pct": (gross+RETURN_RATE*gross)/rev,
                       "return_rate": RETURN_RATE, "target": TARGET,
                       "baseline_299": {k: b299[k] for k in ("total_pct","free_share")}}
    json.dump(results, open(HERE/"freight_model_summary.json","w"), indent=2, default=float)
    print("\nwrote freight_model_summary.json")


if __name__ == "__main__":
    main()
