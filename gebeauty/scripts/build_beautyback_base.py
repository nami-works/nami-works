"""
Build a BEAUTYBACK base: every customer whose MOST RECENT order was placed in a
date window, with their cashback credit computed under the live BEAUTYBACK policy.

This is read-only: it scans customers + their lastOrder, computes credits, and
writes an xlsx. It mints NO codes and touches NO Shopify state. Use
cashback_generate.py for actual issuance.

Policy (same defaults as cashback_generate.py):
  cashback     = 20% of the last order subtotal
  min_purchase = 4 × cashback  (cashback covers 25% of the next order)
  type         = 'fixed' if min_purchase ≤ R$ 200 else 'percentage' (flat 25%)
  floor        = cashback below R$ 10 is flagged not-issuable

Window default: 2026-01-01 .. 2026-04-30 inclusive, evaluated on the order's
America/Sao_Paulo (UTC-3) calendar date, since "placed in" means the BR date.

Usage:
  python scripts/build_beautyback_base.py
  python scripts/build_beautyback_base.py --start 2026-01-01 --end 2026-04-30 --include-unpaid
"""

import argparse
import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _cashback_lib import (
    compute_cashback,
    compute_min_purchase,
    normalize_phone_br,
    pick_discount_type,
    storefront_link,
    write_final_xlsx,
)
# Reuse the validated query + throttle-aware client from the recovered generator.
from cashback_generate import CUSTOMERS_QUERY, DEFAULTS, graphql

BRT = dt.timezone(dt.timedelta(hours=-3))

# Base columns: the BEAUTYBACK xlsx shape plus the order context that justifies the credit.
HEADERS = [
    "First Name", "Email", "Telefone oficial",
    "Last Order Date (BRT)", "Last Order Subtotal", "Financial Status",
    "Cashback", "Compra mínima", "Tipo", "Issuable", "Customer GID",
]


def parse_processed_at(value):
    """Shopify ISO timestamp -> BRT date (or None)."""
    if not value:
        return None
    iso = value.replace("Z", "+00:00")
    try:
        return dt.datetime.fromisoformat(iso).astimezone(BRT).date()
    except ValueError:
        return None


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--start", default="2026-01-01", help="Window start, inclusive (BRT date).")
    p.add_argument("--end", default="2026-04-30", help="Window end, inclusive (BRT date).")
    p.add_argument("--cashback-pct", type=float, default=DEFAULTS["cashback_pct"])
    p.add_argument("--redeem-pct", type=float, default=DEFAULTS["redeem_pct"])
    p.add_argument("--min-purchase-cap", type=float, default=DEFAULTS["min_purchase_cap_brl"])
    p.add_argument("--min-cashback-brl", type=float, default=DEFAULTS["min_cashback_brl"])
    p.add_argument("--include-unpaid", action="store_true",
                   help="Also include customers whose last order is not PAID (flagged in the sheet).")
    p.add_argument("--output", default=str(Path(__file__).resolve().parent.parent / "beautyback-base_jan-apr-2026.xlsx"))
    args = p.parse_args()

    start = dt.date.fromisoformat(args.start)
    end = dt.date.fromisoformat(args.end)

    print("=== BEAUTYBACK base builder (read-only) ===")
    print(f"  window         : {start} .. {end} (BRT, inclusive)")
    print(f"  cashback %     : {args.cashback_pct * 100:.1f}%   redeem %: {args.redeem_pct * 100:.1f}%")
    print(f"  min-purch cap  : R$ {args.min_purchase_cap:.2f}   floor: R$ {args.min_cashback_brl:.2f}")
    print(f"  unpaid         : {'INCLUDED (flagged)' if args.include_unpaid else 'excluded'}")
    print(f"  output         : {args.output}")
    print()

    page_size = 250
    cursor = None
    page = 0
    scanned = 0
    rows = []
    # Diagnostics
    n_no_order = n_out_of_window = n_unpaid = 0
    n_in_window_paid = 0
    n_below_floor = 0
    sum_cashback = 0.0
    type_counts = {"fixed": 0, "percentage": 0}

    while True:
        page += 1
        result = graphql(CUSTOMERS_QUERY, {"first": page_size, "after": cursor})
        if "errors" in result:
            raise RuntimeError(f"GraphQL errors on page {page}: {result['errors']}")
        conn = result["data"]["customers"]
        for edge in conn["edges"]:
            scanned += 1
            node = edge["node"]
            lo = node.get("lastOrder")
            if not lo:
                n_no_order += 1
                continue
            od = parse_processed_at(lo.get("processedAt"))
            if od is None or od < start or od > end:
                n_out_of_window += 1
                continue
            status = lo.get("displayFinancialStatus")
            is_paid = status == "PAID"
            if not is_paid and not args.include_unpaid:
                n_unpaid += 1
                continue

            try:
                subtotal = float(lo["subtotalPriceSet"]["shopMoney"]["amount"])
            except (KeyError, TypeError, ValueError):
                subtotal = 0.0
            if subtotal <= 0:
                continue

            if is_paid:
                n_in_window_paid += 1

            cashback = round(compute_cashback(subtotal, args.cashback_pct), 2)
            min_purchase = round(compute_min_purchase(cashback, args.redeem_pct), 2)
            dtype = pick_discount_type(min_purchase, args.min_purchase_cap)
            issuable = is_paid and cashback >= args.min_cashback_brl
            if is_paid:
                if cashback < args.min_cashback_brl:
                    n_below_floor += 1
                else:
                    sum_cashback += cashback
                    type_counts[dtype] += 1

            first_name = (node.get("firstName") or "").strip()
            email = (node.get("email") or "").strip()
            raw_phone = node.get("phone") or (node.get("defaultAddress") or {}).get("phone")
            phone = normalize_phone_br(raw_phone)

            rows.append([
                first_name, email, phone,
                od.isoformat(), round(subtotal, 2), status,
                cashback, min_purchase, dtype, "yes" if issuable else "no",
                node["id"],
            ])

        if scanned % 5000 < page_size:
            print(f"  [scan] page={page} scanned={scanned} in-window-paid={n_in_window_paid} rows={len(rows)}")

        pi = conn["pageInfo"]
        if not pi["hasNextPage"]:
            break
        cursor = pi["endCursor"]

    # Sort the base by cashback value, biggest first (most valuable winbacks on top).
    rows.sort(key=lambda r: r[6], reverse=True)
    # Write directly with our own 11-col header (the lib's write_final_xlsx stamps a
    # different 7-col header meant for the issuance sheet).
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "base"
    ws.append(HEADERS)
    for row in rows:
        ws.append(row)
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    wb.save(args.output)

    issuable_rows = [r for r in rows if r[9] == "yes"]
    print()
    print("=== Base complete ===")
    print(f"  customers scanned        : {scanned}")
    print(f"  skipped — no order       : {n_no_order}")
    print(f"  skipped — out of window  : {n_out_of_window}")
    print(f"  skipped — unpaid         : {n_unpaid}")
    print(f"  in-window PAID           : {n_in_window_paid}")
    print(f"    below R$ {args.min_cashback_brl:.0f} floor (not issuable): {n_below_floor}")
    print(f"    issuable                       : {len(issuable_rows)}")
    print(f"      fixed  : {type_counts['fixed']}")
    print(f"      pct    : {type_counts['percentage']}")
    print(f"  total cashback liability (issuable, PAID): R$ {sum_cashback:,.2f}")
    if issuable_rows:
        avg = sum_cashback / max(len(issuable_rows), 1)
        print(f"  avg cashback per issuable customer       : R$ {avg:,.2f}")
    print(f"  rows written             : {len(rows)} -> {args.output}")


if __name__ == "__main__":
    main()
