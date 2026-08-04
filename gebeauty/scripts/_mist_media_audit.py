"""Read-only: list all media (in gallery order) for the 3 new mist fragrances
(Santal 031, Rose 032, Pear 033) so we can pick the hero to KEEP and the rest to
disassociate. Also dumps a recovery manifest (url+alt per media) to scratchpad so
nothing is lost. Run from c:\\claude\\gebeauty."""
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
TARGET = {"GEB 031": "santal skin", "GEB 032": "rose ritual", "GEB 033": "pear fresh"}
Q = """
query($q:String!){ products(first:1, query:$q){ nodes{ id title
  media(first:40){ nodes{ id mediaContentType
    ... on MediaImage{ alt image{ url } } } } } } }
"""
manifest = {}
for sku in TARGET:
    n = gql(Q, {"q": f"sku:'{sku}' AND product_type:product"})["data"]["products"]["nodes"][0]
    print(f"\n=== {sku}  {n['title']}  ({n['id']}) — {len(n['media']['nodes'])} media ===")
    rows = []
    for i, m in enumerate(n["media"]["nodes"]):
        url = (m.get("image") or {}).get("url", "")
        fname = url.split("?")[0].split("/")[-1]
        alt = (m.get("alt") or "")[:70]
        tag = "  <== HERO (pos 1, KEEP)" if i == 0 else ""
        print(f"  [{i}] {m['mediaContentType']:<6} {fname}{tag}")
        if alt:
            print(f"         alt: {alt}")
        rows.append({"pos": i, "id": m["id"], "type": m["mediaContentType"], "url": url, "alt": m.get("alt")})
    manifest[sku] = {"product_id": n["id"], "title": n["title"], "media": rows}
out = Path("mist-new-media-manifest.json")
out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"\nrecovery manifest -> gebeauty/{out}")
