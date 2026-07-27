"""
Retention readout — SEND-vs-HOLD lift + true redemption + net revenue, per wave and band.

Reads learning/sends.jsonl (frozen arm + features) and joins live Shopify orders placed since
each customer's sent_at. Detects REDEMPTION via store-credit on the order (paymentGatewayNames),
estimates credit actually redeemed (min of credit issued and order value), and reports net.
Also reads learning/whatsapp-saleday.jsonl for the 7/7 sale-day A/B (Arm T vs Arm C).

  python measure_reactivation.py                 # both waves
  python measure_reactivation.py --wave 2026-07-06-ge60d
  python measure_reactivation.py --wave 2026-07-07-ge45-59d-refill

Run days after the send (and again at expiry) to watch the curve mature.
"""
import json, sys, urllib.request, time, argparse
from pathlib import Path
from collections import defaultdict
from datetime import date

HERE = Path(__file__).resolve().parent
TEN = HERE.parent
LEARN = HERE / "learning"
SENDS = LEARN / "sends.jsonl"
SALEDAY = LEARN / "whatsapp-saleday.jsonl"
TODAY = date.today()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
WAVES = ["2026-07-06-ge60d", "2026-07-07-ge45-59d-refill"]

sys.stdout.reconfigure(encoding="utf-8")   # readout uses − / R$ etc.; avoid cp1252 console crash
def log(*a): print(*a); sys.stdout.flush()
env = {}
for line in (TEN / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1); env[k.strip()] = v.strip()
URL = f"https://{env['SHOPIFY_SHOP_DOMAIN']}/admin/api/{env.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
def gql(q, v=None):
    body = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json",
        "X-Shopify-Access-Token": env["SHOPIFY_ADMIN_ACCESS_TOKEN"], "User-Agent": UA})
    return json.loads(urllib.request.urlopen(req).read().decode())

def orders_since(day):
    """Bulk export orders since `day`, incl. financial status + gateways for redemption detection."""
    BULK = '''mutation { bulkOperationRunQuery(query: """
    { orders(query: "created_at:>=%s") { edges { node {
        id createdAt displayFinancialStatus cancelledAt
        customer { id }
        currentTotalPriceSet { shopMoney { amount } }
        paymentGatewayNames
    } } } } """) { bulkOperation { id status } userErrors { field message } } }''' % day
    r = gql(BULK)
    ue = r["data"]["bulkOperationRunQuery"]["userErrors"]
    if ue: raise RuntimeError(ue)
    while True:
        time.sleep(6)
        c = gql('{ currentBulkOperation { status objectCount url } }')["data"]["currentBulkOperation"]
        if c["status"] in ("COMPLETED", "FAILED", "CANCELED"): break
    if c["status"] != "COMPLETED": raise RuntimeError(c)
    out = HERE / "_cache" / f"orders_since_{day}.jsonl"
    if c["url"]: urllib.request.urlretrieve(c["url"], out)
    else: out.write_text("", encoding="utf-8")
    return out

def used_credit(gws): return any("credit" in (g or "").lower() for g in (gws or []))

def load_orders(day):
    """gid -> {'orders':[(created_full, total, used_credit)], valid only}."""
    op = orders_since(day)
    per = defaultdict(list)
    for line in op.open(encoding="utf-8"):
        o = json.loads(line)
        if "/Order/" not in o.get("id", ""): continue
        if o.get("cancelledAt") or o.get("displayFinancialStatus") in ("REFUNDED", "VOIDED"): continue
        gid = (o.get("customer") or {}).get("id")
        if not gid: continue
        amt = ((o.get("currentTotalPriceSet") or {}).get("shopMoney") or {}).get("amount")
        per[gid].append((o["createdAt"], float(amt) if amt else 0.0, used_credit(o.get("paymentGatewayNames"))))
    return per

def band_of(r):
    if r.get("recency_band"): return r["recency_band"]
    d = r.get("recency_days") if r.get("recency_days") is not None else r.get("days_since")
    if d is None: return "?"
    for lo, hi, name in [(0,60,"<60"),(60,90,"60-90"),(90,120,"90-120"),(120,180,"120-180"),
                         (180,270,"180-270"),(270,365,"270-365"),(365,10**9,"365+")]:
        if lo <= d < hi: return name
    return "?"
def band_key(b):
    try: return int(b.split("-")[0].replace("<","").replace("+",""))
    except: return 9999

def measure_wave(wave):
    recs = [json.loads(l) for l in SENDS.open(encoding="utf-8") if l.strip()]
    recs = [r for r in recs if r["wave"] == wave]
    if not recs: log(f"  (no records for {wave})"); return None
    min_sent = min(r["sent_at"] for r in recs)
    per = load_orders(min_sent)

    agg = defaultdict(lambda: {"n":0,"repurch":0,"redeem":0,"rev":0.0,"credit_redeemed":0.0})
    for r in recs:
        arm, b = r["arm"], band_of(r)
        os_ = [o for o in per.get(r["customer_gid"], []) if o[0][:10] >= r["sent_at"]]
        rep = bool(os_)
        red = any(o[2] for o in os_)
        rev = sum(o[1] for o in os_)
        issued = r.get("credit_amount") or r.get("credit") or 0.0
        c = agg[(arm, b)]; c["n"] += 1
        if rep:
            c["repurch"] += 1; c["rev"] += rev
            if red: c["redeem"] += 1
            if arm == "SEND" and red: c["credit_redeemed"] += min(issued, rev)  # est. credit actually used
    return agg

def render(wave, agg):
    def rt(c, k): return 100*c[k]/c["n"] if c["n"] else 0.0
    bands = sorted({b for (_, b) in agg}, key=band_key)
    L = [f"## {wave} — as of {TODAY.isoformat()}", "",
         "| band | SEND n | repurch% | redeem% | HOLD n | repurch% | lift(pp) | gross | est.credit | net |",
         "|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|"]
    T = {"sn":0,"sr":0,"sd":0,"hn":0,"hr":0,"rev":0.0,"cr":0.0}
    for b in bands:
        s = agg.get(("SEND", b), {"n":0,"repurch":0,"redeem":0,"rev":0.0,"credit_redeemed":0.0})
        h = agg.get(("HOLD", b), {"n":0,"repurch":0,"redeem":0,"rev":0.0,"credit_redeemed":0.0})
        if s["n"]==0 and h["n"]==0: continue
        lift = rt(s,"repurch") - rt(h,"repurch")
        net = s["rev"] - s["credit_redeemed"]
        L.append(f"| {b} | {s['n']} | {rt(s,'repurch'):.2f}% | {rt(s,'redeem'):.2f}% | {h['n']} | "
                 f"{rt(h,'repurch'):.2f}% | {lift:+.2f} | R$ {s['rev']:,.0f} | R$ {s['credit_redeemed']:,.0f} | R$ {net:,.0f} |")
        for kk,src in (("sn",s["n"]),("sr",s["repurch"]),("sd",s["redeem"]),("hn",h["n"]),("hr",h["repurch"]),("rev",s["rev"]),("cr",s["credit_redeemed"])): T[kk]+=src
    slift = (100*T["sr"]/T["sn"] if T["sn"] else 0) - (100*T["hr"]/T["hn"] if T["hn"] else 0)
    L.append(f"| **ALL** | {T['sn']} | {100*T['sr']/max(1,T['sn']):.2f}% | {100*T['sd']/max(1,T['sn']):.2f}% | "
             f"{T['hn']} | {100*T['hr']/max(1,T['hn']):.2f}% | {slift:+.2f} | R$ {T['rev']:,.0f} | "
             f"R$ {T['cr']:,.0f} | R$ {T['rev']-T['cr']:,.0f} |")
    L.append("")
    return L

def saleday_section():
    if not SALEDAY.exists(): return []
    arms = {}
    for l in SALEDAY.open(encoding="utf-8"):
        try:
            r = json.loads(l); arms[r["customer_gid"]] = (r["arm"], r["push_date"])
        except: pass
    if not arms: return []
    # earliest push_date across the log = window start for the order pull
    start = min(pd for _, pd in arms.values())
    per = load_orders(start)
    cell = defaultdict(lambda: {"n":0,"redeem":0,"repurch":0})
    for gid,(arm,pd) in arms.items():
        os_ = [o for o in per.get(gid, []) if o[0][:10] >= pd]
        cell[arm]["n"] += 1
        if os_: cell[arm]["repurch"] += 1
        if any(o[2] for o in os_): cell[arm]["redeem"] += 1
    L = ["## 7/7 sale-day A/B (H-SALEDAY-PUSH-01)", "",
         "| arm | messaged | repurch% | redeem% |", "|---|--:|--:|--:|"]
    for a in ("T","C"):
        c = cell.get(a, {"n":0,"redeem":0,"repurch":0})
        rp = 100*c["repurch"]/c["n"] if c["n"] else 0.0
        rd = 100*c["redeem"]/c["n"] if c["n"] else 0.0
        L.append(f"| {a} ({'today 7/7' if a=='T' else 'scheduled 07-11'}) | {c['n']} | {rp:.2f}% | {rd:.2f}% |")
    L += ["", "_Arm C fires 07-11; T-vs-C only interpretable once C has run + 48h elapsed._", ""]
    return L

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--wave"); args = ap.parse_args()
    waves = [args.wave] if args.wave else WAVES
    out = [f"# Retention readout — {TODAY.isoformat()}", ""]
    for w in waves:
        agg = measure_wave(w)
        if agg: out += render(w, agg)
    out += saleday_section()
    out += ["**lift(pp)** = SEND repurchase% − HOLD repurchase% (causal). **redeem%** = used store credit on an order.",
            "**net** = gross revenue − est. credit redeemed (min of issued and order value). Re-run at expiry."]
    p = LEARN / f"readout-{TODAY.isoformat()}.md"
    p.write_text("\n".join(out), encoding="utf-8")
    log("\n".join(out)); log(f"\n-> {p}")

if __name__ == "__main__":
    main()
