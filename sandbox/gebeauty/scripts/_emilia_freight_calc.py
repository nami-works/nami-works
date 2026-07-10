"""Build a heaviest ~R$199 basket and calculate freight to Emilia's zip.

Uses draftOrderCalculate (does NOT persist a draft order). Read-only effect.
"""
import json, urllib.request, os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
URL = "https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json"


def gql(q, v=None):
    b = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    r = urllib.request.Request(URL, data=b, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(r, timeout=60).read())


# Heaviest core products to assemble the basket
WANT = ["shampoo sem sulfato", "m", "shampoo a seco"]  # match by handle below instead
HANDLES = ["shampoo-sem-sulfato", "mascara-condicionadora", "shampoo-a-seco",
           "leave-in-pluma", "primer-cachos-definidos"]

LOOKUP = """
query($q: String!) {
  products(first: 10, query: $q) {
    edges { node {
      title handle
      variants(first: 1) { edges { node {
        id title price
        inventoryItem { measurement { weight { value unit } } }
      } } }
    } }
  }
}
"""

variants = {}
for h in HANDLES:
    r = gql(LOOKUP, {"q": f"handle:{h}"})
    edges = r["data"]["products"]["edges"]
    if not edges:
        print(f"  (no product for handle {h})"); continue
    n = edges[0]["node"]
    v = n["variants"]["edges"][0]["node"]
    w = v["inventoryItem"]["measurement"]["weight"]
    variants[h] = {"id": v["id"], "title": n["title"], "price": float(v["price"]),
                   "w": w["value"], "wu": w["unit"]}
    print(f"  {n['title']:<28} {v['id'].rsplit('/',1)[-1]:<16} R${v['price']:<7} {w['value']}{w['unit']}")

# Basket: two heaviest SKUs, closest to R$199.  shampoo sem sulfato + mascara condicionadora
BASKET = [("shampoo-sem-sulfato", 1), ("mascara-condicionadora", 1)]
line_items = [{"variantId": variants[h]["id"], "quantity": q} for h, q in BASKET if h in variants]
subtotal = sum(variants[h]["price"] * q for h, q in BASKET if h in variants)
print(f"\n  BASKET subtotal: R${subtotal:.2f}  ({len(line_items)} lines)")

CALC = """
mutation($input: DraftOrderInput!) {
  draftOrderCalculate(input: $input) {
    calculatedDraftOrder {
      subtotalPriceSet { shopMoney { amount currencyCode } }
      totalShippingPriceSet { shopMoney { amount currencyCode } }
      availableShippingRates { handle title price { amount currencyCode } }
    }
    userErrors { field message }
  }
}
"""

inp = {
    "lineItems": line_items,
    "shippingAddress": {
        "address1": "Rua Raul Pompeia, 463",
        "city": "Sao Paulo",
        "provinceCode": "SP",
        "countryCode": "BR",
        "zip": "05025-010",
    },
}
r = gql(CALC, {"input": inp})
print("\n=== draftOrderCalculate ===")
print(json.dumps(r, ensure_ascii=False, indent=2))
