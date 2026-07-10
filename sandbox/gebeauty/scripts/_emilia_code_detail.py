"""Full detail of Emilia's BEAUTYBACK code(s). Read-only."""
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


Q = """
query($q: String!) {
  codeDiscountNodes(first: 50, query: $q) {
    edges { node {
      codeDiscount {
        __typename
        ... on DiscountCodeBasic {
          title
          status
          asyncUsageCount
          usageLimit
          appliesOncePerCustomer
          startsAt
          endsAt
          minimumRequirement {
            __typename
            ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount currencyCode } }
            ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity }
          }
          combinesWith { orderDiscounts productDiscounts shippingDiscounts }
          codes(first: 5) { edges { node { code } } }
          customerGets {
            value {
              __typename
              ... on DiscountAmount { amount { amount currencyCode } }
              ... on DiscountPercentage { percentage }
            }
          }
        }
      }
    } }
  }
}
"""

for term in ["emiliabretan", "BEAUTYBACK-DGZQ-DC96-CWSG"]:
    print(f"\n===== query: {term} =====")
    r = gql(Q, {"q": term})
    if r.get("errors"):
        print("ERR:", json.dumps(r["errors"], ensure_ascii=False))
        continue
    for e in r["data"]["codeDiscountNodes"]["edges"]:
        print(json.dumps(e["node"]["codeDiscount"], ensure_ascii=False, indent=2))
