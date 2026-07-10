"""Unpublish cubeta + espatula from the Online Store channel (keep ACTIVE).
Then print storefront URLs for the 2 items + their 3 bundles for manual testing.

DRY-RUN by default; pass --execute to write.
"""
import json, sys, urllib.request, os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
URL = "https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json"
DOMAIN = "https://www.gebeauty.com.br"
DRY = "--execute" not in sys.argv

ITEMS = ["gid://shopify/Product/9269350531392",   # cubeta
         "gid://shopify/Product/9269348663616"]    # espatula


def gql(q, v=None):
    b = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    r = urllib.request.Request(URL, data=b, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(r, timeout=60).read())


# Online Store publication id
pubs = gql("{ publications(first: 25) { edges { node { id name } } } }")["data"]["publications"]["edges"]
online = next(p["node"]["id"] for p in pubs if p["node"]["name"] == "Online Store")
print("Online Store publication:", online)

INFO = """
query($id: ID!) {
  product(id: $id) {
    id title handle status
    resourcePublications(first: 20) { edges { node { isPublished publication { name } } } }
  }
}
"""

def online_state(node):
    for e in node["resourcePublications"]["edges"]:
        if e["node"]["publication"]["name"] == "Online Store":
            return "PUBLISHED" if e["node"]["isPublished"] else "not-published"
    return "absent"

# resolve the 3 bundle products via their known parent-variant ids (robust)
KIT_VARIANTS = ["gid://shopify/ProductVariant/50414299283776",  # kit mixer e espatula
                "gid://shopify/ProductVariant/50414302495040",  # kit rotina completa
                "gid://shopify/ProductVariant/50510657880384"]  # kit cuidados diarios
kits = {}
for vid in KIT_VARIANTS:
    r = gql('query($id:ID!){ productVariant(id:$id){ product{ id title handle status } } }', {"id": vid})
    p = r["data"]["productVariant"]["product"]
    kits[p["id"]] = p

UNPUB = """
mutation($id: ID!, $pid: ID!) {
  publishableUnpublish(id: $id, input: [{ publicationId: $pid }]) {
    publishable { ... on Product { id title status } }
    userErrors { field message }
  }
}
"""

print(f"\n=== {'DRY-RUN' if DRY else 'EXECUTING'} unpublish from Online Store ===")
for pid in ITEMS:
    n = gql(INFO, {"id": pid})["data"]["product"]
    print(f"\n{n['title']}  status={n['status']}  OnlineStore={online_state(n)}")
    if DRY:
        print("   (dry-run: would unpublish from Online Store)")
        continue
    r = gql(UNPUB, {"id": pid, "pid": online})
    ue = r["data"]["publishableUnpublish"]["userErrors"]
    if ue:
        print("   ERROR:", json.dumps(ue, ensure_ascii=False)); continue
    after = gql(INFO, {"id": pid})["data"]["product"]
    print(f"   -> after: status={after['status']}  OnlineStore={online_state(after)}")

# URLs
print("\n=== TEST URLs ===")
print("\nITEMS (expected: 404 / unavailable after unpublish):")
for pid in ITEMS:
    n = gql(INFO, {"id": pid})["data"]["product"]
    print(f"  {n['title']:<12} {DOMAIN}/products/{n['handle']}   [status={n['status']}, OnlineStore={online_state(n)}]")
print("\nBUNDLES (expected: still available / Add to cart works):")
for t, n in kits.items():
    info = gql(INFO, {"id": n["id"]})["data"]["product"]
    print(f"  {info['title']:<26} {DOMAIN}/products/{info['handle']}   [status={info['status']}, OnlineStore={online_state(info)}]")
