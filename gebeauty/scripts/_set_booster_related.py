"""Set Search&Discovery related_products (display 'ahead') on the 5 boosters,
mapping each to the base products it pairs with. SKUs resolved to GIDs live.
Run from c:\\claude\\gebeauty.  (no args)=DRY RUN ; 'apply'=write."""
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
NS = "shopify--discovery--product_recommendation"
PLAN = {
    "GEB 019": ["GEB 001", "GEB 008", "GEB 002"],
    "GEB 020": ["GEB 002", "GEB 003", "GEB 120", "GEB 001"],
    "GEB 021": ["GEB 101", "GEB 003", "GEB 120"],
    "GEB 022": ["GEB 102", "GEB 003", "GEB 120"],
    "GEB 023": ["GEB 003", "GEB 120", "GEB 002", "GEB 001"],
}
# resolve every SKU -> (gid,title)
FIND = "query($q:String!){products(first:1,query:$q){nodes{id title status}}}"
skus = set(PLAN) | {s for v in PLAN.values() for s in v}
res = {}
for sku in sorted(skus):
    n = gql(FIND, {"q": f"sku:'{sku}' AND product_type:product"})["data"]["products"]["nodes"]
    res[sku] = n[0] if n else None
missing = [s for s, n in res.items() if not n]
if missing:
    print("!! UNRESOLVED SKUs:", missing); sys.exit(1)
SET = "mutation($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){userErrors{field message}}}"
for bsku, rel in PLAN.items():
    owner = res[bsku]
    print(f"\n{bsku}  {owner['title']}")
    for rsku in rel:
        print(f"    -> {rsku}  {res[rsku]['title']}")
    print("    display: ahead")
    if APPLY:
        mf = [
            {"ownerId": owner["id"], "namespace": NS, "key": "related_products",
             "type": "list.product_reference", "value": json.dumps([res[s]["id"] for s in rel])},
            {"ownerId": owner["id"], "namespace": NS, "key": "related_products_display",
             "type": "single_line_text_field", "value": "ahead"},
        ]
        r = gql(SET, {"m": mf})
        errs = r.get("data", {}).get("metafieldsSet", {}).get("userErrors") or r.get("errors")
        print("   ", "OK" if not errs else errs)
print("\n" + ("APPLIED." if APPLY else "DRY RUN — rerun with 'apply'."))
