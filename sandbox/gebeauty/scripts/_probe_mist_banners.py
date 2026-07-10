# -*- coding: utf-8 -*-
"""READ-ONLY probe: locate how the Body & Hair Mist homepage banner and the
/collections/body-hair-mist collection banner are wired, so we know exactly what
to replace. No mutations."""
import json, urllib.request, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')

TOKEN = None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='):
        TOKEN = line.strip().split('=', 1)[1]
DOMAIN = "ge-beauty-cosmeticos.myshopify.com"
API = f'https://{DOMAIN}/admin/api/2026-01'

def gql(q, v=None):
    b = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    r = urllib.request.Request(f'{API}/graphql.json', data=b,
        headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    return json.loads(urllib.request.urlopen(r).read())

def rest(path):
    r = urllib.request.Request(f'{API}/{path}', headers={'X-Shopify-Access-Token': TOKEN})
    return json.loads(urllib.request.urlopen(r).read())

# 1. Theme role check
print("=== THEMES ===")
themes = rest("themes.json?fields=id,name,role")["themes"]
main_id = None
for t in themes:
    print(f"  {t['id']}  role={t['role']:8}  {t['name']}")
    if t['role'] == 'main':
        main_id = t['id']
print(f"  -> MAIN theme id = {main_id}")

# 2. body-hair-mist collection: image + all metafields
print("\n=== COLLECTION body-hair-mist ===")
d = gql('''query{ collectionByHandle(handle:"body-hair-mist"){
  id title handle
  image{ url width height altText }
  metafields(first:50){ nodes{ namespace key type value } } } }''')
col = d.get("data", {}).get("collectionByHandle")
if not col:
    print("  NOT FOUND by handle")
else:
    print(f"  id={col['id']}  title={col['title']}")
    print(f"  image={col['image']}")
    print("  metafields:")
    for m in col["metafields"]["nodes"]:
        val = m["value"]
        print(f"    {m['namespace']}.{m['key']} ({m['type']}) = {val[:120]}")

# 3. Theme templates: index + collection.body-hair-mist, scan for image refs
print("\n=== THEME TEMPLATES (image/banner refs) ===")
for asset_key in ["templates/index.json", "templates/collection.body-hair-mist.json",
                  "templates/collection.json"]:
    try:
        a = rest(f"themes/{main_id}/assets.json?asset[key]={urllib.parse.quote(asset_key)}")
        body = a["asset"]["value"]
        print(f"\n  --- {asset_key} ({len(body)} bytes) ---")
        # find lines mentioning image / banner / shopify:// / .png
        import re
        for kw in ['shopify://', '.png', '"image"', 'banner', 'Banner']:
            for mt in re.finditer(re.escape(kw), body):
                s = max(0, mt.start()-80); e = min(len(body), mt.start()+140)
                snippet = body[s:e].replace('\n',' ')
                print(f"    [{kw}] ...{snippet}...")
    except urllib.error.HTTPError as ex:
        print(f"  {asset_key}: HTTP {ex.code} (not present)")

# 4. Files search: current mist/body banners
print("\n=== FILES matching mist/body/hair banner ===")
for q in ["filename:*mist*", "filename:*body*hair*", "alt:*mist*", "alt:*Body*Hair*"]:
    d = gql('query($q:String!){ files(first:15, query:$q, sortKey:UPDATED_AT, reverse:true){ nodes{ ... on MediaImage { id alt image{ url width height } createdAt } } } }', {"q": q})
    nodes = d.get("data", {}).get("files", {}).get("nodes", [])
    print(f"\n  query [{q}] -> {len(nodes)} hits")
    for n in nodes:
        if n:
            img = n.get("image") or {}
            print(f"    {n['id']}  {img.get('width')}x{img.get('height')}  alt={n.get('alt')!r}")
            print(f"      {img.get('url')}")

print("\nDONE (read-only)")
