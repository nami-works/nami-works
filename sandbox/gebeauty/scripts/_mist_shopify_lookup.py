"""
Read-only: locate the Body & Hair Mist variants on Shopify by barcode (EAN),
so we can re-key their SKUs to match Omie. Matches by barcode (stable) and
prints every variant hit with productType, current SKU, and inventoryItem id.

Writes nothing.
"""

import json
import urllib.request
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"

# EAN -> (fragrance, target Omie SKU)
TARGETS = {
    "0042882635451": ("Melon Mood 200ml", "GEB 024"),
    "0631911620805": ("Melon Mood Mini", "GEB 029"),
    "0631911748233": ("Santal Skin 200ml", "GEB 031"),
    "0631911748226": ("Rose Ritual 200ml", "GEB 032"),
    "0631911748219": ("Pear Fresh 200ml", "GEB 033"),
}


def load_env(path):
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def main():
    env = load_env(ENV_PATH)
    domain = env["SHOPIFY_SHOP_DOMAIN"]
    token = env["SHOPIFY_ADMIN_ACCESS_TOKEN"]
    ver = env["SHOPIFY_API_VERSION"]
    url = f"https://{domain}/admin/api/{ver}/graphql.json"

    def gql(query, variables=None):
        body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
        req = urllib.request.Request(url, data=body, headers={
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token,
        })
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))

    Q = """
    query($q: String!) {
      productVariants(first: 25, query: $q) {
        edges { node {
          id
          title
          sku
          barcode
          inventoryItem { id }
          product { id title productType status }
        } }
      }
    }
    """

    print(f"[shopify] {domain} api={ver}\n")
    for ean, (frag, target_sku) in TARGETS.items():
        # try with and without a leading zero, since barcodes vary
        variants = ean.lstrip("0")
        results = {}
        for q in (f"barcode:{ean}", f"barcode:{variants}"):
            data = gql(Q, {"q": q})
            if "errors" in data:
                print(f"  [errors] {q}: {data['errors']}")
                continue
            for e in data["data"]["productVariants"]["edges"]:
                results[e["node"]["id"]] = e["node"]
        print(f"=== {frag}  EAN {ean}  -> target SKU {target_sku} ===")
        if not results:
            print("  (no variant found by barcode)")
        for n in results.values():
            p = n["product"]
            flag = "  <-- RETAIL" if p["productType"] in ("product", "acessorio") else "  (skip: non-retail)"
            print(f"  product: {p['title']!r} [{p['productType']}/{p['status']}]")
            print(f"    variant {n['id'].split('/')[-1]} sku={n['sku']!r} barcode={n['barcode']!r} invItem={n['inventoryItem']['id'].split('/')[-1]}{flag}")
        print()


if __name__ == "__main__":
    main()
