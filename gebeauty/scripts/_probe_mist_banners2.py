# -*- coding: utf-8 -*-
"""READ-ONLY: resolve the 4 current banner images (2 collection metafields +
2 homepage slide files) -> url/dims, and the collection templateSuffix. No mutations."""
import json, urllib.request, urllib.parse, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')

TOKEN = None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='):
        TOKEN = line.strip().split('=', 1)[1]
API = 'https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01'

def gql(q, v=None):
    b = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    r = urllib.request.Request(f'{API}/graphql.json', data=b,
        headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    return json.loads(urllib.request.urlopen(r).read())

print("=== collection templateSuffix ===")
d = gql('{ collectionByHandle(handle:"body-hair-mist"){ id templateSuffix } }')
print("  ", d["data"]["collectionByHandle"])

print("\n=== COLLECTION banner metafield images ===")
for label, gid in [("banner_1 (desktop)", "gid://shopify/MediaImage/43729778868544"),
                   ("banner_1_mb (mobile)", "gid://shopify/MediaImage/43729778835776")]:
    d = gql('query($id:ID!){ node(id:$id){ ... on MediaImage { id alt createdAt image{ url width height } } } }', {"id": gid})
    n = d["data"]["node"]; img = n["image"]
    print(f"  {label}: {img['width']}x{img['height']}  alt={n['alt']!r}")
    print(f"    {img['url']}")

print("\n=== HOMEPAGE slide files (by filename) ===")
for label, fn in [("home desktop", "lancamento-novos-body-hair-mists_banner-web_home"),
                  ("home mobile", "lancamento-novos-body-hair-mists_banner-mobile_home")]:
    d = gql('query($q:String!){ files(first:5, query:$q){ nodes{ ... on MediaImage { id alt image{ url width height } } } } }',
            {"q": f"filename:{fn}*"})
    nodes = d["data"]["files"]["nodes"]
    print(f"  {label} (filename:{fn}*) -> {len(nodes)} hits")
    for n in nodes:
        if n and n.get("image"):
            print(f"    {n['id']}  {n['image']['width']}x{n['image']['height']}  alt={n.get('alt')!r}")
            print(f"      {n['image']['url']}")

print("\nDONE (read-only)")
