# -*- coding: utf-8 -*-
"""Copy two PDP sections to the landing-page template:
1. formula icons (icons-with-title, static SVGs) -> inserted right after before_after.
2. tabs content (o que e / como usar / resultado) -> replicated to page metafields and
   bound into the existing 'howto' multicolumn columns (s1 como usar, s2 resultados, s3 saiba mais).
Dynamic pattern (single-hop page metafields + metafield_tag), same as the before/after wiring."""
import json, urllib.request, urllib.error
from pathlib import Path
TOKEN = None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='):
        TOKEN = line.strip().split('=', 1)[1]
API = 'https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01'
THEME = 181379236160
PAGE = "gid://shopify/Page/164358750528"
DESC_MO = "gid://shopify/Metaobject/95152996672"
PDP_ICONS_KEY = "0e5faf5e-dda2-4686-a87e-1338ee9372f1"


def gql(q, v=None):
    b = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    r = urllib.request.Request(f'{API}/graphql.json', data=b, headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    return json.loads(urllib.request.urlopen(r).read())


def asset_get(k):
    r = urllib.request.Request(f'{API}/themes/{THEME}/assets.json?asset[key]={k}', headers={'X-Shopify-Access-Token': TOKEN})
    return json.loads(urllib.request.urlopen(r).read())['asset']['value']


def asset_put(k, v):
    b = json.dumps({'asset': {'key': k, 'value': v}}).encode()
    r = urllib.request.Request(f'{API}/themes/{THEME}/assets.json', data=b, method='PUT', headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    try:
        with urllib.request.urlopen(r) as x:
            return x.status, ''
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:500]


# 1. read the 3 tab subfields from the product's descricao_longa metaobject
d = gql('query($id:ID!){node(id:$id){... on Metaobject{fields{key type value}}}}', {"id": DESC_MO})
fields = {f['key']: f for f in d['data']['node']['fields']}
srcmap = {  # page metafield key -> (source subfield, type)
    'tab_como_usar':  ('passo_a_passo', 'rich_text_field'),
    'tab_resultados': ('resultado',     'rich_text_field'),
    'tab_saiba_mais': ('o_que_e',       'multi_line_text_field'),
}
mfs = []
for pk, (sk, typ) in srcmap.items():
    mfs.append({"ownerId": PAGE, "namespace": "custom", "key": pk, "type": typ, "value": fields[sk]['value']})

# 2. write the page metafields
r = gql('mutation($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){userErrors{field message}}}', {"m": mfs})
print('metafieldsSet errors:', r.get('data', {}).get('metafieldsSet', {}).get('userErrors') or 'OK')

# 3. load templates
tpl = json.loads(asset_get('templates/page.landing-page.json'))
pj = json.loads(asset_get('templates/product.json'))

# 3a. bind the 3 multicolumn columns' text to the page metafields
hk = next(k for k, s in tpl['sections'].items() if s.get('type') == 'multicolumn')
cols = tpl['sections'][hk]['blocks']
bindmap = {'s1': 'tab_como_usar', 's2': 'tab_resultados', 's3': 'tab_saiba_mais'}
for bk, pk in bindmap.items():
    cols[bk]['settings']['text'] = '{{ page.metafields.custom.' + pk + ' | metafield_tag }}'

# 3b. copy the formula-icons section, insert into order right after before_after
import copy
tpl['sections']['formula_icons'] = copy.deepcopy(pj['sections'][PDP_ICONS_KEY])
order = tpl['order']
i = order.index('before_after')
if 'formula_icons' not in order:
    order.insert(i + 1, 'formula_icons')

# 4. PUT template
st, err = asset_put('templates/page.landing-page.json', json.dumps(tpl, ensure_ascii=False))
print('template PUT:', st, err)
print('new order:', tpl['order'])
print('columns bound:', {bk: cols[bk]['settings']['text'] for bk in bindmap})
