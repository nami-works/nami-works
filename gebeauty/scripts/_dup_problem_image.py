# -*- coding: utf-8 -*-
"""Give the LP problem section its own image, independent of antes_foto (shared with before/after).
Duplicates the current problem image file, wires it to a new page metafield custom.imagem_problema,
and rebinds the problem section image to it. Lucas can then swap the file freely."""
import json, time, urllib.request, urllib.error
from pathlib import Path
TOKEN = None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='):
        TOKEN = line.strip().split('=', 1)[1]
API = 'https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01'
THEME = 181379236160
PAGE = "gid://shopify/Page/164358750528"
SRC_URL = "https://cdn.shopify.com/s/files/1/0807/8344/2240/files/Antes.jpg?v=1748035254"


def gql(q, v=None):
    b = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    r = urllib.request.Request(f'{API}/graphql.json', data=b, headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    return json.loads(urllib.request.urlopen(r).read())


def call(m, p, d=None):
    r = urllib.request.Request(f'{API}{p}', data=(json.dumps(d).encode() if d is not None else None), method=m, headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    try:
        with urllib.request.urlopen(r) as x:
            return x.status, (json.loads(x.read().decode() or '{}'))
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:600]


# 1. duplicate the file (Shopify fetches the source URL)
r = gql('mutation($f:[FileCreateInput!]!){fileCreate(files:$f){files{id fileStatus} userErrors{field message}}}',
        {"f": [{"originalSource": SRC_URL, "contentType": "IMAGE", "alt": "primer cachos - problema (LP)", "filename": "primer-cachos-problema.jpg"}]})
fc = r['data']['fileCreate']
if fc['userErrors']:
    print('fileCreate errors:', fc['userErrors']); raise SystemExit
new_id = fc['files'][0]['id']
print('new file:', new_id, fc['files'][0]['fileStatus'])

# 2. poll until READY
for _ in range(20):
    d = gql('query($id:ID!){node(id:$id){... on MediaImage{fileStatus image{url}}}}', {"id": new_id})
    n = d['data']['node']
    if n['fileStatus'] == 'READY' and n.get('image'):
        print('READY:', n['image']['url']); break
    time.sleep(2)
else:
    print('WARN: not READY after polling; proceeding with gid anyway')

# 3. def + value
r = gql('mutation($d:MetafieldDefinitionInput!){metafieldDefinitionCreate(definition:$d){userErrors{code message}}}',
        {"d": {"name": "LP imagem_problema", "namespace": "custom", "key": "imagem_problema", "type": "file_reference", "ownerType": "PAGE"}})
print('def imagem_problema ->', r['data']['metafieldDefinitionCreate']['userErrors'] or 'OK')
r = gql('mutation($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){metafields{key} userErrors{field message}}}',
        {"m": [{"ownerId": PAGE, "namespace": "custom", "key": "imagem_problema", "type": "file_reference", "value": new_id}]})
print('metafieldsSet ->', r['data']['metafieldsSet']['userErrors'] or 'OK')

# 4. rebind the problem section image
_, a = call('GET', f'/themes/{THEME}/assets.json?asset[key]=templates/page.landing-page.json')
tpl = json.loads(a['asset']['value'])
tpl['sections']['problem']['settings']['image'] = '{{ page.metafields.custom.imagem_problema.value }}'
st, rr = call('PUT', f'/themes/{THEME}/assets.json', {'asset': {'key': 'templates/page.landing-page.json', 'value': json.dumps(tpl, ensure_ascii=False)}})
print('template PUT:', st, '' if st == 200 else rr, '| problem image ->', tpl['sections']['problem']['settings']['image'])
