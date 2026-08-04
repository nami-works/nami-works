"""Read-only: list all 'travel size' products to identify the 3 hair-care items
for the new 'Ship-only' collection. Run from c:\\claude\\gebeauty."""
import json, sys, urllib.request
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
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
Q = """
query($q:String!){ products(first:50, query:$q, sortKey:TITLE){ nodes{
  id title handle status productType tags
  variants(first:1){nodes{sku price}} } } }
"""
seen = {}
for term in ["travel size", "travel-size", "mini"]:
    for n in gql(Q, {"q": f"title:*{term}*"})["data"]["products"]["nodes"]:
        seen[n["id"]] = n
print(f"travel-size-ish products: {len(seen)}\n")
for n in sorted(seen.values(), key=lambda x: x["title"]):
    v = (n["variants"]["nodes"] or [{}])[0]
    sku = str(v.get("sku") or "-"); price = str(v.get("price") or "-")
    print(f"  {sku:<10} {n['status']:<7} {n['productType']:<9} R${price:<8} {n['title']}")
    print(f"      handle={n['handle']}  tags={n['tags']}  {n['id']}")
