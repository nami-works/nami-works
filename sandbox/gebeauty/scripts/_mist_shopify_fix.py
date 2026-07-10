"""
Re-key the 3 Body & Hair Mist variant SKUs on Shopify to match Omie's codes,
so the two systems connect on the same SKU.

  Santal Skin (barcode 0631911748233): GEB 027 -> GEB 031
  Rose Ritual (barcode 0631911748226): GEB 025 -> GEB 032
  Pear Fresh  (barcode 0631911748219): GEB 026 -> GEB 033

Uses productVariantsBulkUpdate with inventoryItem.sku — runs under write_products
(the token has no write_inventory scope, so inventoryItemUpdate is denied).
Guard: re-read each variant's sku + barcode; only write if the barcode matches
the expected EAN and the sku isn't already the target (idempotent).
"""

import json
import urllib.request
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"

# variant id -> (fragrance, expected EAN, expected old sku, target sku)
PLAN = {
    "52563935723840": ("Santal Skin", "0631911748233", "GEB 027", "GEB 031"),
    "52563935658304": ("Rose Ritual", "0631911748226", "GEB 025", "GEB 032"),
    "52563935691072": ("Pear Fresh", "0631911748219", "GEB 026", "GEB 033"),
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

    READ = """
    query($id: ID!) {
      productVariant(id: $id) { id sku barcode product { id title } }
    }
    """
    WRITE = """
    mutation($pid: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $pid, variants: $variants) {
        productVariants { id sku }
        userErrors { field message }
      }
    }
    """

    print(f"[shopify] {domain} api={ver}\n")
    for vid, (frag, ean, old_sku, target) in PLAN.items():
        gid = f"gid://shopify/ProductVariant/{vid}"
        v = gql(READ, {"id": gid})["data"]["productVariant"]
        print(f"=== {frag} (variant {vid}) — {v['product']['title']!r} ===")
        print(f"  current sku={v['sku']!r} barcode={v['barcode']!r}  | target {target!r}")

        if v["barcode"] != ean:
            print(f"  SKIP: barcode {v['barcode']!r} != expected {ean!r} — not touching.\n")
            continue
        if v["sku"] == target:
            print(f"  SKIP: already {target!r}.\n")
            continue
        if v["sku"] != old_sku:
            print(f"  NOTE: current sku {v['sku']!r} != expected old {old_sku!r}; barcode matches so proceeding.")

        res = gql(WRITE, {
            "pid": v["product"]["id"],
            "variants": [{"id": gid, "inventoryItem": {"sku": target}}],
        })["data"]["productVariantsBulkUpdate"]
        if res["userErrors"]:
            print(f"  ERROR: {res['userErrors']}\n")
        else:
            print(f"  UPDATED -> sku={res['productVariants'][0]['sku']!r}\n")


if __name__ == "__main__":
    main()
