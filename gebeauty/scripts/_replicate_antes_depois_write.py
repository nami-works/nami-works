"""Replicate product's antes_e_depois into discrete PAGE metafields on page 164358750528.
Creates 4 PAGE metafield definitions (custom namespace) if missing, then sets values.
Idempotent: definition create tolerates "already taken"; metafieldsSet is upsert.
Run: C:/Python314/python.exe gebeauty/scripts/_replicate_antes_depois_write.py
"""
import json, urllib.request, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')

TOKEN = None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='):
        TOKEN = line.strip().split('=', 1)[1]
URL = 'https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json'
PAGE_GID = "gid://shopify/Page/164358750528"

def graphql(query, variables=None):
    body = json.dumps({"query": query, **({"variables": variables} if variables else {})}).encode('utf-8')
    req = urllib.request.Request(URL, data=body, headers={
        'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode('utf-8'))

# values read from the product metaobject (gid://shopify/Metaobject/124024586560)
FOTO_ANTES = "gid://shopify/MediaImage/40163777904960"
FOTO_DEPOIS = "gid://shopify/MediaImage/40163778462016"
TITULO = "cachos definidos, protegidos e livres de frizz"
RESULTADOS = "{\"type\":\"root\",\"children\":[{\"type\":\"paragraph\",\"children\":[{\"type\":\"text\",\"value\":\"definição prolongada\",\"bold\":true}]},{\"type\":\"paragraph\",\"children\":[{\"type\":\"text\",\"value\":\"mantém o desenho dos cachos bonito por muito mais tempo.\"}]},{\"type\":\"paragraph\",\"children\":[{\"type\":\"text\",\"value\":\"frizz controlado\",\"bold\":true}]},{\"type\":\"paragraph\",\"children\":[{\"type\":\"text\",\"value\":\"reduz o arrepiado, mesmo em dias úmidos ou chuvosos.\"}]},{\"type\":\"paragraph\",\"children\":[{\"type\":\"text\",\"value\":\"toque macio e hidratado\",\"bold\":true}]},{\"type\":\"paragraph\",\"children\":[{\"type\":\"text\",\"value\":\"deixa os fios leves, com balanço e brilho saudável.\"}]}]}"

DEFS = [
    {"name": "Antes/Depois - foto antes", "key": "antes_foto", "type": "file_reference",
     "validations": [{"name": "file_type_options", "value": "[\"Image\"]"}]},
    {"name": "Antes/Depois - foto depois", "key": "depois_foto", "type": "file_reference",
     "validations": [{"name": "file_type_options", "value": "[\"Image\"]"}]},
    {"name": "Antes/Depois - título", "key": "antes_depois_titulo", "type": "single_line_text_field",
     "validations": []},
    {"name": "Antes/Depois - resultado", "key": "antes_depois_resultado", "type": "rich_text_field",
     "validations": []},
]

CREATE = """
mutation($def: MetafieldDefinitionInput!) {
  metafieldDefinitionCreate(definition: $def) {
    createdDefinition { id namespace key type { name } }
    userErrors { field message code }
  }
}
"""
print("=== CREATE DEFINITIONS ===")
for d in DEFS:
    var = {"def": {
        "name": d["name"], "namespace": "custom", "key": d["key"],
        "type": d["type"], "ownerType": "PAGE", "validations": d["validations"],
    }}
    r = graphql(CREATE, var)
    node = r.get("data", {}).get("metafieldDefinitionCreate", {})
    errs = node.get("userErrors", [])
    if errs:
        # TAKEN means it already exists -> fine (reuse)
        print(f'custom.{d["key"]}: {errs}')
    else:
        cd = node.get("createdDefinition")
        print(f'created custom.{cd["key"]} [{cd["type"]["name"]}]')

SET = """
mutation($mf: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $mf) {
    metafields { namespace key type value }
    userErrors { field message code }
  }
}
"""
mfs = [
    {"ownerId": PAGE_GID, "namespace": "custom", "key": "antes_foto",
     "type": "file_reference", "value": FOTO_ANTES},
    {"ownerId": PAGE_GID, "namespace": "custom", "key": "depois_foto",
     "type": "file_reference", "value": FOTO_DEPOIS},
    {"ownerId": PAGE_GID, "namespace": "custom", "key": "antes_depois_titulo",
     "type": "single_line_text_field", "value": TITULO},
    {"ownerId": PAGE_GID, "namespace": "custom", "key": "antes_depois_resultado",
     "type": "rich_text_field", "value": RESULTADOS},
]
print("\n=== SET VALUES ===")
r = graphql(SET, {"mf": mfs})
node = r.get("data", {}).get("metafieldsSet", {})
if node.get("userErrors"):
    print("ERRORS:", node["userErrors"])
for m in node.get("metafields", []):
    print(f'{m["namespace"]}.{m["key"]} [{m["type"]}] = {m["value"][:100]}')

# verify by re-reading the page
VERIFY = """
query {
  page(id: "gid://shopify/Page/164358750528") {
    metafields(first: 100) { edges { node { namespace key type value } } }
  }
}
"""
print("\n=== VERIFY (page re-read) ===")
r = graphql(VERIFY)
for e in r["data"]["page"]["metafields"]["edges"]:
    n = e["node"]
    print(f'{n["namespace"]}.{n["key"]} [{n["type"]}] = {n["value"][:100]}')
