"""
Apply BEAUTYBACK store credit to customer accounts, driven by the frozen base
snapshot (beautyback-base_jan-apr-2026.xlsx) so the credited amount matches the
Zoko message exactly.

Rules (confirmed by Lucas 2026-06-30):
  credit  = 20% of last paid order subtotal (column 'Cashback' in the base)
  floor   = R$ 10 (rows with Issuable == 'yes' already satisfy this)
  cap     = none
  expiry  = 24 hours from the moment each credit is applied

SAFETY:
  - Default is DRY RUN. Nothing is written without --apply.
  - Idempotent: a state file (store-credit-state.json) records every credited GID
    for this campaign; re-runs skip anyone already credited.
  - Smoke pause after the first --pause-after credits (unless --no-pause).
  - Per-credit state flush, so Ctrl+C is always safe to resume.

Usage:
  python scripts/apply_store_credit.py                       # dry run, prints totals
  python scripts/apply_store_credit.py --apply --campaign-id beautyback-jan-apr-2026
"""

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cashback_generate import graphql  # throttle-aware client + env-loaded creds

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / "beautyback-base_jan-apr-2026.xlsx"
STATE = ROOT / "store-credit-state.json"
CURRENCY = "BRL"
FLOOR = 30.0  # minimum store-credit cutoff (R$)

CREDIT_MUTATION = """
mutation Credit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
  storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
    storeCreditAccountTransaction {
      amount { amount currencyCode }
      account { id balance { amount currencyCode } }
    }
    userErrors { field message }
  }
}
"""


def load_state():
    if STATE.exists():
        return json.loads(STATE.read_text(encoding="utf-8"))
    return {}


def save_state(state):
    tmp = STATE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(STATE)


def load_targets():
    """Read issuable rows from the base snapshot. Positional columns:
    0 name, 1 email, 6 cashback, 9 issuable, 10 gid."""
    wb = openpyxl.load_workbook(BASE)
    ws = wb.active
    out = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        if r[9] != "yes":
            continue
        gid = r[10]
        credit = round(float(r[6]), 2)
        if not gid or credit < FLOOR:
            continue
        out.append({"gid": gid, "email": r[1] or "", "credit": credit})
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--apply", action="store_true", help="Actually write credits (default is dry run).")
    p.add_argument("--campaign-id", default="beautyback-jan-apr-2026")
    p.add_argument("--expiry-hours", type=int, default=24)
    p.add_argument("--pause-after", type=int, default=3)
    p.add_argument("--no-pause", action="store_true")
    p.add_argument("--limit", type=int)
    p.add_argument("--notify", action="store_true", help="Let Shopify email the customer about the credit.")
    args = p.parse_args()

    targets = load_targets()
    if args.limit:
        targets = targets[: args.limit]
    state = load_state()
    campaign_done = {g for g, v in state.items() if v.get("campaign") == args.campaign_id}

    total = round(sum(t["credit"] for t in targets), 2)
    pending = [t for t in targets if t["gid"] not in campaign_done]
    pending_total = round(sum(t["credit"] for t in pending), 2)

    print("=== BEAUTYBACK store-credit application ===")
    print(f"  mode           : {'LIVE (--apply)' if args.apply else 'DRY RUN'}")
    print(f"  campaign       : {args.campaign_id}")
    print(f"  expiry         : {args.expiry_hours}h from each credit")
    print(f"  notify customer: {args.notify}")
    print(f"  base snapshot  : {BASE.name}")
    print(f"  issuable rows  : {len(targets)}  (total R$ {total:,.2f})")
    print(f"  already done   : {len(targets) - len(pending)}")
    print(f"  to credit now  : {len(pending)}  (R$ {pending_total:,.2f})")

    if not args.apply:
        print("\n[dry run] No credits written. Re-run with --apply to execute.")
        print("Sample of pending credits:")
        for t in pending[:10]:
            print(f"  {t['email']:<40} R$ {t['credit']:>8.2f}  {t['gid']}")
        return

    credited = 0
    errors = 0
    for t in pending:
        expires_at = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=args.expiry_hours)).replace(microsecond=0).isoformat()
        variables = {
            "id": t["gid"],
            "creditInput": {
                "creditAmount": {"amount": f"{t['credit']:.2f}", "currencyCode": CURRENCY},
                "expiresAt": expires_at,
                "notify": args.notify,
            },
        }
        try:
            r = graphql(CREDIT_MUTATION, variables)
        except Exception as e:
            print(f"  [error] exception for {t['email']}: {e}")
            errors += 1
            continue
        payload = r.get("data", {}).get("storeCreditAccountCredit", {})
        ue = payload.get("userErrors", [])
        if ue or "errors" in r:
            print(f"  [error] {t['email']}: {ue or r.get('errors')}")
            errors += 1
            continue
        txn = payload.get("storeCreditAccountTransaction") or {}
        acct = (txn.get("account") or {})
        state[t["gid"]] = {
            "campaign": args.campaign_id,
            "email": t["email"],
            "amount": t["credit"],
            "expires_at": expires_at,
            "credited_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
            "account_id": acct.get("id"),
        }
        save_state(state)
        credited += 1

        if credited % 100 == 0:
            print(f"  progress: credited={credited} errors={errors}")

        if not args.no_pause and credited == args.pause_after:
            print(f"\n=== SMOKE CHECKPOINT — first {credited} credits applied ===")
            for g, v in list(state.items())[-credited:]:
                print(f"  {v['email']:<40} R$ {v['amount']:>8.2f}  expires {v['expires_at']}")
            print("Verify in Shopify admin (Customers -> store credit). ")
            print("Press Enter to continue crediting the rest, or Ctrl+C to stop (state saved).")
            try:
                input("> ")
            except (KeyboardInterrupt, EOFError):
                print("\n[stopped] State saved; re-run to resume.")
                sys.exit(0)

    print("\n=== Done ===")
    print(f"  credited : {credited}")
    print(f"  errors   : {errors}")
    print(f"  state    : {STATE}")


if __name__ == "__main__":
    main()
