"""Create manual collection 'Ship-only' with the 3 travel-size hair-care products
(GEB 013 shampoo, 010 mascara, 011 leave-in). Created UNPUBLISHED (no channels)
so it is not customer-facing until Lucas publishes. Run from c:\\claude\\gebeauty.
  (no args)=DRY RUN ; 'apply'=create."""
import json, sys, urllib.request
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
APPLY = "apply" in sys.argv[1:]
cfg = {}
for l in Path(".env").read_text(encoding="utf-8").splitlines():
    l = l.strip()
    if l.startswith("SHOPIFY") and "=" in l:
        k, v = l.split("=", 1); cfg[k.strip()] = v.strip().strip('"').strip("'")
URL = f"https://{cfg['SHOPIFY_SHOP_DOMAIN']}/admin/api/{cfg.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
def gql(q, v=None):
    b = json.dumps({"query": q, "variables": v or {}}).encode()
    r = urllib.request.Request(URL, data=b, headers={"Content-Type": "application/json", "X-Shopify-Access-Token": cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]})
    return json.loads(urllib.request.urlopen(r).read().decode())
TITLE = "Ship-only"
SKUS = ["GEB 013", "GEB 010", "GEB 011"]

# guard: existing collection with same title?
ex = gql('query($q:String!){collections(first:5,query:$q){nodes{id title}}}', {"q": f"title:'{TITLE}'"})
hits = [c for c in ex["data"]["collections"]["nodes"] if c["title"].lower() == TITLE.lower()]
if hits:
    print("!! collection already exists:", hits); sys.exit(0)

# resolve SKUs
FIND = "query($q:String!){products(first:1,query:$q){nodes{id title}}}"
prods = []
for s in SKUS:
    n = gql(FIND, {"q": f"sku:'{s}' AND product_type:product"})["data"]["products"]["nodes"]
    if not n:
        print("!! unresolved", s); sys.exit(1)
    prods.append(n[0]); print(f"  {s}: {n[0]['title']}  {n[0]['id']}")
print(f"\nWILL CREATE manual collection '{TITLE}' (unpublished) with {len(prods)} products")
if not APPLY:
    print("DRY RUN — rerun with 'apply'."); sys.exit(0)

cc = gql("mutation($i:CollectionInput!){collectionCreate(input:$i){collection{id title handle}userErrors{field message}}}",
         {"i": {"title": TITLE}})
res = cc.get("data", {}).get("collectionCreate", {})
if res.get("userErrors") or cc.get("errors"):
    print("CREATE ERR:", res.get("userErrors") or cc.get("errors")); sys.exit(1)
cid = res["collection"]["id"]
print("created:", res["collection"]["handle"], cid)
add = gql("mutation($id:ID!,$ids:[ID!]!){collectionAddProducts(id:$id,productIds:$ids){collection{id productsCount{count}}userErrors{field message}}}",
          {"id": cid, "ids": [p["id"] for p in prods]})
ares = add.get("data", {}).get("collectionAddProducts", {})
print("add:", "OK count=" + str(ares.get("collection", {}).get("productsCount", {}).get("count")) if not ares.get("userErrors") else ares.get("userErrors"))
