"""Find 'cubeta' and 'espatula' products, and determine whether any BUNDLE
depends on them (native Shopify bundle components). Read-only.
"""
import json, time, urllib.request, os
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


# --- 1. Locate the two items ---
FIND = """
query($q: String!) {
  products(first: 25, query: $q) {
    edges { node {
      id title handle status totalInventory
      resourcePublicationsCount { count }
      resourcePublications(first: 10) { edges { node { isPublished publication { name } } } }
      variants(first: 20) { edges { node {
        id sku title inventoryQuantity
        requiresComponents
        sellableOnlineQuantity
      } } }
    } }
  }
}
"""
targets = {}
for term in ["cubeta", "espátula", "espatula", "spatula"]:
    r = gql(FIND, {"q": f"title:*{term}*"})
    for e in r.get("data", {}).get("products", {}).get("edges", []):
        n = e["node"]
        targets[n["id"]] = n

print("=== MATCHED ITEMS ===")
target_variant_ids = set()
for n in targets.values():
    pubs = [f"{p['node']['publication']['name']}={'Y' if p['node']['isPublished'] else 'N'}"
            for p in n["resourcePublications"]["edges"]]
    print(f"\n{n['title']}  [{n['status']}]  id={n['id'].rsplit('/',1)[-1]}  totalInv={n['totalInventory']}")
    print(f"  published on: {pubs}")
    for ve in n["variants"]["edges"]:
        v = ve["node"]
        target_variant_ids.add(v["id"])
        print(f"   variant {v['id'].rsplit('/',1)[-1]} sku={v['sku']!r} qty={v['inventoryQuantity']} "
              f"requiresComponents={v['requiresComponents']}")

# --- 2. Scan all products for bundle parents and see if they use these variants ---
SCAN = """
query($cursor: String) {
  products(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id title status
      variants(first: 15) { edges { node {
        id requiresComponents
        productVariantComponents(first: 30) { edges { node {
          quantity
          productVariant { id sku title product { id title } }
        } } }
      } } }
    } }
  }
}
"""
print("\n=== SCANNING for bundle parents (requiresComponents) ... ===")
cursor = None
bundles = []
pages = 0
while True:
    r = gql(SCAN, {"cursor": cursor})
    data = r.get("data", {}).get("products")
    if not data:
        print("scan error:", json.dumps(r, ensure_ascii=False)[:500]); break
    pages += 1
    for e in data["edges"]:
        n = e["node"]
        for ve in n["variants"]["edges"]:
            v = ve["node"]
            comps = v.get("productVariantComponents", {}).get("edges", [])
            if v["requiresComponents"] and comps:
                comp_list = [{"vid": c["node"]["productVariant"]["id"],
                              "ptitle": c["node"]["productVariant"]["product"]["title"],
                              "qty": c["node"]["quantity"]} for c in comps]
                uses_target = any(c["vid"] in target_variant_ids for c in comp_list)
                bundles.append({"bundle": n["title"], "status": n["status"],
                                "bvid": v["id"].rsplit("/", 1)[-1],
                                "components": comp_list, "uses_target": uses_target})
    if not data["pageInfo"]["hasNextPage"]:
        break
    cursor = data["pageInfo"]["endCursor"]
    if pages % 5 == 0:
        time.sleep(0.5)

print(f"scanned {pages} pages; found {len(bundles)} native-bundle parent variants total")
hits = [b for b in bundles if b["uses_target"]]
print(f"\n=== BUNDLES that include cubeta/espatula as a COMPONENT: {len(hits)} ===")
for b in hits:
    print(f"\n  BUNDLE: {b['bundle']}  [{b['status']}]  parentVariant={b['bvid']}")
    for c in b["components"]:
        mark = "  <-- TARGET" if c["vid"] in target_variant_ids else ""
        print(f"     x{c['qty']}  {c['ptitle']}  ({c['vid'].rsplit('/',1)[-1]}){mark}")

out = Path(__file__).resolve().with_suffix(".out.json")
out.write_text(json.dumps({"targets": list(targets.values()), "all_bundles": bundles},
                          ensure_ascii=False, indent=2), encoding="utf-8")
print(f"\nFull detail -> {out.name}")
