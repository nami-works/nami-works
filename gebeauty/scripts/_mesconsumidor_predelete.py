"""Read-only pre-delete safety check for the 'mês do consumidor' collection:
its state (products, published channels, description/image) + whether any online
-store navigation menu links to it (deletion would 404 such links)."""
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
CID = "gid://shopify/Collection/510343643456"
HANDLE = "mes-do-consumidor"
C = """
query($id:ID!){ collection(id:$id){ id title handle updatedAt sortOrder
  description descriptionHtml
  productsCount{ count }
  image{ url } seo{ title description }
  resourcePublicationsCount{ count }
  resourcePublications(first:20){ nodes{ isPublished publication{ name } } } } }
"""
c = gql(C, {"id": CID})["data"]["collection"]
print("COLLECTION:", c["title"], "| handle:", c["handle"], "| updated:", c["updatedAt"])
print("  products      :", c["productsCount"]["count"])
print("  description   :", (c.get("description") or "")[:120] or "(empty)")
print("  image         :", bool(c.get("image")))
print("  seo           :", c.get("seo"))
print("  published on  :", c["resourcePublicationsCount"]["count"], "channels")
for p in c["resourcePublications"]["nodes"]:
    print("     -", p["publication"]["name"], "PUBLISHED" if p["isPublished"] else "not")

# navigation menus referencing the collection
M = """
query{ menus(first:30){ nodes{ handle title
  items{ title type url resourceId
    items{ title type url resourceId
      items{ title type url resourceId } } } } } }
"""
def scan(items, path, hits):
    for it in items or []:
        blob = f"{it.get('url','')} {it.get('resourceId','')}"
        if HANDLE in (it.get("url") or "") or (it.get("resourceId") == CID):
            hits.append(f"{path} > {it.get('title')} [{it.get('type')}] url={it.get('url')} rid={it.get('resourceId')}")
        scan(it.get("items"), f"{path} > {it.get('title')}", hits)
menus = gql(M)
hits = []
if "data" in menus and menus["data"].get("menus"):
    for mn in menus["data"]["menus"]["nodes"]:
        scan(mn["items"], f"menu:{mn['handle']}", hits)
    print("\nNAV MENU references to this collection:", "NONE" if not hits else "")
    for h in hits:
        print("  !!", h)
else:
    print("\n[menus query unavailable]", json.dumps(menus)[:200])
