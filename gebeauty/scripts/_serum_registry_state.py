"""Read-only: full current state of GEB 126 (Serum Mayday) draft product on
Shopify, to enumerate what's still missing for a sellable/invoice-ready record.
Run from c:\\claude\\gebeauty (canonical checkout): python scripts/_serum_registry_state.py"""
import json, sys, urllib.request
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
ENV = Path(".env")
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
Q = """
query($q:String!){
  products(first:1, query:$q){
    nodes{
      id title handle status productType vendor tags descriptionHtml totalInventory
      featuredMedia{ id } mediaCount{ count } seo{ title description }
      resourcePublicationsCount{ count }
      resourcePublications(first:20){ nodes{ publication{ name } isPublished } }
      collections(first:20){ nodes{ title } }
      variants(first:5){ nodes{
        sku barcode price compareAtPrice
        inventoryItem{ tracked measurement{ weight{ value unit } } }
        inventoryQuantity
      }}
      metafields(first:60){ nodes{ namespace key value } }
    }
  }
}
"""
n = gql(Q, {"q": "sku:'GEB 126'"})["data"]["products"]["nodes"][0]
v = (n["variants"]["nodes"] or [{}])[0]
print("PRODUCT:", n["title"], "|", n["id"])
print("  status        :", n["status"])
print("  productType   :", n["productType"], "| vendor:", n["vendor"])
print("  price         :", v.get("price"), "| compareAt:", v.get("compareAtPrice"))
print("  sku           :", v.get("sku"), "| barcode:", v.get("barcode"))
print("  inv tracked   :", v.get("inventoryItem", {}).get("tracked"), "| variant qty:", v.get("inventoryQuantity"), "| totalInventory:", n.get("totalInventory"))
print("  weight        :", v.get("inventoryItem", {}).get("measurement", {}).get("weight"))
print("  media count   :", n.get("mediaCount", {}).get("count"), "| has featured:", bool(n.get("featuredMedia")))
print("  descriptionHtml len:", len(n.get("descriptionHtml") or ""))
print("  seo           :", n.get("seo"))
print("  tags          :", n.get("tags"))
print("  collections   :", [c["title"] for c in n["collections"]["nodes"]])
print("  publications  :", n.get("resourcePublicationsCount", {}).get("count"))
for p in n["resourcePublications"]["nodes"]:
    print("     -", p["publication"]["name"], "PUBLISHED" if p["isPublished"] else "not published")
mfk = [f"{m['namespace']}.{m['key']}" for m in n["metafields"]["nodes"]]
print("  metafields    :", ", ".join(mfk) or "(none)")
for m in n["metafields"]["nodes"]:
    if "ncm" in m["key"].lower():
        print("     -> ncm =", m["value"])
