"""Seed of the B2B portfolio build-script data feed.

Pulls the active product line from the GE Beauty admin registry so the B2B
portfolio deck (full + launches-only variants) renders from a single source
of truth instead of re-keyed data. Output: _b2b_portfolio_fetch.out.json.

HARD RULE (workspace CLAUDE.md): only read prices from products whose
productType is `product` or `acessorio`. Never rappi/brinde/kit channel SKUs.
Launch set = products tagged `lancto`.
"""
import json
import urllib.request
from pathlib import Path

# --- per-tenant secret, resolved from the script's own location ---
ENV = Path(__file__).resolve().parent.parent / ".env"


def load_env(path):
    out = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


cfg = load_env(ENV)
DOMAIN = cfg.get("SHOPIFY_SHOP_DOMAIN", "ge-beauty-cosmeticos.myshopify.com")
TOKEN = cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]
VERSION = cfg.get("SHOPIFY_API_VERSION", "2026-01")
URL = f"https://{DOMAIN}/admin/api/{VERSION}/graphql.json"

QUERY = """
query($cursor: String) {
  products(first: 100, after: $cursor, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    nodes {
      title
      handle
      productType
      tags
      featuredImage { url }
      variants(first: 1) { nodes { sku price compareAtPrice } }
    }
  }
}
"""


def graphql(query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN,
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    rows = []
    cursor = None
    while True:
        data = graphql(QUERY, {"cursor": cursor})
        conn = data["data"]["products"]
        for n in conn["nodes"]:
            ptype = (n.get("productType") or "").lower()
            if ptype not in ("product", "acessorio"):
                continue  # hard rule: skip rappi/brinde/kit/etc.
            v = (n["variants"]["nodes"] or [{}])[0]
            rows.append({
                "sku": (v.get("sku") or "").strip(),
                "title": n["title"],
                "handle": n["handle"],
                "productType": n.get("productType"),
                "tags": n.get("tags") or [],
                "lancto": "lancto" in (n.get("tags") or []),
                "price": v.get("price"),
                "compareAtPrice": v.get("compareAtPrice"),
                "image": (n.get("featuredImage") or {}).get("url"),
            })
        if not conn["pageInfo"]["hasNextPage"]:
            break
        cursor = conn["pageInfo"]["endCursor"]

    rows.sort(key=lambda r: r["sku"])
    out = Path(__file__).resolve().parent / "_b2b_portfolio_fetch.out.json"
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(rows)} products (product/acessorio) -> {out.name}")
    launches = [r for r in rows if r["lancto"]]
    print(f"lancto-tagged ({len(launches)}): " + ", ".join(f"{r['sku']} {r['title']}" for r in launches))
    missing_img = [r["sku"] for r in rows if not r["image"]]
    if missing_img:
        print("no featuredImage: " + ", ".join(missing_img))


if __name__ == "__main__":
    main()
