"""Create 4 draft orders that replicate #77351, #77348, #77336, #77327 with
the customer CPF placed in billingAddress.company.

Reads the already-fetched _order_<name>.json files; builds a DraftOrderInput
per order; fires draftOrderCreate via GraphQL; then re-fetches each draft to
verify totalPrice and billingAddress.company.

Leaves drafts OPEN. Does NOT complete them, does NOT touch the originals.
"""
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"
DIR = Path(__file__).parent

ORDERS = [
    ("77351", "66512514149"),
    ("77348", "16885963801"),
    ("77336", "29410777828"),
    ("77327", "41311124420"),
]


def load_env():
    env = {}
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


ENV = load_env()
TOKEN = ENV["SHOPIFY_ADMIN_ACCESS_TOKEN"]
SHOP = ENV["SHOPIFY_SHOP_DOMAIN"]
VER = ENV.get("SHOPIFY_API_VERSION", "2026-01")
GQL_URL = f"https://{SHOP}/admin/api/{VER}/graphql.json"


def gql(query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    req = urllib.request.Request(GQL_URL, data=body, headers={
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def addr_input_from_rest(addr, company=None):
    """Map a REST billing_address / shipping_address to MailingAddressInput."""
    if not addr:
        return None
    out = {}
    for src, dst in [
        ("address1", "address1"),
        ("address2", "address2"),
        ("city", "city"),
        ("first_name", "firstName"),
        ("last_name", "lastName"),
        ("phone", "phone"),
        ("zip", "zip"),
        ("country_code", "countryCode"),
        ("province_code", "provinceCode"),
    ]:
        v = addr.get(src)
        if v is not None and v != "":
            out[dst] = v
    # Company: overlay CPF, or preserve existing
    if company is not None:
        out["company"] = company
    elif addr.get("company"):
        out["company"] = addr["company"]
    return out


def build_input(order, cpf):
    cust = order.get("customer") or {}
    cust_id = cust.get("id")
    ba = order.get("billing_address") or {}
    sa = order.get("shipping_address") or {}
    ships = order.get("shipping_lines") or []
    ship = ships[0] if ships else {}
    currency = order.get("currency") or "BRL"

    # Line items: variantId + quantity + priceOverride (keep historical unit price)
    line_items = []
    for li in order.get("line_items") or []:
        item = {
            "variantId": f"gid://shopify/ProductVariant/{li['variant_id']}",
            "quantity": li["quantity"],
            "priceOverride": {"amount": str(li["price"]), "currencyCode": currency},
        }
        line_items.append(item)

    # Total original discount (fixed amount)
    total_discount = float(order.get("total_discounts") or 0)
    applied_discount = None
    if total_discount > 0:
        applied_discount = {
            "title": "GEBEAUTY15",
            "description": f"Replicated from original order #{order.get('name')}",
            "valueType": "FIXED_AMOUNT",
            "value": total_discount,
        }

    # Shipping
    shipping_line = None
    if ship:
        shipping_line = {
            "title": ship.get("title") or "Envio",
            "priceWithCurrency": {
                "amount": str(ship.get("price") or "0"),
                "currencyCode": currency,
            },
        }

    # Custom attributes: mirror original note_attributes + add original_order marker
    existing_attrs = order.get("note_attributes") or []
    custom_attrs = [{"key": a["name"], "value": str(a["value"])} for a in existing_attrs if a.get("name")]
    custom_attrs.append({"key": "original_order", "value": f"#{order.get('name')}"})
    custom_attrs.append({"key": "cpf_reissue", "value": cpf})

    # Tags
    tags = [
        f"redraft-of-{order.get('name')}",
        "cpf-reissue",
        "hexagon-whatsapp",
    ]

    note = (
        f"Re-issued from order #{order.get('name')} to capture CPF {cpf} in billing "
        f"company. Original coupon: GEBEAUTY15."
    )

    payload = {
        "lineItems": line_items,
        "email": cust.get("email") or order.get("email"),
        "phone": order.get("phone") or (cust.get("phone") if cust else None),
        "billingAddress": addr_input_from_rest(ba, company=cpf),
        "shippingAddress": addr_input_from_rest(sa),
        "shippingLine": shipping_line,
        "appliedDiscount": applied_discount,
        "tags": tags,
        "note": note,
        "customAttributes": custom_attrs,
        "presentmentCurrencyCode": currency,
        "taxExempt": False,
        "useCustomerDefaultAddress": False,
    }
    if cust_id:
        payload["purchasingEntity"] = {"customerId": f"gid://shopify/Customer/{cust_id}"}

    # Strip nones
    payload = {k: v for k, v in payload.items() if v is not None}
    return payload


CREATE_MUT = """
mutation DraftCreate($input: DraftOrderInput!) {
  draftOrderCreate(input: $input) {
    draftOrder {
      id
      name
      invoiceUrl
      totalPrice
      subtotalPrice
      totalTax
      totalDiscountsSet { shopMoney { amount currencyCode } }
      totalShippingPrice
      currencyCode
      billingAddress { company address1 city zip countryCode provinceCode }
      shippingAddress { company address1 city zip }
      customer { id email firstName lastName }
      lineItems(first: 10) { nodes { title quantity variant { id } originalUnitPrice discountedUnitPrice } }
      tags
    }
    userErrors { field message }
  }
}
"""


def main():
    out_dir = DIR
    results = []
    for name, cpf in ORDERS:
        print(f"\n=== #{name} -> CPF {cpf} ===")
        order = json.loads((out_dir / f"_order_{name}.json").read_text(encoding="utf-8"))
        inp = build_input(order, cpf)
        # Save the input for audit/debug
        (out_dir / f"_draft_input_{name}.json").write_text(
            json.dumps(inp, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"  built DraftOrderInput -> _draft_input_{name}.json")

        resp = gql(CREATE_MUT, {"input": inp})
        (out_dir / f"_draft_result_{name}.json").write_text(
            json.dumps(resp, indent=2, ensure_ascii=False), encoding="utf-8")

        errs = (resp.get("data", {}).get("draftOrderCreate", {}) or {}).get("userErrors") or []
        top_errs = resp.get("errors") or []
        if errs or top_errs:
            print(f"  [FAIL] ERRORS:")
            for e in errs:
                print(f"     userError: field={e.get('field')} message={e.get('message')}")
            for e in top_errs:
                print(f"     topError : {e.get('message')}")
            results.append((name, cpf, None, None, False, errs or top_errs))
            continue

        d = resp["data"]["draftOrderCreate"]["draftOrder"]
        orig_total = float(order.get("total_price") or 0)
        new_total = float(d.get("totalPrice") or 0)
        match = abs(orig_total - new_total) < 0.01
        company = (d.get("billingAddress") or {}).get("company")
        print(f"  [OK] draft created: {d['name']}  id={d['id']}")
        print(f"     totalPrice  new=R${new_total:.2f}  target=R${orig_total:.2f}  {'MATCH' if match else 'MISMATCH'}")
        print(f"     billing.company = {company!r}  expected={cpf!r}  {'OK' if company == cpf else 'BAD'}")
        print(f"     invoice URL : {d.get('invoiceUrl')}")
        results.append((name, cpf, d["name"], d.get("invoiceUrl"), match and company == cpf, None))

    print("\n\n=== SUMMARY ===")
    for name, cpf, draft_name, url, ok, err in results:
        status = "OK " if ok else "FAIL"
        print(f"  [{status}] #{name} -> {draft_name or '(failed)'}  cpf={cpf}")
        if url:
            print(f"        invoice: {url}")
        if err:
            print(f"        errors: {err}")


if __name__ == "__main__":
    main()
