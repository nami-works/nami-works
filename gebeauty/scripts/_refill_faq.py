"""Refill the LP FAQ with evergreen product/shipping/returns Q&As (page 164513415488).
The 'kill FAQ' delete left empty accordion rows, so repopulate instead. No cortesia, no invented numbers."""
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

def rt(t): return json.dumps({"type": "root", "children": [{"type": "paragraph", "children": [{"type": "text", "value": t}]}]})

single = {
    "faq_titulo": "perguntas rápidas",
    "faq_1_pergunta": "o que é o travel size?",
    "faq_2_pergunta": "é a mesma fórmula do tamanho cheio?",
    "faq_3_pergunta": "quanto custa o frete?",
    "faq_4_pergunta": "como funciona a devolução?",
}
rich = {
    "faq_1_resposta": "É a nossa linha em tamanho de viagem, para você conhecer o shampoo sem sulfato, a máscara ou o leave-in com proteção térmica antes de levar o tamanho cheio.",
    "faq_2_resposta": "Sim, é a mesma fórmula, só em um tamanho menor.",
    "faq_3_resposta": "O frete é calculado pelo seu CEP no checkout. Pedidos a partir de R$299 têm frete grátis, como em toda a loja.",
    "faq_4_resposta": "Você tem até 7 dias para trocar ou devolver, como em toda a loja.",
}
metas = [{"ownerId": PAGE, "namespace": "custom", "key": k, "type": "single_line_text_field", "value": v} for k, v in single.items()]
metas += [{"ownerId": PAGE, "namespace": "custom", "key": k, "type": "rich_text_field", "value": rt(v)} for k, v in rich.items()]

Q = """mutation m($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){metafields{key} userErrors{field message}}}"""
body = json.dumps({"query": Q, "variables": {"m": metas}}).encode()
req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
out = json.loads(urllib.request.urlopen(req).read().decode())
res = out.get("data", {}).get("metafieldsSet", {})
print("refilled:", [m["key"] for m in res.get("metafields", [])])
print("errors:", json.dumps(res.get("userErrors", [])))
