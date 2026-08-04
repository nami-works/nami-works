#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Page 1 of the educational LP set: "fios leves, sem acúmulo" (efeito build-up).

Base template: multi-product (verified present on main theme 181379236160).
Created as a DRAFT. Nothing is published; the publish gate is Lucas's.

Run:
  python3 build_page1.py            # dry run, prints the plan, writes nothing
  python3 build_page1.py --apply    # creates the page + sets metafields
"""
import argparse
import json
import os
import sys
import urllib.request

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..")
THEME = "181379236160"

HANDLE = "fios-leves-sem-acumulo"
TITLE = "fios leves, sem acúmulo"
KIT_HANDLE = "primeira-rotina-shampoo-a-seco"     # rotina com frescor prolongado, R$259
COLLECTION_HANDLE = "essenciais-da-rotina"


def env():
    v = {}
    with open(os.path.join(BASE, ".env"), encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, val = line.split("=", 1)
                v[k.strip()] = val.strip().strip('"').strip("'")
    return v


E = env()
DOMAIN = E.get("SHOPIFY_SHOP_DOMAIN") or "ge-beauty-cosmeticos.myshopify.com"
VER = E.get("SHOPIFY_API_VERSION") or "2026-01"
URL = f"https://{DOMAIN}/admin/api/{VER}/graphql.json"


def gql(q, v=None):
    body = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": E["SHOPIFY_ADMIN_ACCESS_TOKEN"]})
    with urllib.request.urlopen(req, timeout=45) as r:
        d = json.loads(r.read().decode())
    if "errors" in d:
        raise SystemExit("GraphQL error: " + json.dumps(d["errors"])[:800])
    return d


def rt(paragraphs):
    """HTML-ish paragraphs -> Shopify rich_text_field JSON AST (values must be AST, not HTML)."""
    return json.dumps({
        "type": "root",
        "children": [
            {"type": "paragraph",
             "children": [{"type": "text", "value": p}]}
            for p in paragraphs
        ]
    }, ensure_ascii=False)


# ---------------------------------------------------------------- page content
# Copy is the approved page-1 copy from content.py, adapted to the slots that
# actually exist on multi-product. Voice rules: no em-dash, no invented numbers,
# actives named only bound to their benefit.
HERO_HEADING = "seu cabelo não acostumou. ele acumulou."
HERO_SUB = ("aquele produto que parecia ter perdido o efeito não perdeu nada. "
            "o que mudou foi o que ficou depositado no fio.")

# GAP A compromise: lp-destaques pills are single_line, so each answer step is
# compressed into one line. The per-step explanation is what the extended
# section will restore.
INTRO_TITULO = "o que é o efeito build-up"
PONTOS = [
    "resíduo se acumula no fio camada por camada, lavagem após lavagem",
    "essa camada bloqueia a hidratação, e a máscara passa a agir sobre o resíduo",
    "o fio fica pesado e opaco, sem balanço, com sensação de sujo mesmo limpo",
    "parece que o produto parou de funcionar. ele só não está mais chegando no fio",
]

CARDS_TITULO = "o reset do fio, em três passos"

FAQ_TITULO = "perguntas que vocês fizeram"
FAQ = [
    ("o shampoo GE pode ser considerado detox?",
     ["ele faz limpeza profunda sem sulfato: tira o resíduo acumulado e mantém o equilíbrio "
      "do couro cabeludo. é esse o efeito que as pessoas procuram quando falam em detox, sem "
      "a agressão de um shampoo anti-resíduo tradicional."]),
    ("em quanto tempo o cabelo volta a responder?",
     ["o toque muda já na primeira lavagem com o fio limpo. a leveza e o balanço voltam com "
      "a constância da rotina."]),
    ("preciso parar de usar meus finalizadores?",
     ["não. o ponto é a base: com limpeza e nutrição certas, o finalizador rende mais em vez "
      "de virar mais uma camada."]),
]

COLECAO_TITULO = "monte a sua rotina completa"
COLECAO_DESC = ["os essenciais que trabalham juntos, no seu tempo e do seu jeito."]

# The ingredients pattern proven from the PDP: product context resolves inside
# featured-product (featured-product.liquid line 31 aliases `product`), so the
# ingredient metaobject is read straight off the product, exactly as the PDP does.
INGREDIENTS_CUSTOM_LIQUID = (
    '{%- assign ing = product.metafields.custom.descricao_longa_com_abas.value.ingredientes -%}\n'
    '{%- if ing != blank -%}\n'
    '  <div class="lp-ingredientes rte">\n'
    '    <h3 class="lp-ingredientes__t">feito com ativos que entregam</h3>\n'
    '    {{ ing | metafield_tag }}\n'
    '  </div>\n'
    '{%- endif -%}'
)


def resolve():
    d = gql("""
    query($p:String!,$c:String!,$h:String!){
      products(first:1,query:$p){nodes{id title handle}}
      collections(first:1,query:$c){nodes{id title handle}}
      pages(first:1,query:$h){nodes{id handle}}
    }""", {"p": f"handle:{KIT_HANDLE}", "c": f"handle:{COLLECTION_HANDLE}",
           "h": f"handle:{HANDLE}"})["data"]
    prod = d["products"]["nodes"]
    coll = d["collections"]["nodes"]
    existing = d["pages"]["nodes"]
    if not prod:
        raise SystemExit(f"product {KIT_HANDLE} not found")
    return prod[0], (coll[0] if coll else None), (existing[0] if existing else None)


def metafields(prod_gid, coll_gid):
    mf = [
        ("hero_heading", "single_line_text_field", HERO_HEADING),
        ("hero_subheading", "single_line_text_field", HERO_SUB),
        ("intro_titulo", "single_line_text_field", INTRO_TITULO),
        ("cards_titulo", "single_line_text_field", CARDS_TITULO),
        ("produto_em_destaque_1", "product_reference", prod_gid),
        ("faq_titulo", "single_line_text_field", FAQ_TITULO),
        ("tab_1_label", "single_line_text_field", "como usar"),
        ("tab_2_label", "single_line_text_field", "resultados"),
        ("tab_3_label", "single_line_text_field", "saiba mais"),
    ]
    for i, p in enumerate(PONTOS, 1):
        mf.append((f"intro_ponto_{i}", "single_line_text_field", p))
    for i, (q, a) in enumerate(FAQ, 1):
        mf.append((f"faq_{i}_pergunta", "single_line_text_field", q))
        mf.append((f"faq_{i}_resposta", "rich_text_field", rt(a)))
    if coll_gid:
        mf.append(("colecao_titulo", "single_line_text_field", COLECAO_TITULO))
        mf.append(("colecao_descricao", "rich_text_field", rt(COLECAO_DESC)))
        mf.append(("colecao_em_destaque_1", "collection_reference", coll_gid))
    return mf


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    prod, coll, existing = resolve()
    mf = metafields(prod["id"], coll["id"] if coll else None)

    print("=" * 74)
    print(f"PAGE 1  {TITLE}   /pages/{HANDLE}")
    print("=" * 74)
    print(f"  template suffix   multi-product")
    print(f"  published         NO (draft)")
    print(f"  offer product     {prod['title']}  ({prod['handle']})")
    print(f"  collection        {coll['handle'] if coll else '(none, section will self-hide)'}")
    print(f"  existing page     {existing['id'] if existing else 'none, will create'}")
    print(f"\n  {len(mf)} metafields to set (cap is 25 per metafieldsSet call):")
    for k, t, v in mf:
        prev = v if len(str(v)) < 62 else str(v)[:59] + "..."
        print(f"    {k:<24} {t:<24} {prev}")
    print(f"\n  ingredients: custom_liquid block inside card_1 (product context "
          f"resolves via featured-product line 31)")

    if not a.apply:
        print("\nDRY RUN. nothing written. re-run with --apply")
        return

    # 1. create or reuse the page, as a DRAFT
    if existing:
        pid = existing["id"]
        print(f"\nreusing existing page {pid}")
    else:
        d = gql("""
        mutation($p:PageCreateInput!){ pageCreate(page:$p){
          page{id handle} userErrors{field message} } }""",
                {"p": {"title": TITLE, "handle": HANDLE,
                       "templateSuffix": "multi-product",
                       "isPublished": False,
                       "body": ""}})["data"]["pageCreate"]
        if d["userErrors"]:
            raise SystemExit("pageCreate failed: " + json.dumps(d["userErrors"]))
        pid = d["page"]["id"]
        print(f"\ncreated DRAFT page {pid}  /pages/{d['page']['handle']}")

    # 2. set metafields in batches of 25
    q = """mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){
      metafields{key} userErrors{field message code} } }"""
    for i in range(0, len(mf), 25):
        batch = [{"ownerId": pid, "namespace": "custom", "key": k,
                  "type": t, "value": str(v)} for k, t, v in mf[i:i + 25]]
        r = gql(q, {"m": batch})["data"]["metafieldsSet"]
        if r["userErrors"]:
            print("  ERRORS:", json.dumps(r["userErrors"], ensure_ascii=False)[:600])
        print(f"  set {len(r['metafields'])} metafields (batch {i//25+1})")

    print(f"\nDONE. draft page: https://{DOMAIN}/admin/online_store/pages/"
          f"{pid.split('/')[-1]}")
    print("Ingredients custom_liquid block + banners are the next step.")


if __name__ == "__main__":
    main()
