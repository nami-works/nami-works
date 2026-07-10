"""READ-ONLY: inspect the product's antes_e_depois metaobject + existing PAGE metafield defs.
No writes. Prints everything needed to plan the page-metafield replication.
"""
import json, urllib.request, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')

TOKEN = None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='):
        TOKEN = line.strip().split('=', 1)[1]
URL = 'https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json'

def graphql(query, variables=None):
    body = json.dumps({"query": query, **({"variables": variables} if variables else {})}).encode('utf-8')
    req = urllib.request.Request(URL, data=body, headers={
        'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode('utf-8'))

# 1. Product's antes_e_depois metaobject
q1 = """
query {
  product(id: "gid://shopify/Product/9668674879808") {
    title
    metafield(namespace: "custom", key: "antes_e_depois") {
      type
      value
      reference {
        ... on Metaobject {
          id
          type
          fields {
            key
            type
            value
            reference { ... on MediaImage { id image { url } } }
          }
        }
      }
    }
  }
}
"""
print("=== PRODUCT antes_e_depois ===")
r1 = graphql(q1)
print(json.dumps(r1, indent=2, ensure_ascii=False))

# 2. Existing PAGE metafield definitions
q2 = """
query {
  metafieldDefinitions(first: 100, ownerType: PAGE) {
    edges { node { namespace key name type { name } } }
  }
}
"""
print("\n=== PAGE metafield definitions ===")
r2 = graphql(q2)
for e in r2.get("data", {}).get("metafieldDefinitions", {}).get("edges", []):
    n = e["node"]
    print(f'{n["namespace"]}.{n["key"]} [{n["type"]["name"]}] name="{n["name"]}"')

# 3. Existing metafields on the target page
q3 = """
query {
  page(id: "gid://shopify/Page/164358750528") {
    title
    metafields(first: 100) {
      edges { node { namespace key type value } }
    }
  }
}
"""
print("\n=== PAGE 164358750528 existing metafields ===")
r3 = graphql(q3)
pg = r3.get("data", {}).get("page")
if pg:
    print("page title:", pg["title"])
    for e in pg["metafields"]["edges"]:
        n = e["node"]
        print(f'{n["namespace"]}.{n["key"]} [{n["type"]}] = {n["value"][:120]}')
else:
    print(json.dumps(r3, indent=2, ensure_ascii=False))
