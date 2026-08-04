#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Adds three ADDITIVE sections to templates/page.lp-multi-product.json.

Shared-template safety: this template also serves /pages/nossos-boosters and
/pages/lp-e4fa5694b3a8. Every section below is wrapped in a blank-guard on the page
metafields it reads, so on any page that has not set them the section emits NOTHING
(not an empty shell). Same backward-compatible pattern as promo_note's `default:`.

  carrossel   after hero      IG-style scroll-snap carousel, 6 slides, alt text preserved
  passos      after punchline 3 numbered steps; product image pulled from the kit's
                              itens_do_kit list, so it needs no image metafields
  fechamento  after faq       closing CTA from fechamento_titulo/_texto/_botao

Why custom-liquid rather than stock multicolumn: multicolumn does not self-hide when its
bound page metafields are empty, which would add blank space to the two live LPs.

  python3 add_lp_sections.py            # dry run + backup
  python3 add_lp_sections.py --apply
  python3 add_lp_sections.py --restore
"""
import argparse
import json
import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, "..", "..", "..")
THEME = "181379236160"
KEY = "templates/page.lp-multi-product.json"
BACKUP = os.path.join(HERE, "BACKUP_page.lp-multi-product.json")


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
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def get_asset():
    return api(f"themes/{THEME}/assets.json?asset%5Bkey%5D={KEY}")["asset"]["value"]


CAROUSEL = r"""
{%- liquid
  assign has_car = false
  for i in (1..6)
    assign ck = 'carrossel_' | append: i
    if page.metafields.custom[ck] != blank
      assign has_car = true
    endif
  endfor
-%}
{%- if has_car -%}
<div class="lpcar">
  <ul class="lpcar__track" role="list">
    {%- for i in (1..6) -%}
      {%- assign ck = 'carrossel_' | append: i -%}
      {%- assign mf = page.metafields.custom[ck] -%}
      {%- if mf != blank -%}
        {%- assign img = mf.value -%}
        <li class="lpcar__slide">
          <img
            src="{{ img | image_url: width: 720 }}"
            srcset="{{ img | image_url: width: 480 }} 480w,
                    {{ img | image_url: width: 720 }} 720w,
                    {{ img | image_url: width: 1080 }} 1080w"
            sizes="(min-width: 990px) 32vw, (min-width: 750px) 46vw, 84vw"
            alt="{{ img.alt | escape }}"
            width="1080" height="1350"
            loading="lazy" decoding="async">
        </li>
      {%- endif -%}
    {%- endfor -%}
  </ul>
  <p class="lpcar__hint">arraste para o lado</p>
</div>
<style>
  .lpcar{padding:8px 0 28px}
  .lpcar__track{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;
    -webkit-overflow-scrolling:touch;list-style:none;margin:0;
    padding:0 5vw 6px;scrollbar-width:none}
  .lpcar__track::-webkit-scrollbar{display:none}
  .lpcar__slide{flex:0 0 84vw;scroll-snap-align:center;margin:0}
  .lpcar__slide img{width:100%;height:auto;display:block;border-radius:12px}
  .lpcar__hint{text-align:center;font-size:12.5px;letter-spacing:.08em;
    text-transform:uppercase;opacity:.5;margin:14px 0 0}
  @media(min-width:750px){
    .lpcar__track{padding-left:max(5vw,24px);padding-right:max(5vw,24px)}
    .lpcar__slide{flex:0 0 46vw}
  }
  @media(min-width:990px){
    .lpcar__slide{flex:0 0 32%}
    .lpcar__hint{display:none}
  }
</style>
{%- endif -%}
""".strip()

PASSOS = r"""
{%- liquid
  assign kit = page.metafields.custom.produto_em_destaque_1.value
  assign items = kit.metafields.custom.descricao_longa_com_abas.value.itens_do_kit.value
  assign has_steps = false
  for i in (1..3)
    assign tk = 'passo_' | append: i | append: '_titulo'
    if page.metafields.custom[tk] != blank
      assign has_steps = true
    endif
  endfor
-%}
{%- if has_steps -%}
<div class="lpsteps page-width">
  <ol class="lpsteps__list" role="list">
    {%- for i in (1..3) -%}
      {%- assign tk = 'passo_' | append: i | append: '_titulo' -%}
      {%- assign xk = 'passo_' | append: i | append: '_texto' -%}
      {%- assign t = page.metafields.custom[tk] -%}
      {%- if t != blank -%}
        {%- assign idx = i | minus: 1 -%}
        {%- assign prod = items[idx] -%}
        <li class="lpsteps__item">
          {%- if prod.featured_image != blank -%}
            <img class="lpsteps__img"
              src="{{ prod.featured_image | image_url: width: 420 }}"
              srcset="{{ prod.featured_image | image_url: width: 300 }} 300w,
                      {{ prod.featured_image | image_url: width: 560 }} 560w"
              sizes="(min-width: 750px) 26vw, 40vw"
              alt="{{ prod.title | escape }}" width="420" height="420"
              loading="lazy" decoding="async">
          {%- endif -%}
          <span class="lpsteps__n">{{ i }}</span>
          <h3 class="lpsteps__t">{{ t.value }}</h3>
          {%- if prod != blank -%}
            <p class="lpsteps__p">{{ prod.title }}</p>
          {%- endif -%}
          <div class="lpsteps__d rte">
            {{ page.metafields.custom[xk] | metafield_tag }}
          </div>
        </li>
      {%- endif -%}
    {%- endfor -%}
  </ol>
</div>
<style>
  .lpsteps{padding:8px 0 32px}
  .lpsteps__list{list-style:none;margin:0;padding:0;display:grid;gap:26px}
  .lpsteps__item{margin:0;text-align:center}
  .lpsteps__img{width:58%;max-width:200px;height:auto;margin:0 auto 10px;display:block}
  .lpsteps__n{display:inline-grid;place-items:center;width:28px;height:28px;
    border-radius:50%;background:#DF3630;color:#fff;font-weight:700;font-size:14px}
  .lpsteps__t{font-size:19px;margin:8px 0 2px;text-transform:lowercase}
  .lpsteps__p{font-size:13.5px;letter-spacing:.06em;text-transform:uppercase;
    opacity:.55;margin:0 0 8px}
  .lpsteps__d{font-size:15.5px;max-width:34ch;margin:0 auto}
  @media(min-width:750px){
    .lpsteps__list{grid-template-columns:repeat(3,1fr);gap:22px}
  }
</style>
{%- endif -%}
""".strip()

FECHAMENTO = r"""
{%- assign ft = page.metafields.custom.fechamento_titulo -%}
{%- if ft != blank -%}
{%- assign kit = page.metafields.custom.produto_em_destaque_1.value -%}
<div class="lpclose">
  <div class="page-width lpclose__in">
    <h2 class="lpclose__t">{{ ft.value }}</h2>
    {%- if page.metafields.custom.fechamento_texto != blank -%}
      <div class="lpclose__x rte">{{ page.metafields.custom.fechamento_texto | metafield_tag }}</div>
    {%- endif -%}
    {%- if page.metafields.custom.fechamento_botao != blank and kit != blank -%}
      <a class="lpclose__b button" href="{{ kit.url }}">
        {{ page.metafields.custom.fechamento_botao.value }}
      </a>
    {%- endif -%}
  </div>
</div>
<style>
  .lpclose{background:#769C8E;color:#fff;padding:46px 0}
  .lpclose__in{text-align:center}
  .lpclose__t{font-size:clamp(24px,5.4vw,34px);line-height:1.14;margin:0 auto;
    max-width:22ch;color:#fff;text-transform:lowercase}
  .lpclose__x{margin-top:12px;opacity:.9;font-size:16px}
  .lpclose__b{margin-top:22px;background:#000;color:#fff;border:0}
</style>
{%- endif -%}
""".strip()

SECTIONS = {
    "carrossel": {"after": "hero", "settings": {"custom_liquid": CAROUSEL,
                                                "color_scheme": "background-1",
                                                "padding_top": 0, "padding_bottom": 0}},
    "passos": {"after": "punchline", "settings": {"custom_liquid": PASSOS,
                                                  "color_scheme": "background-1",
                                                  "padding_top": 0, "padding_bottom": 0}},
    "fechamento": {"after": "faq", "settings": {"custom_liquid": FECHAMENTO,
                                                "color_scheme": "background-1",
                                                "padding_top": 0, "padding_bottom": 0}},
}


def guard():
    t = api("themes.json?fields=id,name,role")["themes"]
    m = next((x for x in t if x["role"] == "main"), None)
    if not m or str(m["id"]) != THEME:
        raise SystemExit(f"ABORT: main theme is now {m['id'] if m else '?'}, not {THEME}")
    print(f"  main theme confirmed {THEME} ({m['name']})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--restore", action="store_true")
    a = ap.parse_args()

    guard()
    cur = get_asset()

    if a.restore:
        api(f"themes/{THEME}/assets.json", "PUT", {"asset": {"key": KEY, "value": open(BACKUP, encoding="utf-8").read()}})
        print("  restored"); return

    if not os.path.exists(BACKUP):
        open(BACKUP, "w", encoding="utf-8").write(cur)
        print(f"  backup -> {os.path.basename(BACKUP)} ({len(cur)/1024:.1f} KB)")
    else:
        print("  backup exists, untouched")

    t = json.loads(cur)
    order = t["order"]
    print(f"\n  current order ({len(order)}): {' -> '.join(order)}")

    for sid, spec in SECTIONS.items():
        if sid in t["sections"]:
            print(f"  ! {sid} already present, skipping")
            continue
        t["sections"][sid] = {"type": "custom-liquid", "settings": spec["settings"]}
        anchor = spec["after"]
        pos = order.index(anchor) + 1 if anchor in order else len(order)
        order.insert(pos, sid)
        print(f"  + {sid:<12} inserted after '{anchor}' at position {pos+1}")

    t["order"] = order
    print(f"\n  new order ({len(order)}): {' -> '.join(order)}")
    print("\n  each new section is blank-guarded: emits nothing when its page metafields")
    print("  are unset, so nossos-boosters and lp-e4fa5694b3a8 render unchanged.")

    if not a.apply:
        print("\nDRY RUN. nothing written. re-run with --apply")
        return

    api(f"themes/{THEME}/assets.json", "PUT",
        {"asset": {"key": KEY, "value": json.dumps(t, ensure_ascii=False, indent=2)}})
    print("\n  template written.")


if __name__ == "__main__":
    main()
