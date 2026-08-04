"""Read-only: harvest structures needed for full siblings-parity enrichment:
 (1) descricao_longa metaobject DEFINITION (tab field schema),
 (2) component descricao_longa metaobjects (GEB 001 = 45617152320, GEB 019 = 45620134208) for content,
 (3) a sibling dupla that HAS descricao_longa_com_abas + etiquetas + related, to mirror.
Run from c:\\claude\\gebeauty: C:/Python314/python.exe scripts/_dupla_parity_harvest.py"""
import json, sys, urllib.request
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
ENV = Path(__file__).resolve().parent.parent / ".env"
cfg = {}
for l in ENV.read_text(encoding="utf-8").splitlines():
    l = l.strip()
    if l.startswith("SHOPIFY") and "=" in l:
        k, v = l.split("=", 1); cfg[k.strip()] = v.strip().strip('"').strip("'")
URL = f"https://{cfg['SHOPIFY_SHOP_DOMAIN']}/admin/api/{cfg.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
def gql(q, v=None):
    b = json.dumps({"query": q, "variables": v or {}}).encode()
    r = urllib.request.Request(URL, data=b, headers={"Content-Type": "application/json", "X-Shopify-Access-Token": cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]})
    return json.loads(urllib.request.urlopen(r).read().decode())

# 1) metaobject definition for descricao_longa
print("="*70); print("(1) descricao_longa DEFINITION"); print("="*70)
DEF = """query{ metaobjectDefinitionByType(type:"descricao_longa"){
  id name type
  fieldDefinitions{ key name type{ name } required }
}}"""
d = gql(DEF)["data"]["metaobjectDefinitionByType"]
if d:
    print("def:", d["id"], d["type"])
    for f in d["fieldDefinitions"]:
        print(f"   - {f['key']}  ({f['type']['name']})  req={f['required']}  [{f['name']}]")

# 2) component descricao_longa metaobjects
print("\n"+"="*70); print("(2) COMPONENT descricao_longa metaobjects"); print("="*70)
MO = """query($id:ID!){ metaobject(id:$id){ id type handle fields{ key type value } } }"""
for label, gid in [("GEB001 shampoo","gid://shopify/Metaobject/45617152320"),
                   ("GEB019 booster","gid://shopify/Metaobject/45620134208")]:
    m = gql(MO, {"id": gid})["data"]["metaobject"]
    print(f"\n### {label} — {m['handle']} ({m['type']})")
    for f in m["fields"]:
        val = f["value"] or ""
        short = val if len(val) <= 400 else val[:397]+"..."
        print(f"   [{f['key']}] ({f['type']}) = {short}")

# 3) sibling dupla WITH descricao_longa_com_abas + etiquetas + related
print("\n"+"="*70); print("(3) SIBLING dupla parity reference"); print("="*70)
SQ = """query($q:String!){ products(first:1,query:$q){ nodes{
  id title
  descLonga: metafield(namespace:"custom", key:"descricao_longa_com_abas"){ value }
  etiquetas: metafield(namespace:"custom", key:"etiquetas"){ value type }
  related: metafield(namespace:"shopify--discovery--product_recommendation", key:"related_products"){ value }
  relatedDisp: metafield(namespace:"shopify--discovery--product_recommendation", key:"related_products_display"){ value }
}}}"""
for handle in ["kit-protetor-solar-do-cabelo", "leave-in-booster-definicao-b"]:
    n = gql(SQ, {"q": f"handle:{handle}"})["data"]["products"]["nodes"]
    if not n:
        print(f"\n{handle}: not found"); continue
    n = n[0]
    print(f"\n### {n['title']} ({handle})")
    print("   descLonga ref:", (n.get("descLonga") or {}).get("value"))
    et = n.get("etiquetas") or {}
    print("   etiquetas:", et.get("value"), "type:", et.get("type"))
    print("   related:", (n.get("related") or {}).get("value"))
    print("   relatedDisp:", (n.get("relatedDisp") or {}).get("value"))

# resolve the etiquetas metaobject(s) on the protetor solar sibling to see what a kit badge looks like
print("\n"+"="*70); print("(3b) resolve one dupla's etiquetas metaobject content"); print("="*70)
ET = gql(SQ, {"q": "handle:kit-protetor-solar-do-cabelo"})["data"]["products"]["nodes"][0].get("etiquetas") or {}
if ET.get("value"):
    try:
        ids = json.loads(ET["value"]) if ET["value"].startswith("[") else [ET["value"]]
    except Exception:
        ids = [ET["value"]]
    for gid in ids:
        m = gql(MO, {"id": gid})["data"]["metaobject"]
        if m:
            print(f"   etiqueta {m['handle']} ({m['type']}):")
            for f in m["fields"]:
                print(f"      [{f['key']}] = {f['value']}")
