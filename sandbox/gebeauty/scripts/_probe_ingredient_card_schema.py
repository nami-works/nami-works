"""Find the metaobject definition behind custom.ingredientes_com_foto (the photo
ingredient-card carousel in the redesigned PDP), so we know each card's fields
(name / description / image). Also report any existing card metaobjects."""
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
URL = f"https://{cfg['SHOPIFY_SHOP_DOMAIN']}/admin/api/{cfg.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
TOKEN = cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]


def gql(query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode("utf-8"))


# 1) the metafield definition -> referenced metaobject type
MFDEF = """
query {
  metafieldDefinitions(first: 5, ownerType: PRODUCT, namespace: "custom", key: "ingredientes_com_foto") {
    nodes { name key type { name } validations { name value } }
  }
}
"""
# 2) all metaobject definitions (find the ingredient card one + its fields)
MODEFS = """
query {
  metaobjectDefinitions(first: 50) {
    nodes { type name fieldDefinitions { key name type { name } } metaobjectsCount }
  }
}
"""


def main():
    d = gql(MFDEF)["data"]["metafieldDefinitions"]["nodes"]
    print("=== custom.ingredientes_com_foto definition ===")
    for n in d:
        print(" ", n["name"], "| type:", n["type"]["name"])
        for v in n.get("validations", []):
            print("    validation:", v["name"], "=", v["value"])
    print("\n=== metaobject definitions (looking for ingredient card) ===")
    for m in gql(MODEFS)["data"]["metaobjectDefinitions"]["nodes"]:
        t = m["type"].lower()
        if any(w in t or w in m["name"].lower() for w in ["ingred", "ativo", "card"]):
            print(f"  * {m['type']}  ({m['name']})  count={m['metaobjectsCount']}")
            for f in m["fieldDefinitions"]:
                print(f"       {f['key']} ({f['type']['name']}) - {f['name']}")


if __name__ == "__main__":
    main()
