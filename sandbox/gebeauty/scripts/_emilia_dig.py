"""Dig into Emilia: duplicate profiles + her tags/orders + any BEAUTYBACK code.

Read-only.
"""
import json, urllib.request, os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
SHOP = os.environ.get("SHOPIFY_SHOP_DOMAIN", "ge-beauty-cosmeticos.myshopify.com")
VER = os.environ.get("SHOPIFY_API_VERSION", "2026-01")
URL = f"https://{SHOP}/admin/api/{VER}/graphql.json"


def gql(query, variables=None):
    body = json.dumps({"query": query, **({"variables": variables} if variables else {})}).encode()
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


# 1) Any customer record matching her name OR email fragment
print("=== Customer records matching 'Emilia' OR 'Bretan' OR email ===")
r = gql("""
query {
  customers(first: 25, query: "Emilia OR Bretan OR emiliabretan") {
    edges { node {
      id displayName email createdAt numberOfOrders tags
      storeCreditAccounts(first:5){ edges { node { id balance { amount currencyCode } } } }
    } }
  }
}
""")
for e in r["data"]["customers"]["edges"]:
    n = e["node"]
    sca = n["storeCreditAccounts"]["edges"]
    bal = sca[0]["node"]["balance"] if sca else None
    print(f"  {n['displayName']:<22} | {n.get('email'):<32} | id={n['id'].rsplit('/',1)[-1]:<16} "
          f"| orders={n['numberOfOrders']} | credit={bal} | tags={n['tags']}")

# 2) Her orders (the one customer we know)
print("\n=== Orders for customer 9324651315520 ===")
r2 = gql("""
query {
  customer(id: "gid://shopify/Customer/9324651315520") {
    displayName email tags
    orders(first: 20, reverse: true) {
      edges { node {
        name createdAt displayFinancialStatus totalPriceSet { shopMoney { amount currencyCode } }
        discountCodes
      } }
    }
  }
}
""")
c = r2["data"]["customer"]
print(f"  tags: {c['tags']}")
for e in c["orders"]["edges"]:
    o = e["node"]
    print(f"  {o['name']} | {o['createdAt'][:10]} | {o['displayFinancialStatus']} "
          f"| {o['totalPriceSet']['shopMoney']['amount']} {o['totalPriceSet']['shopMoney']['currencyCode']} "
          f"| codes={o['discountCodes']}")

# 3) Any discount code that looks tied to her (BEAUTYBACK or her name)
print("\n=== Discount code nodes matching 'EMILIA' or 'BRETAN' ===")
r3 = gql("""
query {
  codeDiscountNodes(first: 25, query: "EMILIA OR BRETAN") {
    edges { node {
      codeDiscount {
        __typename
        ... on DiscountCodeBasic {
          title status startsAt endsAt
          codes(first:5){ edges { node { code } } }
          customerGets { value { __typename ... on DiscountAmount { amount { amount currencyCode } } ... on DiscountPercentage { percentage } } }
        }
      }
    } }
  }
}
""")
nodes = r3["data"]["codeDiscountNodes"]["edges"]
if not nodes:
    print("  (none)")
for e in nodes:
    print("  ", json.dumps(e["node"], ensure_ascii=False))
