"""Ended-campaign LP cleanup (page 164513415488, namespace custom; gated to THIS page).
KILL the 'como funciona' pills + the FAQ (delete their metafields so the sections self-collapse).
REFRAME the collection block to 'leve a linha completa'. Cards + tabs + trust badges + footer stay."""
import json, urllib.request
from pathlib import Path

def load_env():
    env = {}
    for line in (Path(__file__).resolve().parents[1] / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1); env[k.strip()] = v.strip()
    return env

ENV = load_env()
SHOP, TOKEN = ENV["SHOPIFY_SHOP_DOMAIN"], ENV["SHOPIFY_ADMIN_ACCESS_TOKEN"]
VER = ENV.get("SHOPIFY_API_VERSION", "2026-01")
URL = f"https://{SHOP}/admin/api/{VER}/graphql.json"
PAGE = "gid://shopify/Page/164513415488"

def gql(q, v):
    body = json.dumps({"query": q, "variables": v}).encode()
    req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    out = json.loads(urllib.request.urlopen(req).read().decode())
    if out.get("errors"): print("ERR", json.dumps(out["errors"])[:500])
    return out

# 1) DELETE pills + FAQ metafields -> sections collapse
kill_keys = [
    "intro_titulo", "intro_ponto_1", "intro_ponto_2", "intro_ponto_3", "intro_ponto_4",
    "faq_titulo",
    "faq_1_pergunta", "faq_1_resposta", "faq_2_pergunta", "faq_2_resposta",
    "faq_3_pergunta", "faq_3_resposta", "faq_4_pergunta", "faq_4_resposta",
]
DEL = """mutation d($m:[MetafieldIdentifierInput!]!){metafieldsDelete(metafields:$m){deletedMetafields{key} userErrors{field message}}}"""
dm = [{"ownerId": PAGE, "namespace": "custom", "key": k} for k in kill_keys]
r1 = gql(DEL, {"m": dm}).get("data", {}).get("metafieldsDelete", {})
print("deleted:", [x["key"] for x in r1.get("deletedMetafields", [])])
print("delete errors:", json.dumps(r1.get("userErrors", [])))

# 2) REFRAME collection block
def rt(t): return json.dumps({"type": "root", "children": [{"type": "paragraph", "children": [{"type": "text", "value": t}]}]})
SET = """mutation m($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){metafields{key} userErrors{field message}}}"""
sm = [
    {"ownerId": PAGE, "namespace": "custom", "key": "colecao_titulo", "type": "single_line_text_field", "value": "<strong>leve a linha completa</strong>"},
    {"ownerId": PAGE, "namespace": "custom", "key": "colecao_descricao", "type": "rich_text_field", "value": rt("monte a sua rotina com os tamanhos cheios. o frete é grátis a partir de R$299")},
]
r2 = gql(SET, {"m": sm}).get("data", {}).get("metafieldsSet", {})
print("reframed:", [x["key"] for x in r2.get("metafields", [])])
print("set errors:", json.dumps(r2.get("userErrors", [])))
