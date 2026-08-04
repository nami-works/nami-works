"""Fetch the 'como combinar' (layering) description from the descricao_longa
metaobject for boosters Hidratante(020), Fortificante(019), Antioxidante(023).
Run from c:\\claude\\gebeauty."""
import json, sys, urllib.request
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
cfg = {}
for l in Path(".env").read_text(encoding="utf-8").splitlines():
    l = l.strip()
    if l.startswith("SHOPIFY") and "=" in l:
        k, v = l.split("=", 1); cfg[k.strip()] = v.strip().strip('"').strip("'")
URL = f"https://{cfg['SHOPIFY_SHOP_DOMAIN']}/admin/api/{cfg.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
def gql(q, v=None):
    b = json.dumps({"query": q, "variables": v or {}}).encode()
    r = urllib.request.Request(URL, data=b, headers={"Content-Type": "application/json", "X-Shopify-Access-Token": cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]})
    return json.loads(urllib.request.urlopen(r).read().decode())
Q = """
query($q:String!){ products(first:1, query:$q){ nodes{ title
  longa: metafield(namespace:"custom", key:"descricao_longa_com_abas"){
    reference{ ... on Metaobject{ fields{ key value } } } } } } }
"""
for sku in ["GEB 019", "GEB 020", "GEB 023"]:
    n = gql(Q, {"q": f"sku:'{sku}' AND product_type:product"})["data"]["products"]["nodes"][0]
    fields = {}
    if n.get("longa") and n["longa"].get("reference"):
        fields = {f["key"]: f["value"] for f in n["longa"]["reference"]["fields"]}
    print("\n" + "=" * 78)
    print(f"{sku}  {n['title']}")
    print(f"  (tab keys present: {list(fields)})")
    print("-" * 78)
    print("layering (dedicated 'como combinar' field):", fields.get("layering") or "(EMPTY)")
    print("\npasso_a_passo (holds the combination steps):\n")
    print(fields.get("passo_a_passo") or "(empty)")
