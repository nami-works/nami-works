"""Rename 'Body & Hair Splash' -> 'Body & Hair Mist' on the 3 drafts + live Melon Mood.

SAFE set only:
  - titles (all 4)
  - draft handles -> -mist (drafts not live)
  - Melon SEO title -> Mist (writes global.title_tag)
Does NOT change Melon's handle (live URL) and does NOT touch customer reviews.

DRY-RUN by default; pass --execute.
"""
import json, sys, urllib.request, os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
URL = "https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json"
DRY = "--execute" not in sys.argv

# id, new title, new handle (None = leave), new seo title (None = leave)
CHANGES = [
    ("gid://shopify/Product/10163564183872", "rose ritual | body & hair mist",
     "rose-ritual-body-hair-mist", None),
    ("gid://shopify/Product/10163564216640", "pear fresh | body & hair mist",
     "pear-fresh-body-hair-mist", None),
    ("gid://shopify/Product/10163564249408", "santal skin | body & hair mist",
     "santal-skin-body-hair-mist", None),
    ("gid://shopify/Product/9946377617728", "melon mood | body & hair mist",
     None, "Melon Mood Body & Hair Mist | GE Beauty"),   # handle left intact (live URL)
]

M = """
mutation($input: ProductInput!) {
  productUpdate(input: $input) {
    product { id title handle seo { title } status }
    userErrors { field message }
  }
}
"""


def gql(q, v=None):
    b = json.dumps({"query": q, "variables": v or {}}).encode()
    r = urllib.request.Request(URL, data=b, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(r, timeout=60).read())


print(f"=== {'DRY-RUN' if DRY else 'EXECUTING'} rename Splash -> Mist ===\n")
for pid, title, handle, seo_title in CHANGES:
    inp = {"id": pid, "title": title}
    if handle:
        inp["handle"] = handle
    if seo_title:
        inp["seo"] = {"title": seo_title}
    print("PATCH", json.dumps(inp, ensure_ascii=False))
    if DRY:
        continue
    r = gql(M, {"input": inp})
    pu = r["data"]["productUpdate"]
    if pu["userErrors"]:
        print("   ERROR:", json.dumps(pu["userErrors"], ensure_ascii=False)); continue
    p = pu["product"]
    print(f"   OK [{p['status']}] title={p['title']!r} handle={p['handle']!r} seo.title={p['seo']['title']!r}")

if DRY:
    print("\n(DRY-RUN — nothing written. Re-run with --execute.)")
