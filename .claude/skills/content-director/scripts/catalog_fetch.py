#!/usr/bin/env python3
"""
catalog_fetch.py — pull the LIVE Shopify product catalog as ground truth for
copywriting. Read-only (read_products). Stdlib only (urllib) per the GE Beauty
workspace API convention.

This is the anti-hallucination spine of /content-director: the writer may only
reference products that come back from this call, with the exact title and the
canonical storefront URL. No product here -> it does not exist -> do not mention it.

Usage:
    python catalog_fetch.py --tenant gebeauty
    python catalog_fetch.py --tenant gebeauty --status active --with-descriptions
    python catalog_fetch.py --tenant gebeauty --handle primer-cachos-definidos
    python catalog_fetch.py --tenant gebeauty --out catalog.json

Output: JSON array of products to stdout (or --out file). Each product:
    { gid, handle, title, status, url, tags[], price, compareAtPrice, sku,
      seoTitle, seoDescription, finalidade, hasTabbedDescription, image,
      descriptionHtml? }

Resolves credentials from sandbox/<tenant>/.env (per the per-tenant secret
convention in CLAUDE.md), reading SHOPIFY_SHOP_DOMAIN, SHOPIFY_ADMIN_ACCESS_TOKEN,
SHOPIFY_API_VERSION.
"""

import argparse
import json
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

# repo root = .../nami-works ; this file is at <root>/.claude/skills/content-director/scripts/
REPO_ROOT = Path(__file__).resolve().parents[4]


def load_env(tenant: str) -> dict:
    """Parse sandbox/<tenant>/.env into a dict. No python-dotenv dependency."""
    env_path = REPO_ROOT / "sandbox" / tenant / ".env"
    if not env_path.exists():
        sys.exit(f"ERROR: tenant env not found at {env_path}")
    env = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        env[key.strip()] = val.strip().strip('"').strip("'")
    return env


def make_graphql(env: dict):
    domain = env.get("SHOPIFY_SHOP_DOMAIN", "")
    token = env.get("SHOPIFY_ADMIN_ACCESS_TOKEN") or env.get("SHOPIFY_ACCESS_TOKEN")
    version = env.get("SHOPIFY_API_VERSION", "2026-01")
    if not domain or not token:
        sys.exit("ERROR: SHOPIFY_SHOP_DOMAIN / SHOPIFY_ADMIN_ACCESS_TOKEN missing in tenant .env")
    if domain.startswith(("http://", "https://")):
        domain = domain.split("://", 1)[1]
    domain = domain.rstrip("/")
    url = f"https://{domain}/admin/api/{version}/graphql.json"

    def graphql(query: str, variables: dict = None) -> dict:
        body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json", "X-Shopify-Access-Token": token},
        )
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                if "errors" in data and data["errors"]:
                    sys.exit(f"GraphQL errors: {json.dumps(data['errors'], ensure_ascii=False)}")
                # cost-based throttle courtesy
                cost = data.get("extensions", {}).get("cost", {})
                avail = cost.get("throttleStatus", {}).get("currentlyAvailable", 9999)
                if avail < 200:
                    time.sleep(1.0)
                return data["data"]
            except urllib.error.HTTPError as e:
                if e.code == 429 and attempt < 4:
                    time.sleep(2 ** attempt)
                    continue
                sys.exit(f"HTTP {e.code}: {e.read().decode('utf-8', 'ignore')}")
        sys.exit("Exhausted retries against Shopify GraphQL")

    return graphql, domain


PRODUCT_FIELDS = """
  id
  handle
  title
  status
  productType
  onlineStoreUrl
  tags
  seo { title description }
  featuredImage { url altText }
  finalidade: metafield(namespace: "custom", key: "finalidade") { value }
  tabbed: metafield(namespace: "custom", key: "descricao_longa_com_abas") { id value }
  variants(first: 1) { nodes { sku price compareAtPrice } }
"""


def fetch_shop_domain(graphql) -> str:
    data = graphql("{ shop { primaryDomain { url } } }")
    return data["shop"]["primaryDomain"]["url"].rstrip("/")


def shape(node: dict, public_domain: str, with_desc: bool) -> dict:
    variant = (node.get("variants", {}).get("nodes") or [{}])[0]
    handle = node.get("handle", "")
    url = node.get("onlineStoreUrl") or (f"{public_domain}/products/{handle}" if public_domain else None)
    out = {
        "gid": node.get("id"),
        "handle": handle,
        "title": node.get("title"),
        "status": node.get("status"),
        "productType": node.get("productType"),
        "url": url,
        "tags": node.get("tags", []),
        "price": variant.get("price"),
        "compareAtPrice": variant.get("compareAtPrice"),
        "sku": variant.get("sku"),
        "seoTitle": (node.get("seo") or {}).get("title"),
        "seoDescription": (node.get("seo") or {}).get("description"),
        "finalidade": (node.get("finalidade") or {}).get("value"),
        "hasTabbedDescription": bool(node.get("tabbed")),
        "image": (node.get("featuredImage") or {}).get("url"),
    }
    if with_desc:
        out["descriptionHtml"] = node.get("descriptionHtml")
    return out


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles default to cp1252
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="Fetch the live Shopify product catalog for copy grounding.")
    ap.add_argument("--tenant", default="gebeauty", help="sandbox/<tenant>/.env to read creds from")
    ap.add_argument("--status", default="active", choices=["active", "any"], help="filter by product status")
    ap.add_argument("--handle", help="fetch a single product by handle")
    ap.add_argument("--with-descriptions", action="store_true", help="include descriptionHtml (heavier payload)")
    ap.add_argument("--out", help="write JSON here instead of stdout")
    args = ap.parse_args()

    env = load_env(args.tenant)
    graphql, _ = make_graphql(env)
    public_domain = fetch_shop_domain(graphql)

    desc_field = "\n  descriptionHtml" if args.with_descriptions else ""

    if args.handle:
        q = f"""
        query($handle: String!) {{
          productByHandle(handle: $handle) {{ {PRODUCT_FIELDS}{desc_field} }}
        }}"""
        data = graphql(q, {"handle": args.handle})
        node = data.get("productByHandle")
        products = [shape(node, public_domain, args.with_descriptions)] if node else []
    else:
        search = "" if args.status == "any" else "status:active"
        q = f"""
        query($cursor: String) {{
          products(first: 50, after: $cursor, query: "{search}", sortKey: TITLE) {{
            pageInfo {{ hasNextPage endCursor }}
            nodes {{ {PRODUCT_FIELDS}{desc_field} }}
          }}
        }}"""
        products, cursor = [], None
        while True:
            data = graphql(q, {"cursor": cursor})
            conn = data["products"]
            products.extend(shape(n, public_domain, args.with_descriptions) for n in conn["nodes"])
            if not conn["pageInfo"]["hasNextPage"]:
                break
            cursor = conn["pageInfo"]["endCursor"]

    payload = json.dumps(products, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(payload, encoding="utf-8")
        print(f"Wrote {len(products)} products to {args.out}")
    else:
        print(payload)


if __name__ == "__main__":
    main()
