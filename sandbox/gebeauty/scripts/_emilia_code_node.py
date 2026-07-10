"""Fetch the discount NODE id + customerSelection for Emilia's BEAUTYBACK code. Read-only."""
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
query {
  codeDiscountNodes(first: 3, query: "emiliabretan") {
    edges { node {
      id
      codeDiscount {
        __typename
        ... on DiscountCodeBasic {
          title status startsAt endsAt
          customerSelection {
            __typename
            ... on DiscountCustomers { customers { id displayName email } }
          }
          codes(first: 3) { edges { node { id code } } }
        }
      }
    } }
  }
}
"""
print(json.dumps(gql(Q), ensure_ascii=False, indent=2))
