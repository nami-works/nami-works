"""Create the TWO DRAFT bundle products for the wash-routine acquisition offer.

Spec: gebeauty/imagery/wash-routine-offer/mechanic-tracking-spec.md
- Bundle A "Kit Rotina de Lavagem  Leave-in travel": 001+002+011, price 95, compareAt 237
- Bundle B "Kit Rotina de Lavagem  Shampoo a seco":  001+002+008, price 95, compareAt 259
- productType kit, tags bundle,kits,cohort-wash-rotina, status DRAFT, NO collections, NOT published.

Native-bundle path = variant fixed bundle (same structure as existing kits):
  productCreate -> productVariantRelationshipBulkUpdate -> productVariantsBulkUpdate.
Idempotent: skips creation if a product with the exact title already exists.
Verifies componentVariantsCount == 3 on each (0 = broken link).
Read the token from .env; never publish.
"""
import json, os, sys, time, urllib.request
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
URL = "https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json"

APPLY = "--apply" in sys.argv

V = {  # variant GIDs from the spec table
    "001": "gid://shopify/ProductVariant/47048042086720",
    "002": "gid://shopify/ProductVariant/47048041955648",
    "008": "gid://shopify/ProductVariant/47048029897024",
    "011": "gid://shopify/ProductVariant/49787120386368",
}

BUNDLES = [
    {"key": "A", "title": "Kit Rotina de Lavagem · Leave-in travel",
     "comps": ["001", "002", "011"], "price": "95.00", "compareAt": "237.00"},
    {"key": "B", "title": "Kit Rotina de Lavagem · Shampoo a seco",
     "comps": ["001", "002", "008"], "price": "95.00", "compareAt": "259.00"},
]
TAGS = ["bundle", "kits", "cohort-wash-rotina"]


def gql(q, v=None):
    b = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    r = urllib.request.Request(URL, data=b, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(r, timeout=90).read())


FIND = """query($q:String!){ products(first:5, query:$q){ edges{ node{
  id title status } } } }"""

CREATE = """mutation($product: ProductCreateInput!){
  productCreate(product:$product){
    product{ id title status productType tags handle
      variants(first:1){ nodes{ id price } } }
    userErrors{ field message } } }"""

LINK = """mutation($input:[ProductVariantRelationshipUpdateInput!]!){
  productVariantRelationshipBulkUpdate(input:$input){
    parentProductVariants{ id requiresComponents
      productVariantComponents(first:10){ nodes{ quantity productVariant{ id sku } } } }
    userErrors{ code field message } } }"""

PRICE = """mutation($productId:ID!, $variants:[ProductVariantsBulkInput!]!){
  productVariantsBulkUpdate(productId:$productId, variants:$variants){
    productVariants{ id price compareAtPrice }
    userErrors{ field message } } }"""

VERIFY = """query($id:ID!){ node(id:$id){ ... on Product{
  id title status productType tags handle
  resourcePublicationsCount{ count }
  collections(first:10){ nodes{ title } }
  variants(first:1){ nodes{ id price compareAtPrice requiresComponents
    productVariantComponents(first:10){ nodes{ quantity productVariant{ id sku } } } } } } } }"""


def create_bundle(b):
    title = b["title"]
    # idempotency
    r = gql(FIND, {"q": f"title:{json.dumps(title)}"})
    for e in r.get("data", {}).get("products", {}).get("edges", []):
        if e["node"]["title"] == title:
            print(f"  [SKIP] already exists: {title} -> {e['node']['id']} [{e['node']['status']}]")
            return e["node"]["id"]
    if not APPLY:
        print(f"  [DRY] would create DRAFT '{title}' comps={b['comps']} "
              f"price={b['price']} compareAt={b['compareAt']}")
        return None
    # 1. create product shell (DRAFT, kit, tags) - creates a default variant
    r = gql(CREATE, {"product": {
        "title": title, "productType": "kit", "status": "DRAFT", "tags": TAGS}})
    pc = r["data"]["productCreate"]
    if pc["userErrors"]:
        print(f"  [ERR] create: {pc['userErrors']}"); sys.exit(1)
    pid = pc["product"]["id"]
    vid = pc["product"]["variants"]["nodes"][0]["id"]
    print(f"  [OK] created {pid} (variant {vid}) status={pc['product']['status']}")
    # 2. link components -> sets requiresComponents=true
    rels = [{"id": V[c], "quantity": 1} for c in b["comps"]]
    r = gql(LINK, {"input": [{"parentProductVariantId": vid,
                              "productVariantRelationshipsToCreate": rels}]})
    lk = r["data"]["productVariantRelationshipBulkUpdate"]
    if lk["userErrors"]:
        print(f"  [ERR] link: {lk['userErrors']}"); sys.exit(1)
    comps = lk["parentProductVariants"][0]["productVariantComponents"]["nodes"]
    print(f"  [OK] linked {len(comps)} components requiresComponents="
          f"{lk['parentProductVariants'][0]['requiresComponents']}")
    # 3. set price + compareAtPrice
    r = gql(PRICE, {"productId": pid, "variants": [
        {"id": vid, "price": b["price"], "compareAtPrice": b["compareAt"]}]})
    pr = r["data"]["productVariantsBulkUpdate"]
    if pr["userErrors"]:
        print(f"  [ERR] price: {pr['userErrors']}"); sys.exit(1)
    print(f"  [OK] price set {pr['productVariants'][0]}")
    return pid


def verify(pid):
    r = gql(VERIFY, {"id": pid})
    n = r["data"]["node"]
    v = n["variants"]["nodes"][0]
    comps = v["productVariantComponents"]["nodes"]
    cols = [c["title"] for c in n["collections"]["nodes"]]
    print(f"\n  VERIFY {n['title']}")
    print(f"    id={n['id']}  handle={n['handle']}  status={n['status']}  type={n['productType']}")
    print(f"    tags={n['tags']}")
    print(f"    published_on_count={n['resourcePublicationsCount']['count']}  collections={cols}")
    print(f"    price={v['price']} compareAt={v['compareAtPrice']} requiresComponents={v['requiresComponents']}")
    print(f"    componentVariantsCount={len(comps)} " + ("OK" if len(comps) == 3 else "!!! BROKEN LINK !!!"))
    for c in comps:
        print(f"       x{c['quantity']} {c['productVariant']['sku']} ({c['productVariant']['id']})")
    return {"gid": n["id"], "handle": n["handle"], "status": n["status"],
            "compCount": len(comps), "published": n["resourcePublicationsCount"]["count"],
            "collections": cols, "price": v["price"], "compareAt": v["compareAtPrice"]}


def main():
    print(f"=== WASH-ROTINA BUNDLES ({'APPLY' if APPLY else 'DRY-RUN'}) ===")
    results = {}
    for b in BUNDLES:
        print(f"\nBundle {b['key']}: {b['title']}")
        pid = create_bundle(b)
        if pid:
            time.sleep(0.5)
            results[b["key"]] = verify(pid)
    out = Path(__file__).resolve().with_suffix(".out.json")
    out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nresults -> {out}")
    for k, r in results.items():
        adminid = r["gid"].rsplit("/", 1)[-1]
        print(f"  Bundle {k}: https://ge-beauty-cosmeticos.myshopify.com/admin/products/{adminid} "
              f"compCount={r['compCount']} status={r['status']} pubs={r['published']}")


if __name__ == "__main__":
    main()
