"""Check whether custom.ingredients has a metafield DEFINITION (product owner),
and confirm the value actually persisted on GEB 001. Explains why admin search
shows nothing (unstructured metafields don't appear in the defined search)."""
import json
import sys
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ENV = Path(__file__).resolve().parent.parent / ".env"


def load_env(p):
    o = {}
    for l in p.read_text(encoding="utf-8").splitlines():
        l = l.strip()
        if l and not l.startswith("#") and "=" in l:
            k, v = l.split("=", 1)
            o[k.strip()] = v.strip().strip('"').strip("'")
    return o


cfg = load_env(ENV)
URL = f"https://{cfg.get('SHOPIFY_SHOP_DOMAIN','ge-beauty-cosmeticos.myshopify.com')}/admin/api/{cfg.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
TOKEN = cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]


def gql(query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode("utf-8"))


DEFS = """
query {
  metafieldDefinitions(first: 25, ownerType: PRODUCT, namespace: "custom") {
    nodes { name key type { name } }
  }
}
"""

VAL = """
query {
  product(id: "gid://shopify/Product/8803151282496") {
    mf: metafield(namespace: "custom", key: "ingredients") { value type id }
  }
}
"""


def main():
    d = gql(DEFS)
    defs = d["data"]["metafieldDefinitions"]["nodes"]
    keys = [f"{n['key']}" for n in defs]
    print("DEFINED custom.* product metafields (", len(keys), "):")
    for n in defs:
        print(f"   custom.{n['key']}  ({n['type']['name']})")
    print()
    print("custom.ingredients has a DEFINITION?:", "ingredients" in keys)
    v = gql(VAL)["data"]["product"]["mf"]
    print("custom.ingredients VALUE on GEB 001:", (v or {}).get("value"))


if __name__ == "__main__":
    main()
