"""Finish unlisting (espatula via REST published=false; cubeta already done),
then verify + print test URLs for the 2 items and their 3 bundles. Read+1 write.
"""
import json, time, urllib.request, urllib.error, os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
BASE = "https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01"
DOMAIN = "https://www.gebeauty.com.br"
H = {"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN}

ITEMS = [9269350531392, 9269348663616]   # cubeta, espatula (numeric)
KIT_VARIANTS = ["gid://shopify/ProductVariant/50414299283776",
                "gid://shopify/ProductVariant/50414302495040",
                "gid://shopify/ProductVariant/50510657880384"]


def gql(q, v=None):
    b = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    return json.loads(urllib.request.urlopen(
        urllib.request.Request(BASE + "/graphql.json", data=b, headers=H), timeout=60).read())


def rest_unpublish(num_id):
    body = json.dumps({"product": {"id": num_id, "published": False}}).encode()
    req = urllib.request.Request(f"{BASE}/products/{num_id}.json", data=body, headers=H, method="PUT")
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


INFO = """
query($id: ID!) {
  product(id: $id) {
    title handle status onlineStoreUrl
    resourcePublications(first: 25) { edges { node { isPublished publication { name } } } }
  }
}
"""

def online_pub(node):
    for e in node["resourcePublications"]["edges"]:
        if e["node"]["publication"]["name"] == "Online Store":
            return "PUBLISHED" if e["node"]["isPublished"] else "not-published"
    return "removed"

# Ensure both items unpublished (cubeta already; espatula now)
for num in ITEMS:
    gid = f"gid://shopify/Product/{num}"
    n = gql(INFO, {"id": gid})["data"]["product"]
    if online_pub(n) in ("PUBLISHED",):
        rest_unpublish(num)
        time.sleep(1)

print("=== ITEMS (should be removed from Online Store, status ACTIVE) ===")
for num in ITEMS:
    gid = f"gid://shopify/Product/{num}"
    n = gql(INFO, {"id": gid})["data"]["product"]
    print(f"  {n['title']:<12} status={n['status']}  OnlineStore={online_pub(n)}  "
          f"onlineStoreUrl={n['onlineStoreUrl']}")
    print(f"      TEST: {DOMAIN}/products/{n['handle']}")

print("\n=== BUNDLES (should stay ACTIVE + published; Add-to-cart should still work) ===")
for vid in KIT_VARIANTS:
    p = gql('query($id:ID!){ productVariant(id:$id){ product{ id } } }', {"id": vid})["data"]["productVariant"]["product"]
    n = gql(INFO, {"id": p["id"]})["data"]["product"]
    print(f"  {n['title']:<26} status={n['status']}  OnlineStore={online_pub(n)}")
    print(f"      TEST: {DOMAIN}/products/{n['handle']}")
