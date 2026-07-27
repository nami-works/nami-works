"""
Sale-day WhatsApp test (H-SALEDAY-PUSH-01) on the reactivation cohort.

Population: reactivation SEND, 60-120d, non-redeemers (no order since 07-06), valid mobile, has name.
Random 50/50 by GID hash: Arm T = push TODAY (7/7) | Arm C = push 07-11 (ordinary day, 2d pre-expiry).
Template: retention_above60d (buttonTemplate, pt_BR). Args: [nome, produto+N, R$credito, validade].

  python whatsapp_saleday.py                    # dry run: arm sizes + sample args
  python whatsapp_saleday.py --smoke            # one message to Lucas (verify render/approval)
  python whatsapp_saleday.py --arm T --apply    # fire Arm T (today)
  python whatsapp_saleday.py --arm C --apply    # fire Arm C (run on 07-11)
Logs each send to learning/whatsapp-saleday.jsonl (gid, arm, push_date, messageId) for measurement.
"""
import json, sys, time, argparse, hashlib, urllib.request, urllib.error
from pathlib import Path
from datetime import date

HERE = Path(__file__).resolve().parent
TEN = HERE.parent
SENDS = HERE / "learning" / "sends.jsonl"
LOG = HERE / "learning" / "whatsapp-saleday.jsonl"
TEMPLATE = "retention_above60d_v2"   # v2: no product var -> 4 args [nome, credito, validade, url]
VALIDADE = "13/07"            # reactivation credits expire 2026-07-13
SMOKE_TO = "5511972776427"    # Lucas
BASE_URL = "https://www.gebeauty.com.br"
def url_for(arm):             # 5th template arg = full button URL, arm-tagged for attribution
    content = "push_today" if arm == "T" else "push_scheduled"
    return f"{BASE_URL}?utm_source=whatsapp&utm_medium=zoko&utm_campaign=store-credit-reactivation&utm_content={content}"
TODAY = date.today().isoformat()

env = {}
for line in (TEN / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1); env[k.strip()] = v.strip()
ZKEY = env["ZOKO_API_KEY"]
SURL = f"https://{env['SHOPIFY_SHOP_DOMAIN']}/admin/api/{env.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
STOK = env["SHOPIFY_ADMIN_ACCESS_TOKEN"]
def log(*a): print(*a); sys.stdout.flush()

def sgql(q, v=None):
    b = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    r = urllib.request.Request(SURL, data=b, headers={"Content-Type": "application/json", "X-Shopify-Access-Token": STOK})
    return json.loads(urllib.request.urlopen(r).read().decode())

def bought_since_wave():
    Q = """query($c:String){orders(first:250,query:"created_at:>=2026-07-06",after:$c){
      pageInfo{hasNextPage endCursor} nodes{cancelledAt displayFinancialStatus customer{id}}}}"""
    cur = None; s = set()
    while True:
        d = sgql(Q, {"c": cur})["data"]["orders"]
        for o in d["nodes"]:
            c = (o.get("customer") or {}).get("id")
            if c and not o.get("cancelledAt") and o.get("displayFinancialStatus") not in ("REFUNDED", "VOIDED"): s.add(c)
        if d["pageInfo"]["hasNextPage"]: cur = d["pageInfo"]["endCursor"]
        else: break
    return s

def arm_of(gid): return "T" if int(hashlib.md5((gid + "|saleday").encode()).hexdigest(), 16) % 2 == 0 else "C"

def brl(x): return ("R$ %.2f" % float(x)).replace(".", ",")

def produto(rec):
    p = rec.get("anchor_product") or "seus produtos"
    n = rec.get("distinct_products") or 1
    return f"{p} +{n-1}" if n and n > 1 else p

def zoko_send(recipient, args):
    payload = {"channel": "whatsapp", "recipient": recipient, "type": "buttonTemplate",
               "templateId": TEMPLATE, "templateLanguage": "pt_BR", "templateArgs": args}
    req = urllib.request.Request("https://chat.zoko.io/v2/message", data=json.dumps(payload).encode(),
        headers={"apikey": ZKEY, "accept": "application/json", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read().decode("utf-8", "ignore"))
    except urllib.error.HTTPError as e: return e.code, {"error": e.read().decode("utf-8", "ignore")[:300]}
    except Exception as e: return "ERR", {"error": repr(e)[:200]}

def build():
    pool = []
    for line in SENDS.open(encoding="utf-8"):
        o = json.loads(line)
        if o.get("wave") != "2026-07-06-ge60d" or o["arm"] != "SEND": continue
        if not (60 <= o["recency_days"] < 120): continue
        if not o.get("phone") or not o.get("first_name"): continue
        pool.append(o)
    return pool

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true")
    ap.add_argument("--arm", choices=["T", "C"])
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    if args.smoke:
        st, resp = zoko_send(SMOKE_TO, ["Lucas", "R$ 50,00", VALIDADE, url_for("T")])
        log(f"smoke -> {st}  {json.dumps(resp)[:300]}"); return

    pool = build()
    bought = bought_since_wave()
    elig = [o for o in pool if o["customer_gid"] not in bought]
    for o in elig: o["_arm"] = arm_of(o["customer_gid"])
    T = [o for o in elig if o["_arm"] == "T"]; C = [o for o in elig if o["_arm"] == "C"]
    log(f"reactivation 60-120d w/ name+phone: {len(pool)}  | non-redeemers: {len(elig)}")
    log(f"  Arm T (today): {len(T)}   Arm C (07-11): {len(C)}")

    if not args.apply or not args.arm:
        log("\nsample args (first 3 of Arm T):")
        for o in T[:3]:
            log(f"  {o['phone']}  [{o['first_name']}, {produto(o)}, {brl(o['credit_amount'])}, {VALIDADE}]")
        log("\n[dry run] no sends. Use --smoke, or --arm T --apply / --arm C --apply.")
        return

    batch = T if args.arm == "T" else C
    done = set()
    if LOG.exists():
        for l in LOG.open(encoding="utf-8"):
            try:
                r = json.loads(l)
                if r.get("arm") == args.arm: done.add(r["customer_gid"])
            except: pass
    todo = [o for o in batch if o["customer_gid"] not in done]
    log(f"\n[apply] Arm {args.arm}: {len(todo)} to send, {len(done)} already sent")
    ok = err = 0
    with LOG.open("a", encoding="utf-8") as f:
        for i, o in enumerate(todo, 1):
            recipient = "".join(ch for ch in o["phone"] if ch.isdigit())
            st, resp = zoko_send(recipient, [o["first_name"], brl(o["credit_amount"]), VALIDADE, url_for(args.arm)])
            if isinstance(st, int) and 200 <= st < 300:
                ok += 1
                f.write(json.dumps({"customer_gid": o["customer_gid"], "arm": args.arm, "push_date": TODAY,
                    "messageId": resp.get("messageId"), "phone": recipient}, ensure_ascii=False) + "\n"); f.flush()
            else:
                err += 1; log(f"  [err] {recipient}: {st} {resp.get('error','')[:120]}")
            if i % 50 == 0: log(f"  {i}/{len(todo)} ok={ok} err={err}"); time.sleep(1)
    log(f"\n[done] Arm {args.arm}: sent={ok} err={err}")

if __name__ == "__main__":
    main()
