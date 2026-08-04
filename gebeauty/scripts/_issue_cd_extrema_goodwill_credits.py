"""Issue ops-goodwill store credit to CD Extrema batch-1 customers, gated per-order at
delivery+7 days (Lucas's call, 2026-07-30 — the 7d covers the legal window for a return
request before we hand out a credit on an order that might still come back). Also reconciles
orders that get cancelled *after* their credit already went out (a return can land later than
the 7d gate) by clawing the credit back.

Rules (confirmed by Lucas 2026-07-30):
  credit    = 30% of order subtotal, no floor
  expiry    = 90 days from the moment each credit is issued (not from delivery)
  gate      = Fulfillment.deliveredAt + 7 days <= now, per order; cancelled orders never issue
  notify    = true (Shopify emails the customer in addition to Lucas's manual comms)
  clawback  = if an already-credited order is later cancelled, debit back
              min(originally-issued amount, customer's current live store-credit balance) —
              can't recover more than what's still on the account if some of it was spent.

Source population: gebeauty/scripts/cd-extrema-batch1-manifest.json — 552 orders / 546
customers, rebuilt 2026-07-30 from the customers tagged `atraso_extrema-jul-27` (the durable
ground truth; the original unfulfilled-status snapshot from 2026-07-29 can't be re-queried
after the fact). One credit per ORDER, not per customer — a customer with 2 batch-1 orders
gets 2 credit events.

Every real credit/debit gets appended to the canonical ledger
(gebeauty/retention-machine/learning/credit-ledger.jsonl) via credit_ledger.append_event(),
source="ops-goodwill", per repo convention.

Scope note: the clawback pass only reacts to `order.cancelledAt` (an explicit cancellation).
A full refund without a formal cancellation is NOT covered here — flag to Lucas if that needs
the same treatment.

SAFETY:
  - Default is DRY RUN. Nothing is written without --execute.
  - Idempotent: state file (issue-cd-extrema-goodwill-state.json) records every order already
    credited (and, once reversed, its clawback) so re-runs never double-act. Per-record flush,
    so Ctrl+C / a crash mid-run is always safe.
  - --max-per-run caps how many credits/debits a single (unattended, scheduled) run can act on,
    so a bug in the delivery-date or cancellation logic can't blow through the whole batch.

Usage:
  python scripts/_issue_cd_extrema_goodwill_credits.py                  # dry run, prints plan
  python scripts/_issue_cd_extrema_goodwill_credits.py --execute
  python scripts/_issue_cd_extrema_goodwill_credits.py --execute --max-per-run 50
"""
import argparse
import datetime as dt
import json
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
MANIFEST = HERE / "cd-extrema-batch1-manifest.json"
STATE = HERE / "issue-cd-extrema-goodwill-state.json"

sys.path.insert(0, str(ROOT / "retention-machine"))
from credit_ledger import append_event  # noqa: E402

PERCENT = 0.30
EXPIRY_DAYS = 90
GATE_DAYS = 7
NOTIFY = True
SOURCE = "ops-goodwill"
CAMPAIGN = "cd-extrema-delay-batch1"

env = {}
for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
URL = f"https://{env['SHOPIFY_SHOP_DOMAIN']}/admin/api/{env.get('SHOPIFY_API_VERSION', '2026-01')}/graphql.json"

ORDER_Q = """
query OrderStatus($id: ID!) {
  order(id: $id) {
    id
    cancelledAt
    displayFinancialStatus
    displayFulfillmentStatus
    fulfillments(first: 5) {
      status
      displayStatus
      deliveredAt
    }
  }
}
"""

CREDIT_MUTATION = """
mutation Credit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
  storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
    storeCreditAccountTransaction {
      id
      amount { amount currencyCode }
      balanceAfterTransaction { amount currencyCode }
    }
    userErrors { field message code }
  }
}
"""

DEBIT_MUTATION = """
mutation Debit($id: ID!, $debitInput: StoreCreditAccountDebitInput!) {
  storeCreditAccountDebit(id: $id, debitInput: $debitInput) {
    storeCreditAccountTransaction {
      id
      amount { amount currencyCode }
      balanceAfterTransaction { amount currencyCode }
    }
    userErrors { field message code }
  }
}
"""

BALANCE_Q = """
query Balance($id: ID!) {
  customer(id: $id) {
    storeCreditAccounts(first: 5) {
      nodes { balance { amount currencyCode } }
    }
  }
}
"""


def gql(query, variables=None):
    body = {"query": query}
    if variables:
        body["variables"] = variables
    req = urllib.request.Request(
        URL, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "X-Shopify-Access-Token": env["SHOPIFY_ADMIN_ACCESS_TOKEN"]},
    )
    d = json.loads(urllib.request.urlopen(req, timeout=60).read())
    cost = d.get("extensions", {}).get("cost", {}).get("throttleStatus", {}).get("currentlyAvailable")
    if cost is not None and cost < 200:
        time.sleep(1.5)
    return d


def load_state():
    if STATE.exists():
        return json.loads(STATE.read_text(encoding="utf-8"))
    return {}


def save_state(state):
    tmp = STATE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(STATE)


def order_snapshot(order_gid):
    """Return {delivered_at, cancelled_at} for an order (delivered_at = latest across its
    fulfillments, or None), or (None, errors) on failure."""
    r = gql(ORDER_Q, {"id": order_gid})
    order = r.get("data", {}).get("order")
    if not order:
        return None, r.get("errors")
    delivered = [f.get("deliveredAt") for f in (order.get("fulfillments") or []) if f.get("deliveredAt")]
    return {"delivered_at": max(delivered) if delivered else None, "cancelled_at": order.get("cancelledAt")}, None


def live_balance(customer_gid):
    r = gql(BALANCE_Q, {"id": customer_gid})
    nodes = r.get("data", {}).get("customer", {}).get("storeCreditAccounts", {}).get("nodes") or []
    if not nodes:
        return 0.0, "BRL", r.get("errors")
    return round(sum(float(n["balance"]["amount"]) for n in nodes), 2), nodes[0]["balance"]["currencyCode"], None


def reconcile_cancellations(state, args):
    """Claw back credits already issued for orders that have since been cancelled."""
    candidates = [gid for gid, v in state.items() if not v.get("reversed_at")]
    print(f"\n--- cancellation reconciliation: {len(candidates)} previously-credited orders to check ---")
    if not candidates:
        return

    def check(gid):
        return gid, order_snapshot(gid)

    cancelled = []
    with ThreadPoolExecutor(max_workers=16) as ex:
        futs = [ex.submit(check, gid) for gid in candidates]
        for fut in as_completed(futs):
            gid, (snap, err) = fut.result()
            if err:
                print(f"  ERROR checking {state[gid]['name']}: {err}")
                continue
            if snap and snap["cancelled_at"]:
                cancelled.append((gid, snap["cancelled_at"]))

    print(f"  cancelled since credit issued: {len(cancelled)}")
    if not cancelled:
        return

    to_run = cancelled[: args.max_per_run]
    if len(to_run) < len(cancelled):
        print(f"  (capped at --max-per-run {args.max_per_run}; {len(cancelled) - len(to_run)} carry over to next run)")

    for gid, cancelled_at in to_run:
        v = state[gid]
        issued_amount = float(v["amount"])
        print(f"  #{v['name']} {v.get('customer_gid')}  issued R${issued_amount}  cancelled {cancelled_at}")
        if not args.execute:
            continue
        bal, cur, err = live_balance(v["customer_gid"])
        if err:
            print(f"    ERROR reading balance: {err}")
            continue
        clawback = min(issued_amount, bal)
        now_iso = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        if clawback <= 0:
            print("    nothing to recover — credit already fully spent")
            append_event(
                ts=now_iso, event="debit", source=SOURCE, campaign=CAMPAIGN,
                customer_gid=v["customer_gid"], amount=0.0,
                notes=f"order {v['name']} cancelled ({cancelled_at}) after ops-goodwill credit issued "
                      f"{v['credited_at']}; R${issued_amount} originally issued but balance was already "
                      f"R${bal} — nothing recovered (already spent)",
            )
            v["reversed_at"] = now_iso
            v["reversed_amount"] = 0.0
            save_state(state)
            continue
        r = gql(DEBIT_MUTATION, {"id": v["customer_gid"], "debitInput": {
            "debitAmount": {"amount": f"{clawback:.2f}", "currencyCode": cur}}})
        if r.get("errors"):
            print(f"    GQL ERROR: {r['errors']}")
            continue
        data = r["data"]["storeCreditAccountDebit"]
        ue = data["userErrors"]
        tx = data.get("storeCreditAccountTransaction")
        if ue or not tx:
            print(f"    FAIL userErrors={ue}")
            continue
        partial = clawback < issued_amount
        print(f"    OK debit=R${clawback:.2f}{' (partial — rest already spent)' if partial else ''} "
              f"new balance R${tx['balanceAfterTransaction']['amount']}")
        append_event(
            ts=now_iso, event="debit", source=SOURCE, campaign=CAMPAIGN,
            customer_gid=v["customer_gid"], amount=-clawback,
            notes=f"order {v['name']} cancelled ({cancelled_at}) after ops-goodwill credit issued "
                  f"{v['credited_at']}; clawed back R${clawback:.2f} of R${issued_amount} "
                  f"originally issued" + (" (partial recovery — rest already spent)" if partial else " (full recovery)"),
        )
        v["reversed_at"] = now_iso
        v["reversed_amount"] = clawback
        save_state(state)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--execute", action="store_true", help="Actually write credits (default is dry run).")
    ap.add_argument("--max-per-run", type=int, default=100)
    args = ap.parse_args()

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    state = load_state()
    now = dt.datetime.now(dt.timezone.utc)

    reconcile_cancellations(state, args)

    pending = [o for o in manifest if o["order_gid"] not in state]
    print(f"\n--- issuance: batch-1 manifest {len(manifest)} orders | already credited: "
          f"{len(manifest) - len(pending)} | checking: {len(pending)} ---")

    not_yet_delivered = 0
    in_grace_window = 0
    already_cancelled = 0
    eligible = []

    def check(o):
        return o, order_snapshot(o["order_gid"])

    with ThreadPoolExecutor(max_workers=16) as ex:
        futs = [ex.submit(check, o) for o in pending]
        for fut in as_completed(futs):
            o, (snap, err) = fut.result()
            if err:
                print(f"  ERROR checking {o['name']}: {err}")
                continue
            if snap["cancelled_at"]:
                already_cancelled += 1
                continue
            delivered_at = snap["delivered_at"]
            if not delivered_at:
                not_yet_delivered += 1
                continue
            delivered_dt = dt.datetime.fromisoformat(delivered_at.replace("Z", "+00:00"))
            gate_at = delivered_dt + dt.timedelta(days=GATE_DAYS)
            if now < gate_at:
                in_grace_window += 1
                continue
            eligible.append({**o, "delivered_at": delivered_at})

    eligible.sort(key=lambda o: o["delivered_at"])

    print(f"  cancelled (never issuing): {already_cancelled}")
    print(f"  not yet delivered: {not_yet_delivered}")
    print(f"  delivered, still inside D+{GATE_DAYS}d grace: {in_grace_window}")
    print(f"  ELIGIBLE now: {len(eligible)}")

    if not eligible:
        print("\nNothing to issue this run.")
        return

    to_run = eligible[: args.max_per_run]
    if len(to_run) < len(eligible):
        print(f"  (capped at --max-per-run {args.max_per_run}; {len(eligible) - len(to_run)} carry over to next run)")

    total = round(sum(round(float(o["subtotal"]) * PERCENT, 2) for o in to_run), 2)
    mode = "EXECUTING" if args.execute else "DRY-RUN"
    print(f"\n=== {mode} :: {len(to_run)} credits, total R${total:.2f} ({PERCENT:.0%} of subtotal, no floor) ===")

    issued, errors = 0, 0
    for o in to_run:
        amount = round(float(o["subtotal"]) * PERCENT, 2)
        print(f"  #{o['name']} {o['customer_name']}  subtotal R${o['subtotal']}  -> credit R${amount}  "
              f"delivered {o['delivered_at'][:10]}")
        if not args.execute:
            continue
        issued_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
        expires_at = (issued_at + dt.timedelta(days=EXPIRY_DAYS)).isoformat().replace("+00:00", "Z")
        payload = {
            "creditAmount": {"amount": f"{amount:.2f}", "currencyCode": "BRL"},
            "expiresAt": expires_at,
            "notify": NOTIFY,
        }
        r = gql(CREDIT_MUTATION, {"id": o["customer_gid"], "creditInput": payload})
        if r.get("errors"):
            print(f"    GQL ERROR: {r['errors']}")
            errors += 1
            continue
        data = r["data"]["storeCreditAccountCredit"]
        ue = data["userErrors"]
        tx = data.get("storeCreditAccountTransaction")
        if ue or not tx:
            print(f"    FAIL userErrors={ue}")
            errors += 1
            continue
        print(f"    OK tx={tx['id'].rsplit('/', 1)[-1]} new balance R${tx['balanceAfterTransaction']['amount']}")

        append_event(
            ts=issued_at.isoformat().replace("+00:00", "Z"), event="issue", source=SOURCE, campaign=CAMPAIGN,
            customer_gid=o["customer_gid"], amount=amount, expires_at=expires_at,
            notes=f"order {o['name']} CD Extrema delay batch-1; delivered {o['delivered_at']}; "
                  f"credited at D+{GATE_DAYS}d gate; 30% subtotal, no floor; notify=true",
        )
        state[o["order_gid"]] = {
            "name": o["name"], "customer_gid": o["customer_gid"], "amount": amount,
            "delivered_at": o["delivered_at"], "expires_at": expires_at,
            "credited_at": issued_at.isoformat().replace("+00:00", "Z"),
        }
        save_state(state)
        issued += 1

    if args.execute:
        print(f"\n=== Done: issued {issued}, errors {errors} ===")
    else:
        print("\n[dry run] No credits written. Re-run with --execute to issue the above.")


if __name__ == "__main__":
    main()
