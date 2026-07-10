"""Convert Emilia's BEAUTYBACK code to a flat R$80 off, reactivated now..+7d.

Single code now covers cashback + freight. Pass --execute to apply (default dry-run).
"""
import json, sys, urllib.request, os
from datetime import datetime, timezone, timedelta
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
URL = "https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json"
DRY = "--execute" not in sys.argv

NOW = datetime.now(timezone.utc)
STARTS = NOW.strftime("%Y-%m-%dT%H:%M:%SZ")
ENDS = (NOW + timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
NODE_ID = "gid://shopify/DiscountCodeNode/1648365142336"


def gql(q, v=None):
    b = json.dumps({"query": q, "variables": v or {}}).encode()
    r = urllib.request.Request(URL, data=b, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(r, timeout=60).read())


MUT = """
mutation($id: ID!, $d: DiscountCodeBasicInput!) {
  discountCodeBasicUpdate(id: $id, basicCodeDiscount: $d) {
    codeDiscountNode { codeDiscount { ... on DiscountCodeBasic {
      title status startsAt endsAt
      customerGets { value {
        __typename
        ... on DiscountAmount { amount { amount currencyCode } }
        ... on DiscountPercentage { percentage }
      } }
      codes(first:1){ edges { node { code } } }
    } } }
    userErrors { field message code }
  }
}
"""

d = {
    "startsAt": STARTS,
    "endsAt": ENDS,
    "customerGets": {
        "items": {"all": True},
        "value": {"discountAmount": {"amount": "80.0", "appliesOnEachItem": False}},
    },
}

print(f"=== {'DRY-RUN' if DRY else 'EXECUTING'} ===")
print(f"Set BEAUTYBACK-DGZQ-DC96-CWSG -> R$80.00 flat, window {STARTS} .. {ENDS}")
if DRY:
    print(json.dumps({"id": NODE_ID, "d": d}, ensure_ascii=False, indent=2))
    print("\n(DRY-RUN — re-run with --execute to apply.)")
    sys.exit(0)

r = gql(MUT, {"id": NODE_ID, "d": d})
print(json.dumps(r, ensure_ascii=False, indent=2))
