"""
Refill store-credit issuance (45-59-day still-active wave).

Target = due-to-refill cohort whose LAST ORDER is 45-59 days ago, SEND arm only
(HOLD arm is the measurement control - snapshotted, never issued). Issues native store credit:
  amount = 20% of last order (R$120 ceiling, R$10 floor)  [from cohort.xlsx]
  expiry = max(order_date + 60d, today + 3d)  -> 3-DAY GRACE FLOOR
  notify = TRUE (fires the unified store-credit email; refill = default, NO tag)

Tracking: snapshots SEND + HOLD (both arms) to learning/sends.jsonl at issuance so
measure_reactivation.py can later compute per-band SEND-vs-HOLD lift ("who's buying").

Idempotent + resumable: skips anyone already in issue-refill-state.json. DRY-RUN by default.

  python issue_refill.py                    # dry run: counts + liability + grace + sample
  python issue_refill.py --apply --limit 3  # smoke batch
  python issue_refill.py --apply            # full send (gated); smoke-pauses after 3
"""
import json, urllib.request, urllib.error, time, sys, argparse, openpyxl
from pathlib import Path
from datetime import date, timedelta

HERE = Path(__file__).resolve().parent
TEN = HERE.parent
COHORT = HERE / "out" / "store-credit-push-2026-07-06" / "cohort.xlsx"
STATE = HERE / "issue-refill-state.json"
LEARN = HERE / "learning"; LEARN.mkdir(exist_ok=True)
SENDS = LEARN / "sends.jsonl"
TODAY = date.today()
BAND_LO, BAND_HI = 45, 60          # 45 <= days_since < 60
GRACE_MIN = 3                      # every credit valid >= 3 days from today
NATURAL_DAYS = 60                  # credit valid 60 days from order
CAMPAIGN = "store-credit-stillactive"
WAVE = "2026-07-07-ge45-59d-refill"
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

def expiry_for(days_since):
    """max(order+60, today+3) -> ISO datetime. Returns (iso, hit_grace_bool)."""
    natural = NATURAL_DAYS - days_since        # days from today the order+60 falls
    d = max(natural, GRACE_MIN)
    return (TODAY + timedelta(days=d)).isoformat() + "T23:59:59Z", natural < GRACE_MIN

def load_band():
    ws = openpyxl.load_workbook(COHORT).active
    H = [c.value for c in ws[1]]; ix = {k: H.index(k) for k in H}
    send, hold = [], []
    for r in ws.iter_rows(min_row=2, values_only=True):
        d = r[ix["Days Since"]]
        if d is None or not (BAND_LO <= d < BAND_HI): continue
        rec = {"gid": "gid://shopify/Customer/" + str(r[ix["Customer GID"]]),
               "name": r[ix["First Name"]], "phone": r[ix["Phone"]],
               "credit": round(float(r[ix["Credit (R$)"]]), 2),
               "last_order": round(float(r[ix["Last Order (R$)"]]), 2),
               "anchor": r[ix["Anchor Product"]], "days_since": d}
        (send if r[ix["Holdout"]] == "SEND" else hold).append(rec)
    return send, hold

def snapshot(send, hold):
    """Freeze both arms to sends.jsonl (idempotent per wave+gid)."""
    seen = set()
    if SENDS.exists():
        for line in SENDS.open(encoding="utf-8"):
            try:
                o = json.loads(line)
                if o.get("wave") == WAVE: seen.add(o.get("customer_gid"))
            except: pass
    n = 0
    with SENDS.open("a", encoding="utf-8") as f:
        for arm, rows in (("SEND", send), ("HOLD", hold)):
            for r in rows:
                if r["gid"] in seen: continue
                exp, grace = expiry_for(r["days_since"])
                f.write(json.dumps({"wave": WAVE, "campaign": CAMPAIGN, "customer_gid": r["gid"],
                    "arm": arm, "credit": r["credit"], "expiry": exp[:10] if arm == "SEND" else None,
                    "grace_applied": grace if arm == "SEND" else None, "days_since": r["days_since"],
                    "last_order": r["last_order"], "anchor": r["anchor"], "phone": r["phone"],
                    "sent_at": TODAY.isoformat(), "redeemed": None, "repurchased": None},
                    ensure_ascii=False) + "\n")
                n += 1
    return n

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--no-pause", action="store_true")
    args = ap.parse_args()

    send, hold = load_band()
    grace_n = sum(1 for r in send if expiry_for(r["days_since"])[1])
    liability = sum(r["credit"] for r in send)
    state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}
    pending = [r for r in send if r["gid"] not in state]

    log("=== REFILL ISSUANCE (45-59-day still-active wave) ===")
    log(f"  band              : {BAND_LO}-{BAND_HI-1} days since last order")
    log(f"  expiry            : max(order+{NATURAL_DAYS}d, today+{GRACE_MIN}d)  [3-day grace floor]")
    log(f"  SEND arm          : {len(send)}   HOLD arm (control): {len(hold)}")
    log(f"  hitting grace floor: {grace_n} (expiry -> {(TODAY+timedelta(days=GRACE_MIN)).isoformat()})")
    log(f"  liability (SEND)  : R$ {liability:,.2f}   avg R$ {liability/max(1,len(send)):.2f}")
    log(f"  already issued    : {len(send)-len(pending)}   to issue now: {len(pending)}")
    if pending[:5]:
        log("  sample:")
        for r in pending[:5]:
            exp, g = expiry_for(r["days_since"])
            log(f"    {str(r['name'])[:14]:14} R${r['credit']:>6.2f}  {r['days_since']}d  exp {exp[:10]}{'  (grace)' if g else ''}")

    if not args.apply:
        log("\n[dry run] nothing issued / snapshotted. Re-run with --apply.")
        return

    snapped = snapshot(send, hold)
    log(f"\n[snapshot] wrote {snapped} new rows to sends.jsonl (SEND+HOLD, wave={WAVE})")

    M = """mutation($id:ID!,$in:StoreCreditAccountCreditInput!){
      storeCreditAccountCredit(id:$id, creditInput:$in){
        storeCreditAccountTransaction{ ... on StoreCreditAccountCreditTransaction{ account{ balance{amount} } } }
        userErrors{ field message } } }"""
    todo = pending if args.limit == 0 else pending[:args.limit]
    log(f"[apply] issuing to {len(todo)} customers (notify=TRUE, no tag = refill default)…")
    done = err = 0
    for i, r in enumerate(todo, 1):
        exp, _ = expiry_for(r["days_since"])
        v = {"id": r["gid"], "in": {"creditAmount": {"amount": f"{r['credit']:.2f}", "currencyCode": "BRL"},
             "expiresAt": exp, "notify": True}}
        try:
            d = gql(M, v); res = d.get("data", {}).get("storeCreditAccountCredit", {})
            ue = res.get("userErrors")
            if ue: err += 1; log(f"  [err] {r['name']}: {ue}"); continue
            done += 1
            state[r["gid"]] = {"credit": r["credit"], "expires": exp[:10], "issued_at": TODAY.isoformat()}
        except Exception as e:
            err += 1; log(f"  [err] {r['name']}: {repr(e)[:120]}")
        if i % 25 == 0:
            STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
            log(f"  progress: {i}/{len(todo)}  issued={done} err={err}"); time.sleep(1)
        if not args.no_pause and i == 3:
            STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
            log("  [smoke pause] first 3 issued. Re-run (same cmd) to continue the rest.")
            break
    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"\n[done] issued={done} err={err}. State -> {STATE.name}")

if __name__ == "__main__":
    main()
