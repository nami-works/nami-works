"""One-off: set custom.ingredients (friendly 'for dummies' version) on the REAL
GEB 001 Shampoo sem Sulfato product so Lucas can see how it renders.
Approved single write. Targets the product-type SKU, never the [rappi] dupe.
"""
import json
import urllib.request
from pathlib import Path

ENV = Path(__file__).resolve().parent.parent / ".env"


def load_env(path):
    out = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


cfg = load_env(ENV)
DOMAIN = cfg.get("SHOPIFY_SHOP_DOMAIN", "ge-beauty-cosmeticos.myshopify.com")
TOKEN = cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]
VERSION = cfg.get("SHOPIFY_API_VERSION", "2026-01")
URL = f"https://{DOMAIN}/admin/api/{VERSION}/graphql.json"

PRODUCT_ID = "gid://shopify/Product/8803151282496"  # real shampoo sem sulfato (NOT rappi)
VALUE = ("Limpeza suave sem sulfato: manteiga de murumuru, óleos de abacate, "
         "girassol e crambe, D-pantenol e glicerina.")

MUT = """
mutation($mf: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $mf) {
    metafields { id namespace key type value ownerType }
    userErrors { field message }
  }
}
"""


def graphql(q, v=None):
    body = json.dumps({"query": q, "variables": v or {}}).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    variables = {"mf": [{
        "ownerId": PRODUCT_ID, "namespace": "custom", "key": "ingredients",
        "type": "single_line_text_field", "value": VALUE,
    }]}
    d = graphql(MUT, variables)
    print(json.dumps(d, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
