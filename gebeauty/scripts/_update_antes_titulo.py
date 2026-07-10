# -*- coding: utf-8 -*-
"""Change the before/after title in BOTH registries: the product's antes_e_depois metaobject
(t_tulo) and the page's custom.antes_depois_titulo metafield."""
import json, urllib.request, urllib.error
from pathlib import Path
TOKEN = None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='):
        TOKEN = line.strip().split('=', 1)[1]
API = 'https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01'
NEW = "cachos definidos, protegidos e sem frizz"
PRODUCT = "gid://shopify/Product/9668674879808"
PAGE_ID = 164358750528


def gql(q, v=None):
    body = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    r = urllib.request.Request(f'{API}/graphql.json', data=body, headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    return json.loads(urllib.request.urlopen(r).read())


def rest(method, path, data=None):
    r = urllib.request.Request(f'{API}{path}', data=(json.dumps(data).encode() if data is not None else None), method=method, headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    try:
        with urllib.request.urlopen(r) as x:
            return x.status, json.loads(x.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400]


# 1. find the product's antes_e_depois metaobject id + current t_tulo
d = gql('query($h:String!){products(first:1,query:$h){nodes{metafield(namespace:"custom",key:"antes_e_depois"){reference{... on Metaobject{id fields{key value}}}}}}}'.replace('$h', '$h'), {"h": "handle:primer-cachos-definidos"})
mo = d['data']['products']['nodes'][0]['metafield']['reference']
moid = mo['id']
cur = next((f['value'] for f in mo['fields'] if f['key'] == 't_tulo'), None)
print('metaobject:', moid, '| current t_tulo:', cur)

# 2. update the metaobject t_tulo
r1 = gql('mutation($id:ID!,$mo:MetaobjectUpdateInput!){metaobjectUpdate(id:$id,metaobject:$mo){userErrors{field message}}}', {"id": moid, "mo": {"fields": [{"key": "t_tulo", "value": NEW}]}})
print('metaobject update errors:', r1.get('data', {}).get('metaobjectUpdate', {}).get('userErrors') or 'OK')

# 3. update the page metafield custom.antes_depois_titulo
st, rr = rest('POST', f'/pages/{PAGE_ID}/metafields.json', {'metafield': {'namespace': 'custom', 'key': 'antes_depois_titulo', 'type': 'single_line_text_field', 'value': NEW}})
print('page metafield set:', st, rr.get('metafield', {}).get('value') if st in (200, 201) else rr)

# 4. verify
d2 = gql('query{nodes(ids:["' + moid + '"]){... on Metaobject{fields{key value}}}}')
print('verify metaobject t_tulo:', next((f['value'] for f in d2['data']['nodes'][0]['fields'] if f['key'] == 't_tulo'), None))
_, pg = rest('GET', f'/pages/{PAGE_ID}/metafields.json')
print('verify page titulo:', next((m['value'] for m in pg['metafields'] if m['key'] == 'antes_depois_titulo'), None))
