"""Find the real free-shipping threshold: automatic discounts + delivery profile rates. Read-only."""
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


# 1) Automatic discounts (free-shipping type) with their minimum requirement
AUTO = """
query {
  automaticDiscountNodes(first: 50) {
    edges { node {
      automaticDiscount {
        __typename
        ... on DiscountAutomaticFreeShipping {
          title status
          minimumRequirement {
            __typename
            ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount currencyCode } }
            ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity }
          }
          destinationSelection { __typename }
        }
        ... on DiscountAutomaticBasic { title status }
        ... on DiscountAutomaticBxgy { title status }
      }
    } }
  }
}
"""
print("=== Automatic discounts ===")
r = gql(AUTO)
if r.get("errors"):
    print("ERR:", json.dumps(r["errors"], ensure_ascii=False))
else:
    for e in r["data"]["automaticDiscountNodes"]["edges"]:
        a = e["node"]["automaticDiscount"]
        print(json.dumps(a, ensure_ascii=False))

# 2) Code-based free-shipping discounts with thresholds (store-wide, not Emilia's)
CODEFS = """
query {
  codeDiscountNodes(first: 50, query: "method:shipping") {
    edges { node { codeDiscount { __typename
      ... on DiscountCodeFreeShipping {
        title status
        minimumRequirement { __typename ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount currencyCode } } }
        codes(first:2){ edges { node { code } } }
      } } } }
  }
}
"""
print("\n=== Code free-shipping discounts ===")
r2 = gql(CODEFS)
if r2.get("errors"):
    print("ERR:", json.dumps(r2["errors"], ensure_ascii=False))
else:
    nodes = r2["data"]["codeDiscountNodes"]["edges"]
    if not nodes:
        print("  (none)")
    for e in nodes:
        print(json.dumps(e["node"]["codeDiscount"], ensure_ascii=False))

# 3) Delivery profiles: price-conditional free shipping rates
PROF = """
query {
  deliveryProfiles(first: 5) {
    edges { node {
      name
      profileLocationGroups {
        locationGroupZones(first: 20) {
          edges { node {
            zone { name }
            methodDefinitions(first: 20) {
              edges { node {
                name active
                rateProvider {
                  __typename
                  ... on DeliveryRateDefinition { price { amount currencyCode } }
                }
                methodConditions {
                  field operator
                  conditionCriteria { __typename ... on MoneyV2 { amount currencyCode } ... on Weight { value unit } }
                }
              } }
            }
          } }
        }
      }
    } }
  }
}
"""
print("\n=== Delivery profile method definitions (price-conditional rates) ===")
r3 = gql(PROF)
if r3.get("errors"):
    print("ERR:", json.dumps(r3["errors"], ensure_ascii=False))
else:
    for e in r3["data"]["deliveryProfiles"]["edges"]:
        p = e["node"]
        print(f"\nProfile: {p['name']}")
        for lg in p["profileLocationGroups"]:
            for z in lg["locationGroupZones"]["edges"]:
                zone = z["node"]["zone"]["name"]
                for m in z["node"]["methodDefinitions"]["edges"]:
                    mn = m["node"]
                    rp = mn["rateProvider"]
                    price = rp.get("price") if isinstance(rp, dict) else None
                    conds = [{"f": c["field"], "op": c["operator"], "crit": c["conditionCriteria"]}
                             for c in mn["methodConditions"]]
                    print(f"  [{zone}] {mn['name']} active={mn['active']} price={price} conds={conds}")
