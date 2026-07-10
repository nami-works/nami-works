"""Summarize the 4 orders being redrafted: line items, shipping, discounts, totals.

Reads the already-fetched _order_<name>.json files and prints a tight plan
suitable for user approval before we create draft orders.
"""
import json
from pathlib import Path

ORDERS = ["77351", "77348", "77336", "77327"]
CPF = {
    "77351": "66512514149",
    "77348": "16885963801",
    "77336": "29410777828",
    "77327": "41311124420",
}
DIR = Path(__file__).parent


def money(s):
    try:
        return f"R${float(s):,.2f}"
    except Exception:
        return str(s)


def analyze(name):
    path = DIR / f"_order_{name}.json"
    o = json.loads(path.read_text(encoding="utf-8"))
    cust = o.get("customer") or {}
    ba = o.get("billing_address") or {}
    sa = o.get("shipping_address") or {}

    lines = o.get("line_items") or []
    ships = o.get("shipping_lines") or []
    das = o.get("discount_applications") or []
    dc = o.get("discount_codes") or []

    print(f"\n=== Order #{name} ===")
    print(f"  customer: {cust.get('first_name')} {cust.get('last_name')} <{cust.get('email')}>   customer_id={cust.get('id')}")
    print(f"  source:   {o.get('source_name')}  financial_status={o.get('financial_status')}  fulfillment_status={o.get('fulfillment_status')}")
    print(f"  currency: {o.get('currency')}  taxes_included={o.get('taxes_included')}")
    print(f"  totals:   subtotal={money(o.get('subtotal_price'))}  discount={money(o.get('total_discounts'))}  shipping={money(o.get('total_shipping_price_set', {}).get('shop_money', {}).get('amount') or (ships[0]['price'] if ships else 0))}  tax={money(o.get('total_tax'))}  TOTAL={money(o.get('total_price'))}")
    print(f"  billing.company (existing) : {ba.get('company')!r}  -> target CPF {CPF[name]}")
    print(f"  shipping.company           : {sa.get('company')!r}")

    print(f"  line_items ({len(lines)}):")
    for li in lines:
        print(f"    - qty={li.get('quantity')}  variant_id={li.get('variant_id')}  price={money(li.get('price'))}  title={li.get('name')!r}")
        li_das = li.get("discount_allocations") or []
        for a in li_das:
            print(f"        discount_alloc amount={money(a.get('amount'))} dai={a.get('discount_application_index')}")

    print(f"  shipping_lines ({len(ships)}):")
    for s in ships:
        print(f"    - title={s.get('title')!r}  code={s.get('code')!r}  price={money(s.get('price'))}  carrier={s.get('carrier_identifier')!r}")

    print(f"  discount_applications ({len(das)}):")
    for d in das:
        print(f"    - type={d.get('type')} code={d.get('code')!r} title={d.get('title')!r} value={d.get('value')} value_type={d.get('value_type')} target_type={d.get('target_type')} target_selection={d.get('target_selection')} allocation={d.get('allocation_method')}")
    print(f"  discount_codes: {dc}")

    return o


def main():
    for n in ORDERS:
        analyze(n)


if __name__ == "__main__":
    main()
