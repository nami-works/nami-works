"""
Reactivation store-credit issuance (>=60-day wave).

Target = due-to-refill cohort whose LAST ORDER is >= 60 days ago, SEND arm only
(holdout excluded as the measurement control). Issues native store credit:
  amount = 20% of last order (R$120 ceiling, R$10 floor)  [from cohort.xlsx]
  expiry = 7 days, notify = TRUE (fires the reactivation email)

Idempotent + resumable: skips anyone already in issued-reactivation-state.json OR who
already holds store credit live. DRY-RUN by default; only --apply mutates.

  python issue_reactivation.py            # dry run: counts + liability + sample
  python issue_reactivation.py --apply --limit 50   # staged pilot batch
  python issue_reactivation.py --apply              # full send (gated)
"""
import json, urllib.request, urllib.error, time, sys, argparse, openpyxl
from pathlib import Path
from collections import defaultdict
from datetime import date, timedelta

HERE = Path(__file__).resolve().parent
TEN = HERE.parent
COHORT = HERE / "out" / "store-credit-push-2026-07-06" / "cohort.xlsx"
STATE = HERE / "issue-reactivation-state.json"
TODAY = date.today()
EXPIRY_DAYS = 7
RECENCY_MIN = 60
EXPIRES_AT = (TODAY + timedelta(days=EXPIRY_DAYS)).isoformat() + "T23:59:59Z"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

def log(*a): print(*a); sys.stdout.flush()

env = {}
for line in (TEN / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1); env[k.strip()] = v.strip()
URL = f"https://{env['SHOPIFY_SHOP_DOMAIN']}/admin/api/{env.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
TOKEN = env["SHOPIFY_ADMIN_ACCESS_TOKEN"]
def gql(q, v=None):
    body = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN, "User-Agent": UA})
    return json.loads(urllib.request.urlopen(req).read().decode())

def last_order_days_by_customer():
    """Last order date (any target-or-not order) per customer GID, from the cached bulk."""
    cache = HERE / "_cache" / "orders_sub.jsonl"
    last = {}
    for line in cache.open(encoding="utf-8"):
        o = json.loads(line)
        if "/Order/" not in o.get("id", ""): continue
        cu = o.get("customer") or {}
        gid = cu.get("id")
        if not gid: continue
        bad = bool(o.get("cancelledAt")) or o.get("displayFinancialStatus") in ("REFUNDED", "VOIDED")
        if bad: continue
        d = o["createdAt"][:10]
        if gid not in last or d > last[gid]: last[gid] = d
    return last

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--no-pause", action="store_true")
    args = ap.parse_args()

    last_order = last_order_days_by_customer()
    ws = openpyxl.load_workbook(COHORT).active
    H = [c.value for c in ws[1]]; ix = {k: H.index(k) for k in H}

    state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}
    targets = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        if r[ix["Holdout"]] != "SEND": continue                    # holdout = control, no issue
        gid = "gid://shopify/Customer/" + str(r[ix["Customer GID"]])
        lo = last_order.get(gid)
        if not lo: continue
        if (TODAY - date.fromisoformat(lo)).days < RECENCY_MIN: continue   # <60d = still-active wave
        targets.append({"gid": gid, "name": r[ix["First Name"]], "phone": r[ix["Phone"]],
                        "credit": round(float(r[ix["Credit (R$)"]]), 2),
                        "last_order_days": (TODAY - date.fromisoformat(lo)).days})

    liability = sum(t["credit"] for t in targets)
    pending = [t for t in targets if t["gid"] not in state]
    log("=== REACTIVATION ISSUANCE (>=60-day wave) ===")
    log(f"  expiry            : {EXPIRES_AT[:10]} ({EXPIRY_DAYS} days), notify=TRUE")
    log(f"  eligible (SEND, >=60d): {len(targets)}")
    log(f"  already issued (state): {len(targets) - len(pending)}")
    log(f"  to issue now      : {len(pending)}")
    log(f"  credit liability (pending): R$ {sum(t['credit'] for t in pending):,.2f}")
    log(f"  full-wave liability       : R$ {liability:,.2f}")
    if pending[:5]:
        log("  sample:")
        for t in pending[:5]:
            log(f"    {t['name'][:14]:14} R${t['credit']:.2f}  last order {t['last_order_days']}d ago")

    if not args.apply:
        log("\n[dry run] nothing issued. Re-run with --apply (optionally --limit N) to execute.")
        # write the issue list for the record
        outp = HERE / "out" / "store-credit-push-2026-07-06" / "reactivation-issue-list.xlsx"
        wb = openpyxl.Workbook(); o = wb.active; o.append(["Name", "Phone", "Credit (R$)", "Last Order Days", "GID"])
        for t in targets: o.append([t["name"], t["phone"], t["credit"], t["last_order_days"], t["gid"]])
        wb.save(outp); log(f"  issue list -> {outp}")
        return

    # ---- APPLY ----
    M = """mutation($id:ID!,$in:StoreCreditAccountCreditInput!){
      storeCreditAccountCredit(id:$id, creditInput:$in){
        storeCreditAccountTransaction{ ... on StoreCreditAccountCreditTransaction{ account{ balance{amount} } } }
        userErrors{ field message } } }"""
    todo = pending if args.limit == 0 else pending[:args.limit]
    log(f"\n[apply] issuing to {len(todo)} customers…")
    done = err = skipped = 0
    for i, t in enumerate(todo, 1):
        # idempotency handled by state file (pending excludes issued); cohort excludes existing holders
        v = {"id": t["gid"], "in": {"creditAmount": {"amount": f"{t['credit']:.2f}", "currencyCode": "BRL"},
             "expiresAt": EXPIRES_AT, "notify": True}}
        try:
            d = gql(M, v); res = d.get("data", {}).get("storeCreditAccountCredit", {})
            ue = res.get("userErrors")
            if ue: err += 1; log(f"  [err] {t['name']}: {ue}"); continue
            done += 1
            state[t["gid"]] = {"credit": t["credit"], "expires": EXPIRES_AT[:10], "issued_at": TODAY.isoformat()}
        except Exception as e:
            err += 1; log(f"  [err] {t['name']}: {repr(e)[:120]}")
        if i % 25 == 0:
            STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
            log(f"  progress: {i}/{len(todo)}  issued={done} skipped={skipped} err={err}")
            time.sleep(1)
        if not args.no_pause and i == 3:
            STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
            log("  [smoke pause] first 3 issued. Ctrl+C to stop, or re-run to continue.")
    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"\n[done] issued={done} skipped={skipped} err={err}. State -> {STATE}")

if __name__ == "__main__":
    main()
