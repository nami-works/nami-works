"""Fetch hero image for primer-cachos-definidos from Shopify Admin GraphQL."""
import json
import os
import sys
import urllib.request
from pathlib import Path

from dotenv import load_dotenv

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(ENV_PATH)

SHOP = "ge-beauty-cosmeticos.myshopify.com"
API_VERSION = "2026-01"
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]

QUERY = """
query($handle: String!) {
  productByHandle(handle: $handle) {
    id
    title
    handle
    featuredImage { url altText width height }
    media(first: 5) {
      nodes {
        ... on MediaImage {
          image { url width height altText }
        }
      }
    }
  }
}
"""

req = urllib.request.Request(
    f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json",
    data=json.dumps({"query": QUERY, "variables": {"handle": "primer-cachos-definidos"}}).encode(),
    headers={
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json",
    },
    method="POST",
)
with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read())

if "errors" in data:
    print("GraphQL errors:", data["errors"], file=sys.stderr)
    sys.exit(1)

product = data["data"]["productByHandle"]
if not product:
    print("Product not found.", file=sys.stderr)
    sys.exit(1)

featured = product.get("featuredImage")
media_nodes = [n for n in product["media"]["nodes"] if n.get("image")]

print("PRODUCT_GID:", product["id"])
print("TITLE:", product["title"])
print("HANDLE:", product["handle"])
if featured:
    print("FEATURED_URL:", featured["url"])
    print("FEATURED_DIMS:", featured["width"], "x", featured["height"])
print("MEDIA_COUNT:", len(media_nodes))
for i, n in enumerate(media_nodes):
    img = n["image"]
    print(f"MEDIA_{i}_URL:", img["url"])
    print(f"MEDIA_{i}_DIMS:", img["width"], "x", img["height"])

# Pick hero: prefer featuredImage
hero = featured if featured else (media_nodes[0]["image"] if media_nodes else None)
if not hero:
    print("No hero image available.", file=sys.stderr)
    sys.exit(1)

out_path = Path(r"c:\claude\gebeauty\video-director\state\primer-liso-intacto-v1\_validation\primer-cachos-definidos-hero.png")
out_path.parent.mkdir(parents=True, exist_ok=True)

# Download
req2 = urllib.request.Request(hero["url"], headers={"User-Agent": "Mozilla/5.0"})
with urllib.request.urlopen(req2) as resp:
    out_path.write_bytes(resp.read())

print("SAVED:", out_path)
print("SIZE_BYTES:", out_path.stat().st_size)
print("HERO_DIMS:", hero["width"], "x", hero["height"])
