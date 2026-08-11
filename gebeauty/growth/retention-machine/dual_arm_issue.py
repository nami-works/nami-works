"""
August dual-test issuance: date-arm (control 8/7 vs double-date 8/8) x timing-arm
(PAW vs fixed 1PM control), applied directly to credit issuance (H-TIMING-01 scope
flipped by Lucas 2026-08-05: no WhatsApp nudge, timing gates the notify=true issuance
itself).

Design choice over one-shot-per-slot scheduling: a single recurring "who's due right
now" poller. Every run recomputes live due-status from the cohort + state file (never
delta-since-last-run), so a missed run just catches up next time -- same no-one-left-
behind principle as every other job in this program. This also means there's exactly
ONE piece of timing logic to verify correct, vs ~50 individually-timed one-shot tasks
(the failure mode that killed H-SALEDAY-PUSH-01's control arm: a scheduled fire that
silently never happened).

Each customer's target fire moment = their date-arm's calendar fire date (8/7 or 8/8)
+ either 13:00 BRT (control) or their own PAW slot (PAW arm). Credit: notify=true,
expiresAt = actual issuance moment + 7 days (matches issue_reactivation.py precedent) --
computed relative to when THIS customer is actually issued, not a shared clock, so PAW
and control customers get equal runway regardless of what time of day they fired.

  python dual_arm_issue.py                 # dry run: who's due right now, counts only
  python dual_arm_issue.py --apply --limit 3   # smoke batch
  python dual_arm_issue.py --apply             # fire everyone currently due
"""
import json, sys, time, argparse, urllib.request, threading
from pathlib import Path
from datetime import datetime, timedelta, date, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = Path(__file__).resolve().parent
COHORT_FILE = HERE / "out" / f"store-credit-push-{date.today().isoformat()}" / "dual-arm-cohort.jsonl"
STATE = HERE / "dual-arm-issue-state.json"
LOG = HERE / "learning" / "dual-arm-sends.jsonl"
ENV_FILE = HERE.parent / ".env" if (HERE.parent / ".env").exists() else HERE.parent.parent / ".env"

# Date-arm test CANCELLED (Lucas, 2026-08-07): only the PAW-vs-control timing test remains.
# Everyone fires TODAY regardless of their old A_8-5/B_8-8 label -- that label now only
# matters for sends.jsonl provenance, never for gating when someone fires.
FIRE_DATE = date.today()
CONTROL_TIME = (12, 45)  # BRT -- moved up from 13:00 (Lucas, 2026-08-07)
EXPIRY_DAYS = 7
BRT = timezone(timedelta(hours=-3))

def log(*a): print(*a); sys.stdout.flush()

env = {}
for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1); env[k.strip()] = v.strip()
URL = f"https://{env['SHOPIFY_SHOP_DOMAIN']}/admin/api/{env.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
TOKEN = env["SHOPIFY_ADMIN_ACCESS_TOKEN"]

def gql(q, v=None):
    body = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode())

KILL_PAW = True  # Lucas, 2026-08-07: new issues surfacing -- drop the timing test entirely,
                 # fire everyone on one general slot. timing_arm/paw_slot stay in the data
                 # for record-keeping, they just no longer affect WHEN anyone fires.

def target_dt(row):
    fire_date = FIRE_DATE
    if not KILL_PAW and row["timing_arm"] == "PAW" and row["paw_slot"]:
        h, m = map(int, row["paw_slot"].split(":"))
    else:
        h, m = CONTROL_TIME
    return datetime(fire_date.year, fire_date.month, fire_date.day, h, m, tzinfo=BRT)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--no-pause", action="store_true")
    ap.add_argument("--smoke-now", type=int, default=0,
        help="issue to N people immediately regardless of target time, for a pre-fire validation batch")
    args = ap.parse_args()

    now = datetime.now(BRT)
    rows = [json.loads(l) for l in COHORT_FILE.open(encoding="utf-8")]

    # Already-issued derived from sends.jsonl ONLY -- append-only + flushed per line, survives
    # a hard kill far better than a rewritten-whole-file state.json (which corrupted once
    # already, causing 55 duplicate issuances on 2026-08-07 -- see dual-arm-dupe-correction.jsonl).
    issued_gids = set()
    if LOG.exists():
        for line in LOG.open(encoding="utf-8"):
            line = line.strip()
            if not line: continue
            try:
                issued_gids.add(json.loads(line)["customer_gid"])
            except Exception:
                continue  # defensive: skip a torn trailing line from a prior kill, never crash

    if args.smoke_now:
        due = [{**r, "_target": target_dt(r)} for r in rows if r["gid"] not in issued_gids][:args.smoke_now]
        log(f"=== SMOKE-NOW: issuing to {len(due)} people immediately, ignoring target time ===")
    else:
        due = []
        for r in rows:
            if r["gid"] in issued_gids: continue
            t = target_dt(r)
            if now >= t: due.append({**r, "_target": t})

    by_cell = {}
    for r in due:
        k = (r["date_arm"], r["timing_arm"])
        by_cell[k] = by_cell.get(k, 0) + 1

    log(f"=== DUAL-ARM ISSUANCE (now BRT: {now.isoformat()}) ===")
    log(f"  total cohort: {len(rows)}   already issued: {len(issued_gids)}   due now: {len(due)}")
    for k in sorted(by_cell): log(f"    {k}: {by_cell[k]}")
    liability = sum(r["credit"] for r in due)
    log(f"  liability (due now, pending): R$ {liability:,.2f}")
    if due[:5]:
        log("  sample:")
        for r in due[:5]:
            log(f"    {r['name'][:14]:14} {r['date_arm']} {r['timing_arm']:8} target={r['_target'].strftime('%H:%M')} R${r['credit']:.2f}")

    if not args.apply:
        log("\n[dry run] nothing issued.")
        return

    M = """mutation($id:ID!,$in:StoreCreditAccountCreditInput!){
      storeCreditAccountCredit(id:$id, creditInput:$in){
        storeCreditAccountTransaction{ ... on StoreCreditAccountCreditTransaction{ account{ balance{amount} } } }
        userErrors{ field message } } }"""
    todo = due if args.limit == 0 else due[:args.limit]
    log(f"\n[apply] issuing to {len(todo)} customers due now (concurrent, 16 workers)...")
    done = err = 0
    lock = threading.Lock()
    lf = LOG.open("a", encoding="utf-8")

    def issue_one(r):
        issued_at = datetime.now(BRT)
        expires_at = (issued_at + timedelta(days=EXPIRY_DAYS)).isoformat()
        v = {"id": r["gid"], "in": {"creditAmount": {"amount": f"{r['credit']:.2f}", "currencyCode": "BRL"},
             "expiresAt": expires_at, "notify": True}}
        try:
            d = gql(M, v); res = d.get("data", {}).get("storeCreditAccountCredit", {})
            ue = res.get("userErrors")
            if ue: return ("err", r, str(ue))
            return ("ok", r, {"credit": r["credit"], "issued_at": issued_at.isoformat(), "expires_at": expires_at})
        except Exception as e:
            return ("err", r, repr(e)[:120])

    with ThreadPoolExecutor(max_workers=16) as ex:
        futs = {ex.submit(issue_one, r): r for r in todo}
        for i, fut in enumerate(as_completed(futs), 1):
            status, r, payload = fut.result()
            with lock:
                if status == "err":
                    err += 1; log(f"  [err] {r['name']}: {payload}")
                else:
                    done += 1
                    lf.write(json.dumps({"customer_gid": r["gid"], "date_arm": r["date_arm"], "timing_arm": r["timing_arm"],
                        "paw_slot": r.get("paw_slot"), "target": r["_target"].isoformat(), "issued_at": payload["issued_at"],
                        "credit": r["credit"], "expires_at": payload["expires_at"]}, ensure_ascii=False) + "\n"); lf.flush()
                if i % 50 == 0:
                    log(f"  progress: {i}/{len(todo)} issued={done} err={err}")
    lf.close()
    log(f"\n[done] issued={done} err={err}. Issued-so-far derived live from {LOG}")

if __name__ == "__main__":
    main()
