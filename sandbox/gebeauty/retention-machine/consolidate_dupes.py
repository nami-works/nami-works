"""
Duplicate-credit consolidation (reactivation wave). Shopify won't MERGE customers who both
hold store credit, so we consolidate to ONE credit per person by zeroing the non-kept accounts.

Per duplicate phone (reactivation SEND, >1 account):
  primary (KEEP its credit) =
    - if any account was WhatsApp'd (whatsapp-saleday.jsonl): keep the value we TEXTED (that account)
    - else (email-only): keep the MOST-RECENT-ORDER account (min recency_days)
  secondaries -> debit their LIVE store-credit balance to R$0.

Result: one person, one credit = the value we issued/communicated. No compounding.
Profiles stay separate (Shopify blocks merge while credit exists).

Idempotent (live-balance 0 -> skip) + state file. DRY-RUN by default.
  python consolidate_dupes.py            # plan
  python consolidate_dupes.py --apply    # zero the secondaries
"""
import json, sys, re, argparse, time, urllib.request
from pathlib import Path
from collections import defaultdict

HERE = Path(__file__).resolve().parent
TEN = HERE.parent
SENDS = HERE / "learning" / "sends.jsonl"
SALEDAY = HERE / "learning" / "whatsapp-saleday.jsonl"
STATE = HERE / "consolidate-dupes-state.json"
WAVE = "2026-07-06-ge60d"

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
def norm(p):
    d = re.sub(r"\D", "", str(p or "")); return d[-10:] if len(d) >= 10 else d

def plan():
    wa = set()
    if SALEDAY.exists():
        for l in SALEDAY.open(encoding="utf-8"): wa.add(json.loads(l)["customer_gid"])
    byphone = defaultdict(list)
    for line in SENDS.open(encoding="utf-8"):
        o = json.loads(line)
        if o.get("wave") == WAVE and o["arm"] == "SEND" and o.get("phone"):
            byphone[norm(o["phone"])].append(o)
    out = []
    for p, recs in byphone.items():
        if len(recs) < 2: continue
        wad = [r for r in recs if r["customer_gid"] in wa]
        if wad:
            primary = max(wad, key=lambda r: r.get("credit_amount") or 0); rule = "whatsapp"
        else:
            primary = min(recs, key=lambda r: (r.get("recency_days", 99999), -(r.get("credit_amount") or 0))); rule = "recent-order"
        secondaries = [r for r in recs if r["customer_gid"] != primary["customer_gid"]]
        out.append({"phone": p, "primary": primary, "secondaries": secondaries, "rule": rule})
    return out

BAL = """query($id:ID!){customer(id:$id){storeCreditAccounts(first:5){nodes{balance{amount currencyCode}}}}}"""
DEBIT = """mutation($id:ID!,$in:StoreCreditAccountDebitInput!){storeCreditAccountDebit(id:$id,debitInput:$in){
  storeCreditAccountTransaction{...on StoreCreditAccountDebitTransaction{account{balance{amount}}}} userErrors{field message}}}"""
def live_balance(gid):
    n = gql(BAL, {"id": gid})["data"]["customer"]["storeCreditAccounts"]["nodes"]
    return sum(float(x["balance"]["amount"]) for x in n), (n[0]["balance"]["currencyCode"] if n else "BRL")

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--apply", action="store_true"); args = ap.parse_args()
    sets = plan()
    n_wa = sum(1 for s in sets if s["rule"] == "whatsapp")
    log(f"duplicate sets: {len(sets)}  (whatsapp-anchored {n_wa}, recent-order {len(sets)-n_wa})")
    log(f"secondary accounts to zero: {sum(len(s['secondaries']) for s in sets)}")
    if not args.apply:
        log("\nsample plan:")
        for s in sets[:6]:
            pk = s["primary"]
            log(f"  [{s['rule']}] KEEP {pk.get('email')} R${pk.get('credit_amount')} (rec {pk.get('recency_days')}d)")
            for sec in s["secondaries"]:
                log(f"       zero  {sec.get('email')} R${sec.get('credit_amount')} (rec {sec.get('recency_days')}d)")
        log("\n[dry run] no debits. Re-run with --apply.")
        return
    done = set(json.loads(STATE.read_text()) if STATE.exists() else [])
    zeroed = 0; removed = 0.0; err = 0
    todo = [sec for s in sets for sec in s["secondaries"] if sec["customer_gid"] not in done]
    log(f"\n[apply] {len(todo)} secondary accounts to process ({len(done)} already done)")
    for i, sec in enumerate(todo, 1):
        gid = sec["customer_gid"]
        try:
            bal, cur = live_balance(gid)
            if bal <= 0:
                done.add(gid); continue
            res = gql(DEBIT, {"id": gid, "in": {"debitAmount": {"amount": f"{bal:.2f}", "currencyCode": cur}}})
            ue = res.get("data", {}).get("storeCreditAccountDebit", {}).get("userErrors")
            if ue: err += 1; log(f"  [err] {sec.get('email')}: {ue}"); continue
            zeroed += 1; removed += bal; done.add(gid)
        except Exception as e:
            err += 1; log(f"  [err] {sec.get('email')}: {repr(e)[:100]}")
        if i % 25 == 0:
            STATE.write_text(json.dumps(sorted(done))); log(f"  {i}/{len(todo)} zeroed={zeroed} err={err}"); time.sleep(0.5)
    STATE.write_text(json.dumps(sorted(done)))
    log(f"\n[done] zeroed={zeroed} accounts, removed R$ {removed:,.2f} duplicate credit, err={err}")

if __name__ == "__main__":
    main()
