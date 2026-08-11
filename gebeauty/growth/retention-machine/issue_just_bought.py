"""
Real-time store-credit issuance, purchase-triggered (Lucas, 2026-08-08) -- the first
piece of "move issuance off the monthly wave and onto the purchase event itself"
(gebeauty/pending-fixes.md).

Upstream: a Shopify Flow ("Tag customer just-bought on order paid") already tags a
customer 'just-bought' the instant their order is paid. This script is the downstream
half of that pipeline, run on a schedule (every 15 min):

  1. Pull customers currently tagged 'just-bought'.
  2. Issue store credit on their most recent order, 20% rule (PCT/CEIL/FLOOR --
     same constants as store_credit_push.py, reused for consistency across every
     issuance mechanism in this program, not reinvented here).
  3. Remove 'just-bought' once handled.

3-arm expiry test (Lucas, 2026-08-08): each customer is deterministically assigned to
a 30/45/60-day expiry arm via an independent GID hash (own salt, uncorrelated with any
other arm-assignment hash in this program) and tagged with the arm so recurrency can be
tracked per arm later (query orders after issued_at, grouped by arm tag).

notify=true, reusing 'credit-goodwill' as ctx stopgap (Lucas, 2026-08-08) -- the
notification template's goodwill copy ("como forma de agradecer...") is the closest
existing fit for "you just bought, here's cashback"; a purpose-built ctx variant is a
known follow-on, not yet written.

Idempotency: derived live from an append-only ledger keyed on ORDER id (not the tag
alone) every run -- never a rewritten state file. This is the exact lesson from this
session's real production bug (dual_arm_issue.py's rewritten-whole-file state corrupted
under a mid-write kill, causing 55 duplicate issuances). If 'just-bought' is ever still
present for an order already in the ledger (e.g. a prior run issued credit but crashed
before removing the tag), this run does NOT re-issue -- it just retries the tag removal.

Confirmed 2026-08-08: Shopify's customer search index (what `tag:'just-bought'` queries
against) is eventually consistent -- a customer can still show up in this query for a
short window after tagsRemove has already succeeded. Expect "already_issued" log lines
even right after a clean run; that's the ledger doing its job, not a malfunction.

  python issue_just_bought.py            # dry run: who's tagged, counts, no writes
  python issue_just_bought.py --apply    # issue + detag for real
"""
import json, sys, time, argparse, hashlib, urllib.request
from pathlib import Path
from datetime import datetime, timedelta, timezone

HERE = Path(__file__).resolve().parent
TEN = HERE.parent
LEDGER = HERE / "learning" / "just-bought-issued.jsonl"
ENV_FILE = TEN / ".env" if (TEN / ".env").exists() else TEN.parent / ".env"

PCT = 0.20; CEIL = 120.0; FLOOR = 10.0          # same 20% rule as store_credit_push.py
ARMS = [30, 45, 60]                              # expiry-day arms under test
ARM_TAG = {30: "just-bought-credit-30d", 45: "just-bought-credit-45d", 60: "just-bought-credit-60d"}
GOODWILL_TAG = "credit-goodwill"                 # ctx stopgap for the notification template
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

def gql_retry(q, v=None, n=3):
    for a in range(n):
        try:
            d = gql(q, v)
            if "errors" in d and d["errors"]: raise RuntimeError(str(d["errors"])[:200])
            return d
        except Exception:
            if a == n - 1: raise
            time.sleep(2 * (a + 1))

def arm_for(gid):
    h = int(hashlib.md5((gid + "|realtime-expiry-arm-2026-08").encode()).hexdigest(), 16)
    return ARMS[h % 3]

Q = """query($q:String!){ customers(first:100, query:$q){ nodes{
  id tags
  orders(first:1, sortKey:CREATED_AT, reverse:true){ nodes{
    id createdAt cancelledAt displayFinancialStatus
    currentTotalPriceSet{ shopMoney{ amount } } } } } } }"""

M_CREDIT = """mutation($id:ID!,$in:StoreCreditAccountCreditInput!){
  storeCreditAccountCredit(id:$id, creditInput:$in){
    storeCreditAccountTransaction{ ... on StoreCreditAccountCreditTransaction{ account{ balance{amount} } } }
    userErrors{ field message } } }"""
M_TAG_ADD = "mutation($id:ID!,$tags:[String!]!){tagsAdd(id:$id,tags:$tags){userErrors{field message}}}"
M_TAG_RM = "mutation($id:ID!,$tags:[String!]!){tagsRemove(id:$id,tags:$tags){userErrors{field message}}}"

def load_issued_order_ids():
    done = set()
    if LEDGER.exists():
        for line in LEDGER.open(encoding="utf-8"):
            line = line.strip()
            if not line: continue
            try:
                done.add(json.loads(line)["order_id"])
            except Exception:
                continue  # defensive: never let one torn line crash the run
    return done

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    issued_order_ids = load_issued_order_ids()
    d = gql_retry(Q, {"q": "tag:'just-bought'"})
    customers = d["data"]["customers"]["nodes"]
    log(f"=== JUST-BOUGHT POLL ({datetime.now(BRT).isoformat()}) ===")
    log(f"  tagged now: {len(customers)}   already in ledger: {len(issued_order_ids)}")

    todo = []
    for c in customers:
        orders = c["orders"]["nodes"]
        if not orders:
            log(f"  [skip] {c['id']}: tagged just-bought but has no orders (shouldn't happen)")
            continue
        o = orders[0]
        if o.get("cancelledAt") or o.get("displayFinancialStatus") in ("REFUNDED", "VOIDED"):
            log(f"  [skip->detag] {c['id']}: last order {o['id']} cancelled/refunded")
            todo.append((c, o, "cancelled")); continue
        if o["id"] in issued_order_ids:
            log(f"  [already-issued->retry-detag] {c['id']}: order {o['id']} already in ledger")
            todo.append((c, o, "already_issued")); continue
        amt = float(o["currentTotalPriceSet"]["shopMoney"]["amount"])
        credit = round(min(CEIL, PCT * amt), 2)
        todo.append((c, o, "issue" if credit >= FLOOR else "skip_floor"))

    for kind in ("issue", "skip_floor", "cancelled", "already_issued"):
        n = sum(1 for _, _, k in todo if k == kind)
        if n: log(f"    {kind}: {n}")

    if not args.apply:
        log("\n[dry run] nothing issued, nothing detagged.")
        return

    lf = LEDGER.open("a", encoding="utf-8")
    done = skipped = errs = 0
    for c, o, kind in todo:
        gid, oid = c["id"], o["id"]
        try:
            if kind == "issue":
                amt = float(o["currentTotalPriceSet"]["shopMoney"]["amount"])
                credit = round(min(CEIL, PCT * amt), 2)
                arm = arm_for(gid)
                issued_at = datetime.now(BRT)
                expires_at = (issued_at + timedelta(days=arm)).isoformat()
                r = gql_retry(M_CREDIT, {"id": gid, "in": {
                    "creditAmount": {"amount": f"{credit:.2f}", "currencyCode": "BRL"},
                    "expiresAt": expires_at, "notify": True}})
                ue = r.get("data", {}).get("storeCreditAccountCredit", {}).get("userErrors")
                if ue: raise RuntimeError(str(ue))
                gql_retry(M_TAG_ADD, {"id": gid, "tags": [ARM_TAG[arm], GOODWILL_TAG]})
                gql_retry(M_TAG_RM, {"id": gid, "tags": ["just-bought"]})
                lf.write(json.dumps({"order_id": oid, "customer_gid": gid, "order_total": amt,
                    "credit": credit, "arm_days": arm, "arm_tag": ARM_TAG[arm],
                    "issued_at": issued_at.isoformat(), "expires_at": expires_at,
                    "status": "issued"}, ensure_ascii=False) + "\n"); lf.flush()
                done += 1
            elif kind == "skip_floor":
                amt = float(o["currentTotalPriceSet"]["shopMoney"]["amount"])
                gql_retry(M_TAG_RM, {"id": gid, "tags": ["just-bought"]})
                lf.write(json.dumps({"order_id": oid, "customer_gid": gid, "order_total": amt,
                    "credit": 0.0, "status": "skipped_floor",
                    "at": datetime.now(BRT).isoformat()}, ensure_ascii=False) + "\n"); lf.flush()
                skipped += 1
            elif kind in ("cancelled", "already_issued"):
                gql_retry(M_TAG_RM, {"id": gid, "tags": ["just-bought"]})
                skipped += 1
        except Exception as e:
            errs += 1
            log(f"  [err] {gid} / {oid}: {repr(e)[:150]}")
    lf.close()
    log(f"\n[done] issued={done} skipped={skipped} err={errs}. Ledger: {LEDGER}")

if __name__ == "__main__":
    main()
