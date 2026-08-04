#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Wires page 1 to the build-up carousel and rewrites its copy around the ad's real argument.

Why the rewrite: the organic carousel argues a specific case — silicone (a petroleum-derived
synthetic) forms an IMPERMEABLE layer, the layer thickens with continued use, nutrient
absorption is blocked, hair goes opaque and lifeless; the fix is not to suffocate the hair
further but to remove the excess, which is why the ritual substitutes natural oils and
biodegradable actives for silicone. The first version of this page never said "silicone",
so it failed message match on substance, not just format.

New structure:
  hero              ad's exact reframe
  carrossel  (NEW)  the 6 IG slides, swipeable, alt text carries the copy
  oquesao           REPURPOSED: the solution mechanism (was: the problem, now the carousel's job)
  punchline         "o seu ritual livre de build-up, em três passos"
  passos     (NEW)  3 numbered steps, product image pulled from the kit's itens_do_kit
  card_1            the kit = the single buy action (a lone SKU fails the margin floor)
  promo / kits / faq
  fechamento (NEW)  closes on the ad's own words: "monte o seu ritual livre de build-up"

  python3 wire_page1_carousel.py            # dry run
  python3 wire_page1_carousel.py --apply
"""
import argparse
import json
import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, "..", "..", "..")
PAGE_GID = "gid://shopify/Page/165086331200"


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


def gql(q, v=None):
    body = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    req = urllib.request.Request(f"https://{DOMAIN}/admin/api/{VER}/graphql.json",
                                 data=body, headers={
                                     "Content-Type": "application/json",
                                     "X-Shopify-Access-Token": E["SHOPIFY_ADMIN_ACCESS_TOKEN"]})
    with urllib.request.urlopen(req, timeout=50) as r:
        d = json.loads(r.read().decode())
    if "errors" in d:
        raise SystemExit("GraphQL: " + json.dumps(d["errors"])[:700])
    return d


def rt(paragraphs):
    return json.dumps({"type": "root", "children": [
        {"type": "paragraph", "children": [{"type": "text", "value": p}]}
        for p in paragraphs]}, ensure_ascii=False)


# ---------------------------------------------------------- definitions to create
NEW_DEFS = (
    [(f"carrossel_{i}", "file_reference", f"LP · carrossel slide {i}") for i in range(1, 7)]
    + [(f"passo_{i}_titulo", "single_line_text_field", f"LP · passo {i} título") for i in (1, 2, 3)]
    + [(f"passo_{i}_texto", "rich_text_field", f"LP · passo {i} texto") for i in (1, 2, 3)]
)

# ---------------------------------------------------------------- rewritten copy
# oquesao repurposed: the SOLUTION mechanism, ingredient-as-proof, straight from the ad.
INTRO_TITULO = "o que a GE Beauty faz diferente"
PONTOS = [
    "óleos naturais e ativos biodegradáveis <strong>em substituição ao silicone</strong>",
    "penetram na fibra e tratam o fio, em vez de formar camada sobre ele",
    "garantem <strong>permeabilidade</strong>, então a nutrição chega onde precisa",
    "<strong>zero acúmulo de resíduos</strong>, lavagem após lavagem",
]
CARDS_TITULO = "o seu ritual livre de build-up, em três passos"

PASSOS = [
    ("limpa", ["o shampoo sem sulfato purifica sem agredir. a manteiga de murumuru repõe a "
               "maciez e o pantenol hidrata sem pesar."]),
    ("nutre", ["a máscara condicionadora sela as cutículas com óleo de abacate, que hidrata "
               "em profundidade, e crambe, que reduz o frizz."]),
    ("refresca", ["nos dias sem chuveiro, o shampoo a seco absorve a oleosidade com H-Vit "
                  "Plus e devolve sensação de frescor com pantenol."]),
]

FAQ_TITULO = "antes de começar a sua rotina"

FECHAMENTO_TITULO = "monte o seu ritual livre de build-up"
FECHAMENTO_TEXTO = ["fórmula limpa, livre de crueldade animal, sem silicone. "
                    "no seu tempo, do seu jeito."]
FECHAMENTO_BOTAO = "quero a rotina completa"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    files = json.load(open(os.path.join(HERE, "carousel_file_ids.json"), encoding="utf-8"))
    slide_ids = {x["slide"]: x["id"] for x in files}

    existing = {n["key"] for n in gql(
        "{metafieldDefinitions(first:250,ownerType:PAGE){nodes{key}}}"
    )["data"]["metafieldDefinitions"]["nodes"]}
    to_create = [d for d in NEW_DEFS if d[0] not in existing]

    mf = [("intro_titulo", "single_line_text_field", INTRO_TITULO),
          ("cards_titulo", "single_line_text_field", CARDS_TITULO),
          ("faq_titulo", "single_line_text_field", FAQ_TITULO),
          ("fechamento_titulo", "single_line_text_field", FECHAMENTO_TITULO),
          ("fechamento_texto", "rich_text_field", rt(FECHAMENTO_TEXTO)),
          ("fechamento_botao", "single_line_text_field", FECHAMENTO_BOTAO)]
    for i, p in enumerate(PONTOS, 1):
        mf.append((f"intro_ponto_{i}", "single_line_text_field", p))
    for i in range(1, 7):
        mf.append((f"carrossel_{i}", "file_reference", slide_ids[i]))
    for i, (t, txt) in enumerate(PASSOS, 1):
        mf.append((f"passo_{i}_titulo", "single_line_text_field", t))
        mf.append((f"passo_{i}_texto", "rich_text_field", rt(txt)))

    print("=" * 74)
    print("WIRE PAGE 1 -> carousel + rewritten copy")
    print("=" * 74)
    print(f"  definitions to create: {len(to_create)}")
    for k, t, n in to_create:
        print(f"    + {k:<20} {t}")
    print(f"\n  metafield values to set: {len(mf)}")
    for k, t, v in mf:
        prev = str(v)[:58] + ("..." if len(str(v)) > 58 else "")
        print(f"    {k:<20} {prev}")

    if not a.apply:
        print("\nDRY RUN. nothing written. re-run with --apply")
        return

    for key, typ, name in to_create:
        r = gql("""mutation($d:MetafieldDefinitionInput!){ metafieldDefinitionCreate(definition:$d){
          createdDefinition{ key } userErrors{ field message code } } }""",
                {"d": {"name": name, "namespace": "custom", "key": key,
                       "type": typ, "ownerType": "PAGE"}})["data"]["metafieldDefinitionCreate"]
        if r["userErrors"]:
            print(f"    ! {key}: {json.dumps(r['userErrors'], ensure_ascii=False)[:180]}")
        else:
            print(f"    created {key}")

    q = """mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){
      metafields{ key } userErrors{ field message code } } }"""
    for i in range(0, len(mf), 25):
        batch = [{"ownerId": PAGE_GID, "namespace": "custom", "key": k,
                  "type": t, "value": str(v)} for k, t, v in mf[i:i + 25]]
        r = gql(q, {"m": batch})["data"]["metafieldsSet"]
        if r["userErrors"]:
            print("  ERRORS:", json.dumps(r["userErrors"], ensure_ascii=False)[:500])
        print(f"  set {len(r['metafields'])} values (batch {i//25+1})")
    print("\n  done. template sections next.")


if __name__ == "__main__":
    main()
