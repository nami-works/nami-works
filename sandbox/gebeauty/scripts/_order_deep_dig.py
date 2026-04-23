"""Deeper targeted comparison of the two order JSONs.

Pulls out the fields a Brazilian ERP integration typically keys off
and prints them side-by-side.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
import sys
_a = sys.argv[1] if len(sys.argv) > 1 else "77777"
_b = sys.argv[2] if len(sys.argv) > 2 else "77776"
A = json.loads((ROOT / f"_order_{_a}.json").read_text(encoding="utf-8"))
B = json.loads((ROOT / f"_order_{_b}.json").read_text(encoding="utf-8"))
LA = f"#{_a}"
LB = f"#{_b}"


def section(title):
    print(f"\n===== {title} =====")


def kv(label, a, b):
    print(f"  {label:40s}  #77777: {a!r:60s}  #77776: {b!r}")


section("NOTE ATTRIBUTES — full dump")
print("  --- #77777 (Hexagon) ---")
for n in A.get("note_attributes", []):
    print(f"    {n['name']!r:45s} = {n['value']!r}")
print("  --- #77776 (Web) ---")
for n in B.get("note_attributes", []):
    print(f"    {n['name']!r:45s} = {n['value']!r}")


def name_set(order):
    return {n["name"] for n in order.get("note_attributes", [])}


section("NOTE ATTRIBUTES — key diff")
a_set = name_set(A)
b_set = name_set(B)
print(f"  only in #77777: {sorted(a_set - b_set)}")
print(f"  only in #77776: {sorted(b_set - a_set)}")
print(f"  shared:         {sorted(a_set & b_set)}")


section("TRANSACTIONS / FINANCIAL")
kv("financial_status", A.get("financial_status"), B.get("financial_status"))
kv("fulfillment_status", A.get("fulfillment_status"), B.get("fulfillment_status"))
kv("gateway", A.get("gateway"), B.get("gateway"))
kv("payment_gateway_names", A.get("payment_gateway_names"), B.get("payment_gateway_names"))
kv("processing_method", A.get("processing_method"), B.get("processing_method"))
kv("currency", A.get("currency"), B.get("currency"))
kv("presentment_currency", A.get("presentment_currency"), B.get("presentment_currency"))
kv("test", A.get("test"), B.get("test"))
kv("taxes_included", A.get("taxes_included"), B.get("taxes_included"))
kv("tax_lines (count)", len(A.get("tax_lines", [])), len(B.get("tax_lines", [])))
kv("total_tax", A.get("total_tax"), B.get("total_tax"))
kv("total_discounts", A.get("total_discounts"), B.get("total_discounts"))
kv("total_outstanding", A.get("total_outstanding"), B.get("total_outstanding"))
kv("total_tip_received", A.get("total_tip_received"), B.get("total_tip_received"))

section("DISCOUNTS")
kv("discount_applications (count)", len(A.get("discount_applications", [])), len(B.get("discount_applications", [])))
kv("discount_codes (count)", len(A.get("discount_codes", [])), len(B.get("discount_codes", [])))

section("LINE ITEMS — full comparison")
print(f"  #77777 has {len(A.get('line_items', []))} lines; #77776 has {len(B.get('line_items', []))}")
for label, order in [("#77777", A), ("#77776", B)]:
    print(f"  --- {label} lines ---")
    for li in order.get("line_items", []):
        print(
            f"    sku={li.get('sku')!r:12s}  name={li.get('name')!r:50s}  qty={li.get('quantity')}  "
            f"price={li.get('price')}  grams={li.get('grams')}  taxable={li.get('taxable')}  "
            f"requires_shipping={li.get('requires_shipping')}  product_exists={li.get('product_exists')}  "
            f"gift_card={li.get('gift_card')}  fulfillable_quantity={li.get('fulfillable_quantity')}  "
            f"fulfillment_service={li.get('fulfillment_service')!r}  "
            f"fulfillment_status={li.get('fulfillment_status')!r}"
        )
        tl = li.get("tax_lines", [])
        if tl:
            print(f"        tax_lines: {tl}")

section("BILLING ADDRESS — CPF candidates")
for label, addr in [("#77777", A.get("billing_address") or {}), ("#77776", B.get("billing_address") or {})]:
    print(f"  --- {label} ---")
    for f in ("first_name", "last_name", "company", "address1", "address2", "city", "province", "province_code", "zip", "country_code", "phone"):
        print(f"    {f:20s} = {addr.get(f)!r}")

section("SHIPPING ADDRESS — parity check")
for label, addr in [("#77777", A.get("shipping_address") or {}), ("#77776", B.get("shipping_address") or {})]:
    print(f"  --- {label} ---")
    for f in ("first_name", "last_name", "company", "address1", "address2", "city", "province", "province_code", "zip", "country_code", "phone"):
        print(f"    {f:20s} = {addr.get(f)!r}")

section("CUSTOMER — fields that matter for ERP")
for label, c in [("#77777", A.get("customer") or {}), ("#77776", B.get("customer") or {})]:
    print(f"  --- {label} ---")
    for f in ("id", "email", "phone", "first_name", "last_name", "verified_email", "tax_exempt", "state", "currency", "note"):
        print(f"    {f:20s} = {c.get(f)!r}")

section("SHIPPING LINES")
for label, order in [("#77777", A), ("#77776", B)]:
    print(f"  --- {label} ---")
    for sl in order.get("shipping_lines", []):
        print(
            f"    code={sl.get('code')!r}  title={sl.get('title')!r}  source={sl.get('source')!r}  "
            f"price={sl.get('price')}  carrier_identifier={sl.get('carrier_identifier')!r}  "
            f"requested_fulfillment_service_id={sl.get('requested_fulfillment_service_id')!r}"
        )

section("FULFILLMENTS")
kv("fulfillments (count)", len(A.get("fulfillments", [])), len(B.get("fulfillments", [])))

section("REFUNDS")
kv("refunds (count)", len(A.get("refunds", [])), len(B.get("refunds", [])))

section("MISC — fields ERP may parse")
kv("source_identifier", A.get("source_identifier"), B.get("source_identifier"))
kv("source_url", A.get("source_url"), B.get("source_url"))
kv("reference", A.get("reference"), B.get("reference"))
kv("location_id", A.get("location_id"), B.get("location_id"))
kv("user_id", A.get("user_id"), B.get("user_id"))
kv("checkout_id", A.get("checkout_id"), B.get("checkout_id"))
kv("po_number", A.get("po_number"), B.get("po_number"))
kv("merchant_of_record_app_id", A.get("merchant_of_record_app_id"), B.get("merchant_of_record_app_id"))
kv("estimated_taxes", A.get("estimated_taxes"), B.get("estimated_taxes"))
kv("buyer_accepts_marketing", A.get("buyer_accepts_marketing"), B.get("buyer_accepts_marketing"))
kv("phone (order-level)", A.get("phone"), B.get("phone"))
