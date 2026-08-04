#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pre-build verification for the multi-product LP port.

Checks the things the initiative says will silently break a build:
  1. which theme is actually role == main (CheckCommerce can swap it mid-session)
  2. templates/page.multi-product.json exists ON that theme
  3. every PAGE metafield definition in the multi-product register exists
     (a missing definition = 422 "dynamic source does not exist")
  4. the custom LP sections exist as theme assets
  5. the two live multi-product pages still resolve

Read-only. Writes nothing to the store.
"""
import json
import os
import urllib.error
import urllib.request

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..")


def env():
    vals = {}
    with open(os.path.join(BASE, ".env"), encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                vals[k.strip()] = v.strip().strip('"').strip("'")
    return vals


E = env()
DOMAIN = E.get("SHOPIFY_SHOP_DOMAIN") or "ge-beauty-cosmeticos.myshopify.com"
TOKEN = E["SHOPIFY_ADMIN_ACCESS_TOKEN"]
VER = E.get("SHOPIFY_API_VERSION") or "2026-01"
GQL = f"https://{DOMAIN}/admin/api/{VER}/graphql.json"


def rest(path):
    req = urllib.request.Request(
        f"https://{DOMAIN}/admin/api/{VER}/{path}",
        headers={"X-Shopify-Access-Token": TOKEN})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def gql(q, v=None):
    body = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    req = urllib.request.Request(GQL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode())


# Register from the initiative doc (multi-product template)
REGISTER = [
    "banner_desktop", "banner_mobile", "intro_titulo",
    "intro_ponto_1", "intro_ponto_2", "intro_ponto_3", "intro_ponto_4",
    "cards_titulo",
    "produto_em_destaque_1", "produto_em_destaque_2", "produto_em_destaque_3",
    "promo_icones", "faq_titulo",
    "faq_1_pergunta", "faq_1_resposta", "faq_2_pergunta", "faq_2_resposta",
    "faq_3_pergunta", "faq_3_resposta", "faq_4_pergunta", "faq_4_resposta",
    "colecao_titulo", "colecao_descricao", "colecao_em_destaque_1",
    "tab_1_label", "tab_2_label", "tab_3_label",
    "promo_note", "promo_code", "gift_mode", "gift_code",
]

SECTIONS = ["boosters-oquesao", "boosters-headline", "lp-promo-icones"]

print("=" * 74)
print("1. PUBLISHED THEME")
print("=" * 74)
themes = rest("themes.json?fields=id,name,role")["themes"]
main = next((t for t in themes if t["role"] == "main"), None)
for t in themes:
    mark = "  <== MAIN" if t["role"] == "main" else ""
    print(f"  {t['id']:>14}  {t['role']:<12} {t['name'][:40]}{mark}")
if not main:
    raise SystemExit("no main theme found")
print(f"\n  initiative doc expects 181379236160 -> "
      f"{'MATCH' if str(main['id']) == '181379236160' else 'CHANGED, use ' + str(main['id'])}")

print("\n" + "=" * 74)
print("2. TEMPLATES + LP SECTIONS on the main theme")
print("=" * 74)
assets = rest(f"themes/{main['id']}/assets.json")["assets"]
keys = {a["key"] for a in assets}
for want in ["templates/page.multi-product.json", "templates/page.landing-page.json",
             "templates/page.guia-boosters.json"]:
    print(f"  {'OK  ' if want in keys else 'MISS'}  {want}")
print()
for s in SECTIONS:
    k = f"sections/{s}.liquid"
    print(f"  {'OK  ' if k in keys else 'MISS'}  {k}")
print()
lp_like = sorted(k for k in keys if k.startswith("templates/page.") and k.endswith(".json"))
print("  all page templates present:")
for k in lp_like:
    print(f"    - {k.replace('templates/page.', '').replace('.json', '')}")

print("\n" + "=" * 74)
print("3. PAGE METAFIELD DEFINITIONS (missing = 422 on bind)")
print("=" * 74)
q = """
query($cursor: String) {
  metafieldDefinitions(first: 250, ownerType: PAGE, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { key namespace name type { name } }
  }
}"""
defs, cursor = {}, None
while True:
    d = gql(q, {"cursor": cursor})
    blk = d["data"]["metafieldDefinitions"]
    for n in blk["nodes"]:
        defs[f"{n['namespace']}.{n['key']}"] = n["type"]["name"]
    if not blk["pageInfo"]["hasNextPage"]:
        break
    cursor = blk["pageInfo"]["endCursor"]

print(f"  {len(defs)} PAGE definitions exist\n")
missing = []
for k in REGISTER:
    full = f"custom.{k}"
    if full in defs:
        print(f"  OK    {k:<26} {defs[full]}")
    else:
        print(f"  MISS  {k:<26} -- would 422 on bind")
        missing.append(k)

print("\n" + "=" * 74)
print("4. LIVE multi-product PAGES")
print("=" * 74)
pq = """{ pages(first: 30, query: "template_suffix:multi-product") {
  nodes { id title handle isPublished templateSuffix } } }"""
try:
    for n in gql(pq)["data"]["pages"]["nodes"]:
        print(f"  {n['handle']:<34} published={n['isPublished']}  {n['title'][:34]}")
except Exception as e:
    print(f"  page query failed: {e}")

print("\n" + "=" * 74)
print("VERDICT")
print("=" * 74)
print(f"  main theme            {main['id']}  ({main['name']})")
print(f"  multi-product template {'present' if 'templates/page.multi-product.json' in keys else 'ABSENT'}")
print(f"  register definitions   {len(REGISTER)-len(missing)}/{len(REGISTER)} present")
if missing:
    print(f"  MISSING ({len(missing)}): {', '.join(missing)}")
    print("  -> these must be created (ownerType PAGE) before any bind, or the theme 422s.")
else:
    print("  all register definitions present, no 422 risk on bind")
