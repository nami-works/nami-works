# -*- coding: utf-8 -*-
"""Swap product benefit-icon metafield references from the old (opaque) MediaImages to the
new transparent ones the icon-transparency agent created. Reads the agent's REPORT.json.
Dry-run by default; pass 'apply' as argv[1] to write. file_reference metafields on products,
key custom.imagem_beneficio_em_destaque_{1,2,3}."""
import json, sys, urllib.request, urllib.error
from pathlib import Path
TOKEN = None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='):
        TOKEN = line.strip().split('=', 1)[1]
API = 'https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01'
REPORT = Path(r"C:\Users\LUCASG~1\AppData\Local\Temp\claude\c--claude\e7e4e8ad-180d-49a7-b2d1-99278f216db1\scratchpad\REPORT.json")
APPLY = len(sys.argv) > 1 and sys.argv[1] == 'apply'


def gql(q, v=None):
    b = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    r = urllib.request.Request(f'{API}/graphql.json', data=b, headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    return json.loads(urllib.request.urlopen(r).read())


data = json.loads(REPORT.read_text(encoding='utf-8'))
# build (handle, key, new_gid) swaps for non-transparent entries that have a replacement
swaps = []
for e in data:
    if e['verdict'] == 'NON-TRANSPARENT' and e.get('new_gid'):
        for ref in e['refs']:
            handle, key = ref.split('::')
            swaps.append((handle, key, e['new_gid'], e['gid']))
handles = sorted({s[0] for s in swaps})
print(f"{len(swaps)} references across {len(handles)} products; APPLY={APPLY}")

# resolve handles -> product gids
hg = {}
for h in handles:
    d = gql('query($q:String!){products(first:1,query:$q){nodes{id handle}}}', {"q": f"handle:{h}"})
    nodes = d['data']['products']['nodes']
    hg[h] = nodes[0]['id'] if nodes else None
    if not hg[h]:
        print('  !! handle not found:', h)

# build metafieldsSet inputs
mfs = []
for handle, key, new_gid, old_gid in swaps:
    if hg.get(handle):
        mfs.append({"ownerId": hg[handle], "namespace": "custom", "key": key, "type": "file_reference", "value": new_gid})
        print(f"  {handle} {key}: ...{old_gid[-7:]} -> ...{new_gid[-7:]}")

if not APPLY:
    print(f"\nDRY-RUN. {len(mfs)} metafields would be updated. Re-run with 'apply' to write.")
    sys.exit()

# apply in batches of 25
for i in range(0, len(mfs), 25):
    batch = mfs[i:i+25]
    r = gql('mutation($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){metafields{key} userErrors{field message}}}', {"m": batch})
    res = r['data']['metafieldsSet']
    print(f"batch {i//25+1}: set {len(res['metafields'])}, errors {res['userErrors'] or 'none'}")
