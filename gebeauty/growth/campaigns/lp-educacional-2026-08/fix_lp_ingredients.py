#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fix: ingredient copy is written, bound, and invisible on the two live single-product LPs
(/pages/primer-cachos-definidos, /pages/primer-liso-intacto).

Root cause (diagnosed 2026-07-31): `sections/multicolumn-ingredients.liquid` is a PDP
component. Three nested gates fail in a page context:
  line ~30  wraps the WHOLE section in `{% if product.metafields... %}` and the global
            `product` object does not exist on a page
  line ~81  gates the card body on `block.settings.image != blank` (template sets none)
  line ~107 nests title+text inside `block.settings.button_text != blank` (set to "")

Fix (Lucas's steer: pull it from the PDP, where it is well resolved): stop feeding it
manual page-metafield columns. Instead render `snippets/multicolumn-ingredients.liquid`
— which the PDP path already uses and which reads the product's own
`ingredientes_com_foto` + `descricao_longa_com_abas.ingredientes` — passing the product
resolved from the page's `produto_em_destaque_1`.

`{% render %}` is scope-isolated, so the product MUST be passed as a parameter; an
`assign` before the render would not be visible inside the snippet.

Verified prerequisites:
  primer cachos definidos  ingredientes 1542 chars + ingredientes_com_foto SET
  primer liso intacto      ingredientes 1651 chars + ingredientes_com_foto SET

Risk: bounded. A Liquid error surfaces inline in that one section; the section is
already invisible today, so the worst case equals the current state. Full backup written
before any write, and --restore puts it back byte-for-byte.

  python3 fix_lp_ingredients.py            # dry run + backup
  python3 fix_lp_ingredients.py --apply
  python3 fix_lp_ingredients.py --verify
  python3 fix_lp_ingredients.py --restore
"""
import argparse
import json
import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, "..", "..", "..")
THEME = "181379236160"
# NOTE 2026-07-31: the templates were RENAMED mid-session by another hand.
#   page.landing-page.json  -> page.lp-single-product.json
#   page.multi-product.json -> page.lp-multi-product.json
# Section orders are byte-identical and all four live LPs were repointed correctly
# (verified HTTP 200, zero Liquid errors). This is the theme-churn hazard the
# initiative warns about; always resolve the template key at runtime, never cache it.
KEY = "templates/page.lp-single-product.json"
BACKUP = os.path.join(HERE, "BACKUP_page.lp-single-product.json")


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
HDR = {"X-Shopify-Access-Token": E["SHOPIFY_ADMIN_ACCESS_TOKEN"],
       "Content-Type": "application/json"}


def api(path, method="GET", payload=None):
    data = json.dumps(payload).encode() if payload else None
    req = urllib.request.Request(f"https://{DOMAIN}/admin/api/{VER}/{path}",
                                 data=data, headers=HDR, method=method)
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read().decode())


def get_asset():
    return api(f"themes/{THEME}/assets.json?asset[key]={KEY}")["asset"]["value"]


def put_asset(value):
    return api(f"themes/{THEME}/assets.json", "PUT",
               {"asset": {"key": KEY, "value": value}})


# The replacement section. Defensive: renders nothing if the product or its
# ingredient data is absent, so it can never be worse than today's blank.
CUSTOM_LIQUID = (
    "{%- assign lp_product = page.metafields.custom.produto_em_destaque_1.value -%}\n"
    "{%- if lp_product != blank "
    "and lp_product.metafields.custom.ingredientes_com_foto != blank -%}\n"
    "  {% render 'multicolumn-ingredients', product: lp_product, "
    "section: section, block: block %}\n"
    "{%- endif -%}"
)

NEW_SECTION = {
    "type": "custom-liquid",
    "settings": {
        "custom_liquid": CUSTOM_LIQUID,
        "color_scheme": "background-1",
        "padding_top": 36,
        "padding_bottom": 36,
    },
}


def guard_role_main():
    themes = api("themes.json?fields=id,name,role")["themes"]
    main = next((t for t in themes if t["role"] == "main"), None)
    if not main or str(main["id"]) != THEME:
        raise SystemExit(
            f"ABORT: main theme is {main['id'] if main else '?'} "
            f"({main['name'] if main else '?'}), not {THEME}. "
            "CheckCommerce may have republished. Re-check before editing.")
    print(f"  main theme confirmed {THEME} ({main['name']})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--restore", action="store_true")
    a = ap.parse_args()

    if a.verify:
        import urllib.error
        for h in ["primer-cachos-definidos", "primer-liso-intacto"]:
            url = f"https://www.gebeauty.com.br/pages/{h}?cb=lpfix"
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                html = urllib.request.urlopen(req, timeout=40).read().decode("utf-8", "ignore")
                hits = {
                    "multicolumn-ingredients block": html.count("multicolumn-ingredients"),
                    "ingredient cards": html.count("data-ingredients-count"),
                    "Liquid error": html.count("Liquid error"),
                }
                print(f"  /pages/{h}: " + "  ".join(f"{k}={v}" for k, v in hits.items()))
            except Exception as e:
                print(f"  /pages/{h}: FETCH FAILED {e}")
        return

    guard_role_main()
    current = get_asset()

    if a.restore:
        if not os.path.exists(BACKUP):
            raise SystemExit("no backup file found")
        put_asset(open(BACKUP, encoding="utf-8").read())
        print("  restored from backup")
        return

    if not os.path.exists(BACKUP):
        with open(BACKUP, "w", encoding="utf-8") as f:
            f.write(current)
        print(f"  backup written -> {os.path.basename(BACKUP)} ({len(current)/1024:.1f} KB)")
    else:
        print(f"  backup already exists, left untouched")

    t = json.loads(current)
    if "ingredients" not in t["sections"]:
        raise SystemExit("no 'ingredients' section in the template, nothing to do")

    old = t["sections"]["ingredients"]
    print(f"\n  REPLACING section 'ingredients'")
    print(f"    from  type={old['type']}  blocks={len(old.get('blocks', {}))}")
    print(f"    to    type=custom-liquid  (renders the PDP snippet with the page's product)")
    print(f"    position in order preserved: {t['order'].index('ingredients')+1}/{len(t['order'])}")
    print("\n  liquid:")
    for line in CUSTOM_LIQUID.splitlines():
        print("    " + line)

    if not a.apply:
        print("\nDRY RUN. nothing written. re-run with --apply")
        return

    t["sections"]["ingredients"] = NEW_SECTION
    put_asset(json.dumps(t, ensure_ascii=False, indent=2))
    print("\n  template written. run --verify in ~30s (CDN full-page cache lags).")


if __name__ == "__main__":
    main()
