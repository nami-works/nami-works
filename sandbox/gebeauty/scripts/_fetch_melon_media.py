"""Pull all media images for the live Melon Mood product (the bottle/lighting anchor
for the 3 new Mist line extensions). Downloads each to the scratchpad ref folder
and prints a manifest. Read-only."""
import json, os, urllib.request
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
URL = "https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json"

MELON = "gid://shopify/Product/9946377617728"
OUT = Path(r"C:\Users\LUCASG~1\AppData\Local\Temp\claude\c--Users-Lucas-Guimar-es-Desktop-nami-works\977f9199-b70b-493d-8425-b7206ac0c70c\scratchpad\mist-images\melon-reference")
OUT.mkdir(parents=True, exist_ok=True)

Q = """
query($id: ID!) {
  product(id: $id) {
    title
    handle
    featuredImage { url }
    media(first: 25) {
      nodes {
        ... on MediaImage {
          id
          alt
          image { url width height }
        }
      }
    }
  }
}
"""

def gql(q, v=None):
    b = json.dumps({"query": q, "variables": v or {}}).encode()
    r = urllib.request.Request(URL, data=b, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(r, timeout=60).read())

d = gql(Q, {"id": MELON})["data"]["product"]
print("TITLE:", d["title"])
print("HANDLE:", d["handle"])
featured = (d.get("featuredImage") or {}).get("url")
print("FEATURED:", featured)

manifest = []
nodes = [n for n in d["media"]["nodes"] if n.get("image")]
print("MEDIA_COUNT:", len(nodes))
for i, n in enumerate(nodes):
    img = n["image"]
    url = img["url"]
    is_featured = (url == featured)
    fname = f"melon_{i:02d}{'_FEATURED' if is_featured else ''}.png"
    dest = OUT / fname
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        dest.write_bytes(resp.read())
    rec = {"idx": i, "file": fname, "url": url, "alt": n.get("alt"),
           "w": img["width"], "h": img["height"], "featured": is_featured,
           "bytes": dest.stat().st_size}
    manifest.append(rec)
    print(f"  [{i}] {fname}  {img['width']}x{img['height']}  alt={n.get('alt')!r}")

(OUT / "_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
print("SAVED_TO:", OUT)
