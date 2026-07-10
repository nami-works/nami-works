"""Reactivate Emilia's 25% BEAUTYBACK + create a stacking free-shipping code.

DRY-RUN by default. Pass --execute to apply.

Code 1: reactivate BEAUTYBACK-DGZQ-DC96-CWSG (node 1648365142336) — extend window
        to now..+7d. Value stays 25% (original). Open code, usageLimit 1 (unchanged).
Code 2: NEW free-shipping code BEAUTYBACK-DGZQ-FRETE, restricted to Emilia
        (customer 9324651315520), stacks with order+product discounts, max R$30 freight,
        same now..+7d window, usageLimit 1.
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
EMILIA_GID = "gid://shopify/Customer/9324651315520"
FREESHIP_CODE = "BEAUTYBACK-DGZQ-FRETE"


def gql(q, v=None):
    b = json.dumps({"query": q, "variables": v or {}}).encode()
    r = urllib.request.Request(URL, data=b, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(r, timeout=60).read())


REACTIVATE = """
mutation($id: ID!, $d: DiscountCodeBasicInput!) {
  discountCodeBasicUpdate(id: $id, basicCodeDiscount: $d) {
    codeDiscountNode { id codeDiscount { ... on DiscountCodeBasic {
      title status startsAt endsAt
      customerGets { value { ... on DiscountPercentage { percentage } } }
      codes(first:1){ edges { node { code } } } } } }
    userErrors { field message code }
  }
}
"""

FREESHIP = """
mutation($d: DiscountCodeFreeShippingInput!) {
  discountCodeFreeShippingCreate(freeShippingCodeDiscount: $d) {
    codeDiscountNode { id codeDiscount { ... on DiscountCodeFreeShipping {
      title status startsAt endsAt
      codes(first:1){ edges { node { code } } } } } }
    userErrors { field message code }
  }
}
"""

reactivate_vars = {"id": NODE_ID, "d": {"startsAt": STARTS, "endsAt": ENDS}}
freeship_vars = {"d": {
    "title": "Beauty Back Frete | emiliabretan@gmail.com",
    "code": FREESHIP_CODE,
    "startsAt": STARTS,
    "endsAt": ENDS,
    "customerSelection": {"customers": {"add": [EMILIA_GID]}},
    "combinesWith": {"orderDiscounts": True, "productDiscounts": True},
    "destination": {"all": True},
    "minimumRequirement": {"subtotal": {"greaterThanOrEqualToSubtotal": "0.01"}},
    "maximumShippingPrice": "30.00",
    "appliesOncePerCustomer": True,
    "usageLimit": 1,
}}

print(f"=== {'DRY-RUN' if DRY else 'EXECUTING'} ===")
print(f"Window: {STARTS}  ->  {ENDS}\n")
print("CODE 1 (reactivate, 25% kept):")
print(json.dumps(reactivate_vars, ensure_ascii=False, indent=2))
print("\nCODE 2 (new free-shipping, restricted to Emilia):")
print(json.dumps(freeship_vars, ensure_ascii=False, indent=2))

if DRY:
    print("\n(DRY-RUN — no mutations sent. Re-run with --execute to apply.)")
    sys.exit(0)

print("\n--- applying CODE 1 ---")
r1 = gql(REACTIVATE, reactivate_vars)
print(json.dumps(r1, ensure_ascii=False, indent=2))

print("\n--- applying CODE 2 ---")
r2 = gql(FREESHIP, freeship_vars)
print(json.dumps(r2, ensure_ascii=False, indent=2))
