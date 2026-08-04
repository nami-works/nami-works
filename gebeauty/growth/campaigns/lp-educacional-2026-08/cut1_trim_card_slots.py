#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CUT 1: remove the unused card slots 6, 7 and 8 from templates/page.lp-multi-product.json.

Why: each card slot costs 7 dynamic sources (1 product_reference + 3 benefit headings +
3 benefit images), and Shopify caps a JSON template at 100. The template sits at 90/100,
which is why a native slideshow (needing 12) was rejected with
  "Template has more than the maximum 100 dynamic sources allowed."

Usage audit across all three live pages on this template (2026-07-31):
  nossos-boosters      uses produto_em_destaque_1..5
  lp-e4fa5694b3a8      uses 1..3
  page 1 (build-up)    uses 1
  produto_em_destaque_6, _7, _8  -> EMPTY on all three
So slots 6-8 render nothing anywhere and cost 21 sources.

Reversible: a fresh pre-cut backup is written before any change; --restore puts it back.

  python3 cut1_trim_card_slots.py            # dry run + backup
  python3 cut1_trim_card_slots.py --apply
  python3 cut1_trim_card_slots.py --restore
"""
import argparse
import json
import os
import re
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, "..", "..", "..")
THEME = "181379236160"
KEY = "templates/page.lp-multi-product.json"
BACKUP = os.path.join(HERE, "BACKUP_precut1_page.lp-multi-product.json")
DROP = ["card_6", "card_7", "card_8"]


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


def count_sources(tpl):
    n = 0

    def walk(node):
        nonlocal n
        if isinstance(node, dict):
            for k, v in node.items():
                if isinstance(v, str) and v.strip().startswith("{{") and v.strip().endswith("}}"):
                    n += 1
                else:
                    walk(v)
        elif isinstance(node, list):
            for x in node:
                walk(x)
    for sid, sec in tpl["sections"].items():
        if sec.get("type") == "custom-liquid":
            continue          # raw Liquid is exempt from the cap
        walk(sec)
    return n


def guard():
    themes = api("themes.json?fields=id,name,role")["themes"]
    m = next((t for t in themes if t["role"] == "main"), None)
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
        api(f"themes/{THEME}/assets.json", "PUT",
            {"asset": {"key": KEY, "value": open(BACKUP, encoding="utf-8").read()}})
        print("  restored from pre-cut backup")
        return

    if not os.path.exists(BACKUP):
        open(BACKUP, "w", encoding="utf-8").write(cur)
        print(f"  pre-cut backup -> {os.path.basename(BACKUP)} ({len(cur)/1024:.1f} KB)")
    else:
        print("  pre-cut backup already exists, left untouched")

    t = json.loads(cur)
    before = count_sources(t)
    print(f"\n  dynamic sources BEFORE: {before} / 100")

    removed = []
    for sid in DROP:
        if sid in t["sections"]:
            sub = {"sections": {sid: t["sections"][sid]}}
            cost = count_sources(sub)
            del t["sections"][sid]
            removed.append((sid, cost))
        if sid in t["order"]:
            t["order"].remove(sid)
    for sid, cost in removed:
        print(f"    - {sid:<10} freed {cost} sources")

    after = count_sources(t)
    print(f"\n  dynamic sources AFTER:  {after} / 100   (freed {before - after})")
    print(f"  headroom for a native slideshow (needs 12): "
          f"{'YES, ' + str(100 - after - 12) + ' to spare' if after + 12 <= 100 else 'NO'}")
    print(f"\n  remaining card slots: "
          f"{sorted(s for s in t['sections'] if s.startswith('card_'))}")
    print(f"  order ({len(t['order'])}): {' -> '.join(t['order'])}")

    if not a.apply:
        print("\nDRY RUN. nothing written. re-run with --apply")
        return

    api(f"themes/{THEME}/assets.json", "PUT",
        {"asset": {"key": KEY, "value": json.dumps(t, ensure_ascii=False, indent=2)}})
    print("\n  written.")


if __name__ == "__main__":
    main()
