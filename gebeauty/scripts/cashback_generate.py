"""
Issue BEAUTYBACK cashback codes for gebeauty customers.

Cashback policy (defaults; all overridable via CLI):
  - cashback   = 20% of customer's most recent paid order subtotal
  - min_purch  = 4 × cashback  (== cashback / 25%)
  - if min_purch ≤ R$ 200 (cap)   → fixed-R$ code, min_purch enforced
  - if min_purch  > R$ 200 (cap)  → flat 25% percentage code, no min enforced

Recurring delta: state lives at gebeauty/cashback/state.json.
A customer is processed iff their `lastOrder.id` differs from what we issued
last time. First run = full backfill. Re-runs = only deltas.

Output: G:\\Drives compartilhados\\GEB_E-commerce\\Cashback manual\\cashback_nami-works.xlsx
        (single tab 'final', columns identical to existing fev26 sheet, including Link).

Smoke checkpoint: on a live run, the script pauses after the first --pause-after
successful creates and prints admin URLs for review. Press Enter to continue,
Ctrl+C to abort. State is flushed per-create so abort is always safe.

Usage:
  python scripts/cashback_generate.py --campaign-id 2026-04-cashback --expiry-days 10
  python scripts/cashback_generate.py --campaign-id smoke --dry-run --limit 5
  python scripts/cashback_generate.py --campaign-id ... --no-pause          # unattended

Requires: openpyxl (`pip install openpyxl`).
See gebeauty/actions-unlocked/issue-beautyback-cashback.md for the playbook.

NOTE: Reconstructed 2026-06-30 from scripts/__pycache__/cashback_generate.cpython-314.pyc
after the source was lost from disk (untracked file, removed by a tree clean).
Behaviour is faithful to the compiled bytecode; only comments were re-added.
"""

import argparse
import datetime as dt
import json
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

# Windows consoles default to cp1252; force UTF-8 so the → / R$ glyphs print.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _cashback_lib import (
    admin_link_from_gid,
    build_discount_input,
    compute_cashback,
    compute_min_purchase,
    load_env,
    load_state,
    normalize_phone_br,
    pick_discount_type,
    random_code,
    save_state,
    storefront_link,
    write_final_xlsx,
)

GEBEAUTY_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = GEBEAUTY_ROOT / ".env"
DEFAULT_STATE_PATH = GEBEAUTY_ROOT / "cashback" / "state.json"
DEFAULT_OUTPUT_PATH = Path("G:\\Drives compartilhados\\GEB_E-commerce\\Cashback manual\\cashback_nami-works.xlsx")

DEFAULTS = {
    "cashback_pct": 0.2,
    "redeem_pct": 0.25,
    "min_purchase_cap_brl": 200.0,
    "min_cashback_brl": 10.0,
    "expiry_days": 10,
    "code_prefix": "BEAUTYBACK",
    "pause_after": 3,
    "page_size": 50,
}

ENV = load_env(ENV_PATH)
SHOP_DOMAIN = ENV["SHOPIFY_SHOP_DOMAIN"]
API_VERSION = ENV["SHOPIFY_API_VERSION"]
TOKEN = ENV["SHOPIFY_ADMIN_ACCESS_TOKEN"]
SHOP_HANDLE = ENV.get("SHOPIFY_SHOP_NAME", SHOP_DOMAIN.split(".")[0])
GRAPHQL_URL = f"https://{SHOP_DOMAIN}/admin/api/{API_VERSION}/graphql.json"


def graphql(query, variables=None, retries=3):
    """POST a GraphQL request. Throttle-aware (mirrors update_beautyback_combines.py:36-42)."""
    body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                GRAPHQL_URL,
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "X-Shopify-Access-Token": TOKEN,
                },
            )
            with urllib.request.urlopen(req) as resp:
                result = json.loads(resp.read().decode("utf-8"))
            available = (
                result.get("extensions", {})
                .get("cost", {})
                .get("throttleStatus", {})
                .get("currentlyAvailable", 4000)
            )
            if available < 200:
                print(f"  [throttle] available={available}, sleeping 2s...")
                time.sleep(2)
            return result
        except urllib.error.URLError as e:
            last_err = e
            wait = 1.5 * (attempt + 1)
            print(f"  [warn] urllib error attempt {attempt + 1}/{retries}: {e}; sleeping {wait}s")
            time.sleep(wait)
    raise last_err


CUSTOMERS_QUERY = """
query Customers($first: Int!, $after: String) {
  customers(first: $first, after: $after, sortKey: ID) {
    edges {
      node {
        id
        firstName
        email
        phone
        defaultAddress { phone }
        lastOrder {
          id
          processedAt
          displayFinancialStatus
          subtotalPriceSet { shopMoney { amount currencyCode } }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
"""

CREATE_DISCOUNT = """
mutation CreateBasicDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
  discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
    codeDiscountNode { id }
    userErrors { field message code }
  }
}
"""

DEACTIVATE_DISCOUNT = """
mutation Deactivate($id: ID!) {
  discountCodeDeactivate(id: $id) {
    codeDiscountNode { id }
    userErrors { field message code }
  }
}
"""


def fetch_eligible_customers(*, limit, page_size):
    """Yield customer dicts whose lastOrder is PAID. No server-side query filter
    so we don't depend on Shopify search-syntax quirks; the lastOrder predicate
    is enforced in code."""
    cursor = None
    yielded = 0
    page = 0
    skipped_no_order = 0
    skipped_unpaid = 0
    while True:
        page += 1
        result = graphql(CUSTOMERS_QUERY, {"first": page_size, "after": cursor})
        if "errors" in result:
            raise RuntimeError(f"GraphQL errors on customers page {page}: {json.dumps(result['errors'])}")
        conn = result["data"]["customers"]
        for edge in conn["edges"]:
            n = edge["node"]
            lo = n.get("lastOrder")
            if not lo:
                skipped_no_order += 1
                continue
            if lo.get("displayFinancialStatus") != "PAID":
                skipped_unpaid += 1
                continue
            yield n
            yielded += 1
            if limit and yielded >= limit:
                return
        print(
            f"  [paged] page={page} yielded={yielded} skipped_no_order={skipped_no_order}"
            f" skipped_unpaid={skipped_unpaid} cumulative_eligible={yielded}"
        )
        page_info = conn["pageInfo"]
        if not page_info["hasNextPage"]:
            break
        cursor = page_info["endCursor"]


def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--campaign-id", help="Free-form id, e.g. 2026-04-cashback. Embedded in discount title.")
    parser.add_argument("--expiry-days", type=int, default=DEFAULTS["expiry_days"])
    parser.add_argument(
        "--min-purchase-cap",
        type=float,
        default=DEFAULTS["min_purchase_cap_brl"],
        help="If 4×cashback > this, code switches to 25%% percentage (default 200).",
    )
    parser.add_argument("--cashback-pct", type=float, default=DEFAULTS["cashback_pct"])
    parser.add_argument("--redeem-pct", type=float, default=DEFAULTS["redeem_pct"])
    parser.add_argument(
        "--min-cashback-brl",
        type=float,
        default=DEFAULTS["min_cashback_brl"],
        help="Skip customers whose computed cashback is below this floor (default 10.0).",
    )
    parser.add_argument(
        "--full-export",
        action="store_true",
        help="Write xlsx from full state.json (every customer ever issued a code), not just this run's deltas.",
    )
    parser.add_argument("--code-prefix", default=DEFAULTS["code_prefix"])
    parser.add_argument(
        "--pause-after",
        type=int,
        default=DEFAULTS["pause_after"],
        help="Pause for review after first N successful creates (default 3).",
    )
    parser.add_argument("--no-pause", action="store_true", help="Skip the smoke-checkpoint pause.")
    parser.add_argument("--dry-run", action="store_true", help="No mutations, no state writes, no xlsx write.")
    parser.add_argument("--limit", type=int, help="Cap number of customers processed.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT_PATH))
    parser.add_argument("--state-path", default=str(DEFAULT_STATE_PATH))
    args = parser.parse_args()

    print("=== BEAUTYBACK cashback issuance ===")
    print(f"  campaign       : {args.campaign_id}")
    print(f"  expiry         : {args.expiry_days} days")
    print(f"  min-purchase $ : R$ {args.min_purchase_cap:.2f}")
    print(f"  cashback %     : {args.cashback_pct * 100:.1f}%")
    print(f"  redeem %       : {args.redeem_pct * 100:.1f}%")
    print(f"  min cashback   : R$ {args.min_cashback_brl:.2f}")
    print(f"  export mode    : {'FULL (state.json)' if args.full_export else 'DELTA (this run only)'}")
    print(f"  mode           : {'DRY RUN' if args.dry_run else 'LIVE'}")
    print(f"  state          : {args.state_path}")
    print(f"  output xlsx    : {args.output}")
    print(f"  shop           : {SHOP_DOMAIN} (api {API_VERSION})")

    state = load_state(args.state_path)

    starts_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    ends_at = starts_at + dt.timedelta(days=args.expiry_days)
    starts_iso = starts_at.isoformat()
    ends_iso = ends_at.isoformat()

    rows = []
    created = []
    skipped_reasons = Counter()
    superseded = 0
    errors = 0
    considered = 0
    unchanged = 0
    paused_done = False

    code_prefix = args.code_prefix
    seen = set()

    def fresh_code():
        """Mint a random code, retrying on the (vanishingly unlikely) collision."""
        for _ in range(8):
            c = random_code(code_prefix)
            if c not in seen:
                seen.add(c)
                return c
        raise RuntimeError("Exhausted code-generation retries (collision storm — investigate).")

    for cust in fetch_eligible_customers(limit=args.limit, page_size=DEFAULTS["page_size"]):
        considered += 1
        cust_gid = cust["id"]
        last_order = cust["lastOrder"]
        last_order_id = last_order["id"]

        first_name = (cust.get("firstName") or "").strip()
        raw_phone = cust.get("phone") or (cust.get("defaultAddress") or {}).get("phone")
        phone = normalize_phone_br(raw_phone)

        prev = state.get(cust_gid)
        if prev and prev.get("last_order_id") == last_order_id and not args.dry_run:
            # Already issued for this exact last order. Keep contact details fresh
            # (phone/name can change between runs) but do not re-issue a code.
            unchanged += 1
            dirty = False
            if prev.get("phone") != phone:
                prev["phone"] = phone
                dirty = True
            if first_name and prev.get("first_name") != first_name:
                prev["first_name"] = first_name
                dirty = True
            if dirty:
                save_state(state, args.state_path)
            continue

        email = (cust.get("email") or "").strip()
        if not email:
            skipped_reasons["no_email"] += 1
            continue

        try:
            subtotal = float(last_order["subtotalPriceSet"]["shopMoney"]["amount"])
        except (KeyError, TypeError, ValueError):
            print(f"  [skip] {email}: bad subtotal payload")
            skipped_reasons["bad_subtotal"] += 1
            continue
        if subtotal <= 0:
            skipped_reasons["zero_subtotal"] += 1
            continue

        cashback = round(compute_cashback(subtotal, args.cashback_pct), 2)
        if cashback < args.min_cashback_brl:
            skipped_reasons[f"cashback_below_R${args.min_cashback_brl:.2f}"] += 1
            continue
        min_purchase = round(compute_min_purchase(cashback, args.redeem_pct), 2)
        dtype = pick_discount_type(min_purchase, args.min_purchase_cap)

        code = fresh_code()
        title = f"Beauty Back | {email}"

        if args.dry_run:
            print(
                f"  [dry] {first_name or '?':<14} <{email:<35}> phone={phone or '-':<14}"
                f" subtotal=R${subtotal:.2f} → {dtype:<10} cashback=R${cashback:.2f}"
                f" min=R${min_purchase:.2f} code={code}"
            )
            rows.append([first_name, email, phone, cashback, min_purchase, code, storefront_link(code)])
            continue

        # Supersede the customer's prior code (best effort) before minting a new one.
        if prev and prev.get("code_gid"):
            try:
                r = graphql(DEACTIVATE_DISCOUNT, {"id": prev["code_gid"]})
                ue = r.get("data", {}).get("discountCodeDeactivate", {}).get("userErrors", [])
                if ue:
                    print(f"  [warn] supersede userErrors for {email}: {ue}")
                else:
                    superseded += 1
            except Exception as e:
                print(f"  [warn] supersede exception for {email}: {e}")

        input_payload = build_discount_input(
            code, title, starts_iso, ends_iso, dtype, cashback, min_purchase, args.redeem_pct,
        )
        try:
            r = graphql(CREATE_DISCOUNT, {"basicCodeDiscount": input_payload})
        except Exception as e:
            print(f"  [error] create exception for {email}: {e}")
            errors += 1
            continue
        if "errors" in r:
            print(f"  [error] create graphql error for {email}: {r['errors']}")
            errors += 1
            continue
        payload = r.get("data", {}).get("discountCodeBasicCreate", {})
        ue = payload.get("userErrors", [])
        if ue:
            print(f"  [error] create userErrors for {email}: {ue}")
            errors += 1
            continue
        node = payload.get("codeDiscountNode", {})
        code_gid = node.get("id")
        if not code_gid:
            print(f"  [error] create returned no node id for {email}: {payload}")
            errors += 1
            continue

        state[cust_gid] = {
            "email": email,
            "first_name": first_name,
            "phone": phone,
            "last_order_id": last_order_id,
            "last_order_subtotal": subtotal,
            "last_order_at": last_order.get("processedAt"),
            "code": code,
            "code_gid": code_gid,
            "discount_type": dtype,
            "cashback": cashback,
            "min_purchase": min_purchase,
            "generated_at": starts_iso,
            "expires_at": ends_iso,
            "status": "active",
            "run_campaign_id": args.campaign_id,
        }
        save_state(state, args.state_path)
        rows.append([first_name, email, phone, cashback, min_purchase, code, storefront_link(code)])
        created.append(
            {
                "email": email,
                "first_name": first_name,
                "code": code,
                "code_gid": code_gid,
                "cashback": cashback,
                "min_purchase": min_purchase,
                "dtype": dtype,
                "admin_url": admin_link_from_gid(code_gid, SHOP_HANDLE),
            }
        )

        if len(created) % 100 == 0:
            print(f"  progress: created={len(created)} superseded={superseded} errors={errors}")

        # Smoke checkpoint: pause once after the first N creates so a human can eyeball
        # the codes in admin before the run barrels through the whole base.
        if not paused_done and not args.no_pause and len(created) >= args.pause_after:
            paused_done = True
            print()
            print(f"=== SMOKE CHECKPOINT — first {len(created)} codes created ===")
            for c in created:
                if c["dtype"] == "fixed":
                    fmt_val = f"R$ {c['cashback']:.2f} fixed (min R$ {c['min_purchase']:.2f})"
                else:
                    fmt_val = f"25% off (comm. cashback R$ {c['cashback']:.2f}, comm. min R$ {c['min_purchase']:.2f})"
                print(f"  {c['first_name'] or '?':<14} {c['email']:<35} {c['code']}")
                print(f"    {fmt_val}")
                print(f"    admin     : {c['admin_url']}")
                print(f"    storefront: {storefront_link(c['code'])}")
            print()
            print(f"State persisted to {args.state_path} ({len(state)} entries total).")
            print(f"Verify the {len(created)} codes in Shopify admin (links above).")
            print("Press Enter to continue, or Ctrl+C to abort safely (re-run resumes from state).")
            try:
                input("> ")
            except (KeyboardInterrupt, EOFError):
                print("\n[abort] State persisted; xlsx not written. Re-run to resume.")
                sys.exit(0)

    print()
    print("=== Run complete ===")
    print(f"  considered : {considered}")
    print(f"  unchanged  : {unchanged}")
    print(f"  created    : {len(created)}")
    print(f"  superseded : {superseded}")
    print(f"  errors     : {errors}")
    print(f"  skipped    : {sum(skipped_reasons.values())}")
    for reason, count in sorted(skipped_reasons.items(), key=lambda kv: kv[1]):
        print(f"    - {reason}: {count}")

    if args.dry_run:
        if rows:
            print("\n[dry run] xlsx not written. Sample rows:")
            for r in rows[:3]:
                print(f"  {r}")
        return

    if args.full_export:
        full_rows = []
        for entry in sorted(state.values(), key=lambda e: (e.get("first_name") or "").lower()):
            full_rows.append(
                [
                    entry.get("first_name") or "",
                    entry.get("email") or "",
                    entry.get("phone") or "",
                    entry.get("cashback"),
                    entry.get("min_purchase"),
                    entry.get("code"),
                    storefront_link(entry.get("code") or ""),
                ]
            )
        if not full_rows:
            print("  no rows in state; xlsx skipped.")
            return
        write_final_xlsx(full_rows, args.output)
        print(f"  xlsx       : {args.output} ({len(full_rows)} rows, FULL export from state)")
    else:
        if not rows:
            print("  no rows to write; xlsx skipped.")
            return
        write_final_xlsx(rows, args.output)
        print(f"  xlsx       : {args.output} ({len(rows)} rows, delta only)")


if __name__ == "__main__":
    main()
