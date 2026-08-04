"""Read-only: identify all Body & Hair Mist products + show their current
Search&Discovery related-products config, and fetch the accepted values for the
related_products_display metafield (so we set 'only' correctly). Run from c:\\claude\\gebeauty."""
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

NS = "shopify--discovery--product_recommendation"
Q = """
query($q:String!){
  products(first:30, query:$q, sortKey:TITLE){
    nodes{ id title handle status productType
      variants(first:1){nodes{sku}}
      rel: metafield(namespace:"%s", key:"related_products"){ value type }
      disp: metafield(namespace:"%s", key:"related_products_display"){ value type }
    }
  }
}
""" % (NS, NS)
seen = {}
for term in ["body & hair", "mist", "splash"]:
    for n in gql(Q, {"q": f"title:*{term}*"})["data"]["products"]["nodes"]:
        seen[n["id"]] = n
print(f"candidate mist-ish products: {len(seen)}")
for n in sorted(seen.values(), key=lambda x: (x["variants"]["nodes"] or [{}])[0].get("sku") or ""):
    sku = ((n["variants"]["nodes"] or [{}])[0].get("sku") or "?")
    rel = n.get("rel"); disp = n.get("disp")
    relcnt = len(json.loads(rel["value"])) if rel and rel.get("value") else 0
    print(f"  {sku:<9} {n['status']:<7} {n['productType']:<9} | rel={relcnt} disp={disp['value'] if disp else '(unset)'} | {n['title']} | {n['id']}")

# metafield definition accepted values for related_products_display
D = """
query{ metafieldDefinitions(first:10, ownerType:PRODUCT, namespace:"%s"){
  nodes{ key name type{ name } validations{ name value } } } }
""" % NS
print("\n-- Search&Discovery metafield definitions --")
for d in gql(D)["data"]["metafieldDefinitions"]["nodes"]:
    print(f"  {d['key']} [{d['type']['name']}]  validations: {d['validations']}")
