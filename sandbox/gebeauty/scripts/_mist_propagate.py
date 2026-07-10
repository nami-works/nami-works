"""Finish the Splash -> Mist rebrand:
  1. Melon Mood (live) handle -> melon-mood-body-hair-mist (Shopify auto 301)
  2. Travel size product: title + handle + SEO -> Mist
  3. Melon long markdown metafield: Splash->Mist / splash->mist
  4. products.json fiscal names: 'Body Hair Splash' & 'Body & Hair Splash' -> Mist

DRY-RUN by default; pass --execute.
"""
import json, sys, urllib.request, os
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
URL = "https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json"
DRY = "--execute" not in sys.argv

MELON = "gid://shopify/Product/9946377617728"
TRAVEL = "gid://shopify/Product/10039126032704"
PRODUCTS_JSON = ROOT / "products.json"


def gql(q, v=None):
    b = json.dumps({"query": q, "variables": v or {}}).encode()
    r = urllib.request.Request(URL, data=b, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(r, timeout=60).read())


PU = """
mutation($input: ProductInput!) {
  productUpdate(input: $input) {
    product { id title handle seo { title } status }
    userErrors { field message }
  }
}
"""
MF = """
mutation($mf: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $mf) { userErrors { field message } }
}
"""

print(f"=== {'DRY-RUN' if DRY else 'EXECUTING'} Mist propagation ===\n")

# --- 1. Melon handle ---
print("1) Melon handle -> melon-mood-body-hair-mist")
if not DRY:
    r = gql(PU, {"input": {"id": MELON, "handle": "melon-mood-body-hair-mist"}})
    print("   ", json.dumps(r["data"]["productUpdate"].get("product") or r["data"]["productUpdate"]["userErrors"], ensure_ascii=False))

# --- 2. Travel size title+handle+seo ---
tv = gql('query($id:ID!){ product(id:$id){ title handle seo{ title } } }', {"id": TRAVEL})["data"]["product"]
new_tv_title = tv["title"].replace("splash", "mist")
new_tv_handle = tv["handle"].replace("splash", "mist")
new_tv_seo = (tv["seo"]["title"] or "").replace("Splash", "Mist").replace("splash", "mist")
print(f"\n2) Travel size: title {tv['title']!r} -> {new_tv_title!r}; handle -> {new_tv_handle!r}; seo -> {new_tv_seo!r}")
if not DRY:
    inp = {"id": TRAVEL, "title": new_tv_title, "handle": new_tv_handle}
    if new_tv_seo:
        inp["seo"] = {"title": new_tv_seo}
    r = gql(PU, {"input": inp})
    print("   ", json.dumps(r["data"]["productUpdate"].get("product") or r["data"]["productUpdate"]["userErrors"], ensure_ascii=False))

# --- 3. Melon markdown metafield ---
mk = gql('query{ product(id:"%s"){ metafield(namespace:"custom", key:"descricao_completa_em_markdown"){ value } } }' % MELON)["data"]["product"]["metafield"]["value"]
new_mk = mk.replace("Splash", "Mist").replace("splash", "mist")
print(f"\n3) Markdown metafield: {mk.count('Splash')+mk.count('splash')} 'splash' -> replaced ({new_mk.count('splash')+new_mk.count('Splash')} remaining)")
if not DRY:
    r = gql(MF, {"mf": [{"ownerId": MELON, "namespace": "custom",
                         "key": "descricao_completa_em_markdown",
                         "type": "multi_line_text_field", "value": new_mk}]})
    print("   metafieldsSet errors:", r["data"]["metafieldsSet"]["userErrors"])

# --- 4. products.json fiscal names ---
raw = PRODUCTS_JSON.read_text(encoding="utf-8")
n1 = raw.count("Body Hair Splash")
n2 = raw.count("Body & Hair Splash")
new_raw = raw.replace("Body Hair Splash", "Body Hair Mist").replace("Body & Hair Splash", "Body & Hair Mist")
print(f"\n4) products.json: 'Body Hair Splash' x{n1}, 'Body & Hair Splash' x{n2} -> Mist")
if not DRY:
    PRODUCTS_JSON.write_text(new_raw, encoding="utf-8")
    print("   products.json written")

if DRY:
    print("\n(DRY-RUN — nothing written. Re-run with --execute.)")
