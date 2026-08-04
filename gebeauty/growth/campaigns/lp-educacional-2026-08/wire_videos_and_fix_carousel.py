#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Two changes to templates/page.lp-multi-product.json, both additive and
blank-guarded so nossos-boosters and lp-e4fa5694b3a8 (the other 2 live pages
on this shared template) render unaffected.

1. carrossel_fix (custom-liquid, pure CSS, no markup)
   Root cause of "bleeding vertically" on desktop: the native `slideshow`
   section's `slide_height: adapt_image` sizes the container's height from
   the FIRST slide's real aspect ratio (1080x1350 = 1.25 padding-bottom hack),
   at whatever width the section renders. Because `layout: grid` /
   `full_width: true` both resolve to the ".page-width" wrapper (contained,
   not edge-to-edge), the container still renders near the theme's page_width
   (~1200-1400px on a desktop monitor) for a PORTRAIT image, so height comes
   out to ~1500-1750px per slide -- correct math, just an oversized box for
   IG-story-ratio content once you're wider than a phone.
   adapt_image was chosen on purpose: the slide copy is baked into the image
   pixels, so a fixed-height + object-fit:cover crop (the alternative
   slide_height options) would silently cut off text on desktop. Capping the
   rendered WIDTH instead keeps the whole image visible (no crop, no baked-in
   text lost) while bounding the height proportionally. Scoped to this one
   carousel via its aria-label (stable, human-readable), not the numeric
   section id (which is template-id-derived and could drift).

2. video_3 / video_5 (custom-liquid, blank-guarded on page metafields)
   sections/video.liquid (Shopify's native video section) has NO blank guard:
   if its `video` setting is empty it still renders a placeholder box (stock
   photo + play button). Since this template is shared, binding that native
   section directly to a per-page metafield would show a broken placeholder
   video on the other 2 live pages, where the metafield is unset. Same fix
   pattern as `passos`/`fechamento`/`carrossel` copy: a custom-liquid section
   that emits nothing when its page metafield is blank, and otherwise renders
   a plain <video> via Shopify's own `video_tag` filter fed by the
   file_reference metafield's resolved Video object.

Placement: video_3 right after carrossel (echoes its position in the source
IG post); video_5 between passos and card_1 (shows product-in-use right where
the visitor is deciding, per THEME-BUDGET-AND-SPECS.md Part 5).

Both video 3 and video 5 are posted AS-IS per Lucas (2026-08-02), including
video 5's two known copy errors (duplicated opening line + "GE BEAUY").

  python3 wire_videos_and_fix_carousel.py            # dry run + backup
  python3 wire_videos_and_fix_carousel.py --apply
  python3 wire_videos_and_fix_carousel.py --restore
"""
import argparse
import json
import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, "..", "..", "..")
THEME = "181379236160"
KEY = "templates/page.lp-multi-product.json"
BACKUP = os.path.join(HERE, "BACKUP_prevideo_page.lp-multi-product.json")
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
HDR = {"X-Shopify-Access-Token": E["SHOPIFY_ADMIN_ACCESS_TOKEN"],
       "Content-Type": "application/json"}


def api(path, method="GET", payload=None):
    data = json.dumps(payload).encode() if payload else None
    req = urllib.request.Request(f"https://{DOMAIN}/admin/api/{VER}/{path}",
                                 data=data, headers=HDR, method=method)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def gql(q, v=None):
    body = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    req = urllib.request.Request(f"https://{DOMAIN}/admin/api/{VER}/graphql.json",
                                 data=body, headers=HDR)
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.loads(r.read().decode())
    if "errors" in d:
        raise SystemExit("GraphQL: " + json.dumps(d["errors"])[:700])
    return d


def get_asset():
    return api(f"themes/{THEME}/assets.json?asset%5Bkey%5D={KEY}")["asset"]["value"]


def guard():
    themes = api("themes.json?fields=id,name,role")["themes"]
    m = next((t for t in themes if t["role"] == "main"), None)
    if not m or str(m["id"]) != THEME:
        raise SystemExit(f"ABORT: main theme is now {m['id'] if m else '?'}, not {THEME}")
    print(f"  main theme confirmed {THEME} ({m['name']})")


CARROSSEL_FIX = r"""
<style>
  @media screen and (min-width: 750px) {
    slideshow-component[aria-label="efeito build-up, carrossel explicativo"] {
      max-width: 420px;
      margin-left: auto;
      margin-right: auto;
    }
  }
</style>
""".strip()


def video_liquid(mf_key):
    return (
        "{%- assign v = page.metafields.custom." + mf_key + " -%}\n"
        "{%- if v != blank -%}\n"
        '<div class="lpvid page-width">\n'
        "  {{ v.value | video_tag: image_size: '1500x', controls: true, "
        "muted: false, loop: false }}\n"
        "</div>\n"
        "<style>\n"
        "  .lpvid{padding:8px 0 28px}\n"
        "  .lpvid video{width:100%;height:auto;border-radius:16px;display:block}\n"
        "</style>\n"
        "{%- endif -%}"
    )


SECTIONS = {
    "carrossel_fix": {"after": None, "before": "carrossel",
                       "settings": {"custom_liquid": CARROSSEL_FIX,
                                    "color_scheme": "background-1",
                                    "padding_top": 0, "padding_bottom": 0}},
    "video_3": {"after": "carrossel", "before": None,
                "settings": {"custom_liquid": video_liquid("video_3"),
                             "color_scheme": "background-1",
                             "padding_top": 0, "padding_bottom": 0}},
    "video_5": {"after": "passos", "before": None,
                "settings": {"custom_liquid": video_liquid("video_5"),
                             "color_scheme": "background-1",
                             "padding_top": 0, "padding_bottom": 0}},
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--restore", action="store_true")
    a = ap.parse_args()

    guard()
    cur = get_asset()

    if a.restore:
        api(f"themes/{THEME}/assets.json", "PUT",
            {"asset": {"key": KEY, "value": open(BACKUP, encoding="utf-8").read()}})
        print("  restored from pre-video backup")
        return

    if not os.path.exists(BACKUP):
        open(BACKUP, "w", encoding="utf-8").write(cur)
        print(f"  backup -> {os.path.basename(BACKUP)} ({len(cur)/1024:.1f} KB)")
    else:
        print("  backup exists, untouched")

    t = json.loads(cur)
    order = t["order"]
    print(f"\n  current order ({len(order)}): {' -> '.join(order)}")

    video_ids = json.load(open(os.path.join(HERE, "video_file_ids.json"), encoding="utf-8"))
    vid = {x["slide"]: x["id"] for x in video_ids}
    print(f"\n  video file ids: {vid}")

    for sid, spec in SECTIONS.items():
        if sid in t["sections"]:
            print(f"  ! {sid} already present, skipping section insert")
            continue
        t["sections"][sid] = {"type": "custom-liquid", "settings": spec["settings"]}
        if spec["after"]:
            pos = order.index(spec["after"]) + 1 if spec["after"] in order else len(order)
        else:
            pos = order.index(spec["before"]) if spec["before"] in order else 0
        order.insert(pos, sid)
        print(f"  + {sid:<14} inserted at position {pos + 1}")

    t["order"] = order
    print(f"\n  new order ({len(order)}): {' -> '.join(order)}")

    if not a.apply:
        print("\nDRY RUN. nothing written. re-run with --apply")
        return

    # 1. metafield definitions (page-level, file_reference)
    existing = {n["key"] for n in gql(
        "{metafieldDefinitions(first:250,ownerType:PAGE){nodes{key}}}"
    )["data"]["metafieldDefinitions"]["nodes"]}
    for key, name in [("video_3", "LP · video 3 (build-up mechanism)"),
                       ("video_5", "LP · video 5 (ritual, has known copy errors)")]:
        if key in existing:
            print(f"  definition {key} already exists")
            continue
        r = gql("""mutation($d:MetafieldDefinitionInput!){ metafieldDefinitionCreate(definition:$d){
          createdDefinition{ key } userErrors{ field message code } } }""",
                {"d": {"name": name, "namespace": "custom", "key": key,
                       "type": "file_reference", "ownerType": "PAGE"}})["data"]["metafieldDefinitionCreate"]
        if r["userErrors"]:
            print(f"    ! {key}: {json.dumps(r['userErrors'], ensure_ascii=False)[:200]}")
        else:
            print(f"    created definition {key}")

    # 2. set values ONLY on page 1
    batch = [{"ownerId": PAGE_GID, "namespace": "custom", "key": f"video_{n}",
              "type": "file_reference", "value": vid[n]} for n in (3, 5)]
    r = gql("""mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){
      metafields{ key } userErrors{ field message } } }""", {"m": batch})["data"]["metafieldsSet"]
    if r["userErrors"]:
        print("  METAFIELD ERRORS:", json.dumps(r["userErrors"], ensure_ascii=False))
    else:
        print(f"  set {len(r['metafields'])} video metafields on page 1")

    # 3. write template
    api(f"themes/{THEME}/assets.json", "PUT",
        {"asset": {"key": KEY, "value": json.dumps(t, ensure_ascii=False, indent=2)}})
    print("\n  template written.")


if __name__ == "__main__":
    main()
