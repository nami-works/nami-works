"""
Extend store-credit expiry to 2026-07-17 for all live-balance holders (reactivation + refill).

Shopify has no expiry-update API, so per holder: debit the live balance, then re-credit the same
amount with expiresAt = 17/07 (balance preserved, one fresh transaction, new date). notify=false
(the retail team communicates the extension).

SAFETY: if a debit succeeds but the re-credit fails after retries, the gid+amount is written to
pending-recredit.jsonl so a --recover run restores it (never leave a customer at R$0).

  python extend_expiry.py                 # dry run: holder count + total live credit
  python extend_expiry.py --limit 1 --apply   # test on one holder
  python extend_expiry.py --apply             # full run (gated)
  python extend_expiry.py --recover           # re-credit any debited-but-not-credited stragglers
"""
import json, sys, time, argparse, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEN = HERE.parent
SENDS = HERE / "learning" / "sends.jsonl"
STATE = HERE / "extend-expiry-state.json"
PENDING = HERE / "pending-recredit.jsonl"
EXPIRES = "2026-07-17T23:59:59Z"
WAVES = {"2026-07-06-ge60d", "2026-07-07-ge45-59d-refill"}

def log(*a): print(*a); sys.stdout.flush()
env = {}
for line in (TEN / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1); env[k.strip()] = v.strip()
URL = f"https://{env['SHOPIFY_SHOP_DOMAIN']}/admin/api/{env.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
def gql(q, v):
    r = urllib.request.Request(URL, data=json.dumps({"query": q, "variables": v}).encode(),
        headers={"Content-Type": "application/json", "X-Shopify-Access-Token": env["SHOPIFY_ADMIN_ACCESS_TOKEN"]})
    return json.loads(urllib.request.urlopen(r).read().decode())

BAL = """query($id:ID!){customer(id:$id){storeCreditAccounts(first:5){nodes{balance{amount currencyCode}}}}}"""
DEBIT = """mutation($id:ID!,$in:StoreCreditAccountDebitInput!){storeCreditAccountDebit(id:$id,debitInput:$in){
  storeCreditAccountTransaction{__typename} userErrors{field message}}}"""
CREDIT = """mutation($id:ID!,$in:StoreCreditAccountCreditInput!){storeCreditAccountCredit(id:$id,creditInput:$in){
  storeCreditAccountTransaction{...on StoreCreditAccountCreditTransaction{expiresAt account{balance{amount}}}} userErrors{field message}}}"""
def live_balance(gid):
    n = gql(BAL, {"id": gid})["data"]["customer"]["storeCreditAccounts"]["nodes"]
    return (round(sum(float(x["balance"]["amount"]) for x in n), 2), (n[0]["balance"]["currencyCode"] if n else "BRL"))

def credit_with_retry(gid, amt, cur, tries=5):
    for t in range(tries):
        try:
            r = gql(CREDIT, {"id": gid, "in": {"creditAmount": {"amount": f"{amt:.2f}", "currencyCode": cur},
                    "expiresAt": EXPIRES, "notify": False}})
            ue = r.get("data", {}).get("storeCreditAccountCredit", {}).get("userErrors")
            if not ue: return True, r
        except Exception as e:
            log(f"    credit try {t}: {repr(e)[:80]}")
        time.sleep(2 * (t + 1))
    return False, None

def holders():
    seen = set(); out = []
    for line in SENDS.open(encoding="utf-8"):
        o = json.loads(line)
        if o.get("wave") in WAVES and o.get("arm") == "SEND" and o.get("customer_gid") not in seen:
            seen.add(o["customer_gid"]); out.append(o["customer_gid"])
    return out

def recover():
    if not PENDING.exists(): log("no pending recredits."); return
    rows = [json.loads(l) for l in PENDING.open(encoding="utf-8") if l.strip()]
    log(f"recovering {len(rows)} debited-but-not-credited accounts")
    left = []
    for r in rows:
        ok, _ = credit_with_retry(r["gid"], r["amount"], r.get("cur", "BRL"))
        if ok: log(f"  recredited R${r['amount']} -> {r['gid']}")
        else: left.append(r); log(f"  STILL FAILING {r['gid']}")
    PENDING.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in left), encoding="utf-8")
    log(f"done. {len(left)} still pending.")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true"); ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--recover", action="store_true")
    args = ap.parse_args()
    if args.recover: recover(); return

    gids = holders()
    done = set(json.loads(STATE.read_text()) if STATE.exists() else [])
    todo = [g for g in gids if g not in done]
    if args.limit: todo = todo[:args.limit]
    log(f"issued-credit gids (SEND, both waves): {len(gids)} | already extended: {len(done)} | to check: {len(todo)}")

    if not args.apply:
        # dry: sample live balances to estimate holders
        sample = todo[:200]; live = 0; tot = 0.0
        for g in sample:
            b, _ = live_balance(g)
            if b > 0: live += 1; tot += b
        log(f"  [dry] of first {len(sample)}: {live} have live balance, R${tot:,.2f}. Re-run --apply.")
        return

    ext = 0; skip0 = 0; err = 0; pend = 0
    pf = PENDING.open("a", encoding="utf-8")
    for i, gid in enumerate(todo, 1):
        try:
            bal, cur = live_balance(gid)
            if bal <= 0: done.add(gid); skip0 += 1; continue
            dr = gql(DEBIT, {"id": gid, "in": {"debitAmount": {"amount": f"{bal:.2f}", "currencyCode": cur}}})
            due = dr.get("data", {}).get("storeCreditAccountDebit", {}).get("userErrors")
            if due: err += 1; log(f"  [debit err] {gid}: {due}"); continue
            ok, cr = credit_with_retry(gid, bal, cur)
            if not ok:
                pf.write(json.dumps({"gid": gid, "amount": bal, "cur": cur}, ensure_ascii=False) + "\n"); pf.flush()
                pend += 1; log(f"  [PENDING recredit] {gid} R${bal:.2f} debited, credit failed -> pending-recredit.jsonl")
                continue
            ext += 1; done.add(gid)
        except Exception as e:
            err += 1; log(f"  [err] {gid}: {repr(e)[:100]}")
        if i % 50 == 0:
            STATE.write_text(json.dumps(sorted(done))); log(f"  {i}/{len(todo)} extended={ext} skip0={skip0} err={err} pending={pend}"); time.sleep(0.5)
    pf.close(); STATE.write_text(json.dumps(sorted(done)))
    log(f"\n[done] extended={ext}, zero-balance skipped={skip0}, err={err}, pending-recredit={pend}")

if __name__ == "__main__":
    main()
