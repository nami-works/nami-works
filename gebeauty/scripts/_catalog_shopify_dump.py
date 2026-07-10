"""Exploratory dump of the FULL GE Beauty Shopify catalog for the canonical
catalog gap-map. Pulls every product (all statuses, all productTypes) with the
fields a canonical catalog cares about, so we can see what Shopify actually
owns vs. what products.json carries from other systems (Omie/Unilog).

Read-only. Output: _catalog_shopify_dump.out.json
"""
import json
import time
import urllib.request
from pathlib import Path

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
  products(first: 50, after: $cursor, sortKey: ID) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      title
      handle
      status
      productType
      tags
      hasOnlyDefaultVariant
      descriptionHtml
      featuredImage { url }
      images(first: 1) { nodes { url } }
      metafields(first: 30) {
        nodes { namespace key type value }
      }
      variants(first: 20) {
        nodes {
          sku
          barcode
          price
          compareAtPrice
          inventoryItem {
            measurement { weight { value unit } }
          }
        }
      }
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
    nodes = []
    cursor = None
    while True:
        data = graphql(QUERY, {"cursor": cursor})
        if "errors" in data:
            print("GraphQL errors:", json.dumps(data["errors"], indent=2))
            return
        conn = data["data"]["products"]
        nodes.extend(conn["nodes"])
        cost = data.get("extensions", {}).get("cost", {}).get("throttleStatus", {})
        if cost.get("currentlyAvailable", 9999) < 300:
            time.sleep(1)
        if not conn["pageInfo"]["hasNextPage"]:
            break
        cursor = conn["pageInfo"]["endCursor"]

    out = Path(__file__).resolve().parent / "_catalog_shopify_dump.out.json"
    out.write_text(json.dumps(nodes, ensure_ascii=False, indent=2), encoding="utf-8")

    # quick console profile
    by_type = {}
    for n in nodes:
        by_type[n.get("productType") or "(none)"] = by_type.get(n.get("productType") or "(none)", 0) + 1
    print(f"{len(nodes)} products total -> {out.name}")
    print("by productType:", json.dumps(by_type, ensure_ascii=False))
    by_status = {}
    for n in nodes:
        by_status[n.get("status")] = by_status.get(n.get("status"), 0) + 1
    print("by status:", json.dumps(by_status, ensure_ascii=False))

    # metafield key inventory (namespace.key -> count)
    mf = {}
    for n in nodes:
        for m in n.get("metafields", {}).get("nodes", []):
            key = f"{m['namespace']}.{m['key']}"
            mf[key] = mf.get(key, 0) + 1
    print("metafield keys seen:")
    for k, v in sorted(mf.items(), key=lambda x: -x[1]):
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
