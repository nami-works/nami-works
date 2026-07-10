"""Fetch all canonical product images for 'primer-liso-intacto' from GE Beauty Shopify
and download them to the video-director validation folder.

Read-only. No mutations.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path
from dotenv import load_dotenv

# Script-relative .env load (per repo convention)
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

SHOP = os.getenv("SHOPIFY_SHOP_DOMAIN")
TOKEN = os.getenv("SHOPIFY_ADMIN_ACCESS_TOKEN")
API_VERSION = os.getenv("SHOPIFY_API_VERSION", "2026-01")
HANDLE = "primer-liso-intacto"

OUT_DIR = Path(
    r"c:/claude/gebeauty/video-director/"
    r"state/primer-liso-intacto-v1/_validation/primer-liso-shopify-refs"
)

if not SHOP or not TOKEN:
    print("ERROR: missing SHOPIFY_SHOP_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN in .env")
    sys.exit(1)


GRAPHQL_URL = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"

QUERY = """
query GetProductByHandle($handle: String!) {
  productByHandle(handle: $handle) {
    id
    title
    handle
    featuredMedia {
      ... on MediaImage {
        id
        image { url width height altText }
      }
    }
    media(first: 50) {
      edges {
        node {
          mediaContentType
          alt
          ... on MediaImage {
            id
            image { url width height altText }
          }
        }
      }
    }
    images(first: 50) {
      edges {
        node { url width height altText }
      }
    }
  }
}
"""


def graphql(query: str, variables: dict) -> dict:
    req = urllib.request.Request(
        GRAPHQL_URL,
        data=json.dumps({"query": query, "variables": variables}).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": TOKEN,
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body)
    except urllib.error.HTTPError as e:
        print(f"ERROR HTTP {e.code}: {e.read().decode('utf-8', errors='replace')}")
        sys.exit(1)


def ext_from_url(url: str) -> str:
    # strip query string
    path = url.split("?", 1)[0]
    for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        if path.lower().endswith(ext):
            return ext
    return ".jpg"


def download(url: str, dest: Path) -> int:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    dest.write_bytes(data)
    return len(data)


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Querying Shopify for product handle='{HANDLE}' ...")
    result = graphql(QUERY, {"handle": HANDLE})

    if "errors" in result:
        print("GraphQL errors:", json.dumps(result["errors"], indent=2))
        return 1

    product = (result.get("data") or {}).get("productByHandle")
    if not product:
        print(f"ERROR: product with handle '{HANDLE}' not found")
        return 1

    print(f"Product: {product['title']} ({product['id']})")

    # Collect MediaImage nodes from media(first: 50). Deduplicate by URL.
    media_edges = (product.get("media") or {}).get("edges") or []
    images_edges = (product.get("images") or {}).get("edges") or []

    seen_urls = set()
    items = []

    for edge in media_edges:
        node = edge["node"]
        img = node.get("image")
        if not img or not img.get("url"):
            continue
        url = img["url"]
        if url in seen_urls:
            continue
        seen_urls.add(url)
        items.append({
            "url": url,
            "width": img.get("width"),
            "height": img.get("height"),
            "alt": img.get("altText") or node.get("alt"),
            "source": "media",
        })

    # Add any extra images from top-level images field
    for edge in images_edges:
        node = edge["node"]
        url = node.get("url")
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        items.append({
            "url": url,
            "width": node.get("width"),
            "height": node.get("height"),
            "alt": node.get("altText"),
            "source": "images",
        })

    print(f"Found {len(items)} unique images.")

    manifest_lines = [
        f"# Primer Liso Intacto — Shopify reference images",
        "",
        f"Product: {product['title']}",
        f"Handle: {product['handle']}",
        f"Shopify ID: {product['id']}",
        f"Total images: {len(items)}",
        "",
        "| # | File | Dimensions | Alt text | Source |",
        "|---|------|------------|----------|--------|",
    ]

    errors = []
    downloaded = 0

    for i, item in enumerate(items, start=1):
        ext = ext_from_url(item["url"])
        fname = f"{i:02d}_image{ext}"
        dest = OUT_DIR / fname
        try:
            size = download(item["url"], dest)
            downloaded += 1
            dims = f"{item['width']}x{item['height']}" if item["width"] else "?"
            alt = (item["alt"] or "").replace("|", "/").strip() or "(no alt)"
            manifest_lines.append(
                f"| {i} | {fname} | {dims} | {alt} | {item['source']} |"
            )
            print(f"  [{i:02d}] {fname}  {dims}  {size:,} bytes")
        except Exception as e:
            err = f"  [{i:02d}] FAILED {item['url']}: {e}"
            print(err)
            errors.append(err)

    manifest_lines.extend([
        "",
        "## Source URLs",
        "",
    ])
    for i, item in enumerate(items, start=1):
        manifest_lines.append(f"- {i:02d}: {item['url']}")

    if errors:
        manifest_lines.append("")
        manifest_lines.append("## Errors")
        manifest_lines.append("")
        for e in errors:
            manifest_lines.append(f"- {e}")

    (OUT_DIR / "MANIFEST.md").write_text("\n".join(manifest_lines), encoding="utf-8")

    print(f"\nDownloaded {downloaded}/{len(items)} -> {OUT_DIR}")
    if errors:
        print(f"{len(errors)} errors")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
