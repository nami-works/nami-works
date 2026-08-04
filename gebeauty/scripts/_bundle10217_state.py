"""Read-only: full current state of product GID 10217099297088 (the bundle to enrich).
Run from c:\\claude\\gebeauty: C:/Python314/python.exe scripts/_bundle10217_state.py"""
import json, sys, urllib.request
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
ENV = Path(__file__).resolve().parent.parent / ".env"
cfg = {}
for l in ENV.read_text(encoding="utf-8").splitlines():
    l = l.strip()
    if l.startswith("SHOPIFY") and "=" in l:
        k, v = l.split("=", 1); cfg[k.strip()] = v.strip().strip('"').strip("'")
URL = f"https://{cfg['SHOPIFY_SHOP_DOMAIN']}/admin/api/{cfg.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
def gql(q, v=None):
    b = json.dumps({"query": q, "variables": v or {}}).encode()
    r = urllib.request.Request(URL, data=b, headers={"Content-Type": "application/json", "X-Shopify-Access-Token": cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]})
    return json.loads(urllib.request.urlopen(r).read().decode())
GID = "gid://shopify/Product/10217099297088"
Q = """
query($id:ID!){
  product(id:$id){
    id title handle status productType vendor tags descriptionHtml totalInventory
    featuredMedia{ id } mediaCount{ count } seo{ title description }
    resourcePublicationsCount{ count }
    resourcePublications(first:20){ nodes{ publication{ name } isPublished } }
    collections(first:20){ nodes{ title handle } }
    variants(first:10){ nodes{
      id title sku barcode price compareAtPrice inventoryQuantity
      inventoryItem{ tracked measurement{ weight{ value unit } } }
      productVariantComponents(first:20){ nodes{ id quantity productVariant{ id title sku product{ title } } } }
    }}
    metafields(first:80){ nodes{ namespace key type value } }
  }
}
"""
n = gql(Q, {"id": GID})["data"]["product"]
if not n:
    print("PRODUCT NOT FOUND for", GID); sys.exit(1)
print("PRODUCT:", n["title"], "|", n["id"])
print("  handle        :", n["handle"])
print("  status        :", n["status"])
print("  productType   :", n["productType"], "| vendor:", n["vendor"])
print("  tags          :", n.get("tags"))
print("  descriptionHtml len:", len(n.get("descriptionHtml") or ""))
print("  seo           :", n.get("seo"))
print("  media count   :", n.get("mediaCount", {}).get("count"), "| has featured:", bool(n.get("featuredMedia")))
print("  totalInventory:", n.get("totalInventory"))
print("  collections   :", [(c["title"], c["handle"]) for c in n["collections"]["nodes"]])
print("  publications  :", n.get("resourcePublicationsCount", {}).get("count"))
for p in n["resourcePublications"]["nodes"]:
    print("     -", p["publication"]["name"], "PUBLISHED" if p["isPublished"] else "not published")
print("  --- variants ---")
for v in n["variants"]["nodes"]:
    print(f"   variant {v['title']} | sku={v.get('sku')} barcode={v.get('barcode')} price={v.get('price')} compareAt={v.get('compareAtPrice')} qty={v.get('inventoryQuantity')}")
    comps = v.get("productVariantComponents", {}).get("nodes", [])
    if comps:
        print("     BUNDLE COMPONENTS:")
        for c in comps:
            pv = c["productVariant"]
            print(f"        x{c['quantity']}  {pv['product']['title']} / {pv['title']} (sku={pv.get('sku')})")
    else:
        print("     (no components - not a native bundle variant)")
print("  --- metafields ---")
for m in n["metafields"]["nodes"]:
    val = (m["value"] or "")
    short = val if len(val) <= 80 else val[:77] + "..."
    print(f"     {m['namespace']}.{m['key']} [{m['type']}] = {short}")
