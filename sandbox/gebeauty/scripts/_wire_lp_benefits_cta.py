# -*- coding: utf-8 -*-
"""Wire the last hardwired spots in the shared LP template to the page registry:
1. buy.benefits icon-with-text: 3 texts (single_line) + 3 icons (file_reference).
2. hero s1 link + close btn link: one shared cta_cart_link.
Creates defs + values (read icons/texts/link from the template). Binding is a second step."""
import json, urllib.request, urllib.error
from pathlib import Path
TOKEN = None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='):
        TOKEN = line.strip().split('=', 1)[1]
API = 'https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01'
THEME = 181379236160
PAGE = "gid://shopify/Page/164358750528"


def gql(q, v=None):
    b = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    r = urllib.request.Request(f'{API}/graphql.json', data=b, headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    return json.loads(urllib.request.urlopen(r).read())


def asset_get(k):
    r = urllib.request.Request(f'{API}/themes/{THEME}/assets.json?asset[key]={k}', headers={'X-Shopify-Access-Token': TOKEN})
    return json.loads(urllib.request.urlopen(r).read())['asset']['value']


tpl = json.loads(asset_get('templates/page.landing-page.json'))
S = tpl['sections']
fpk = next(k for k, ss in S.items() if ss.get('type') == 'featured-product')
hk = next(k for k, ss in S.items() if ss.get('type') == 'slideshow')
bk = next(k for k, bv in S[fpk]['blocks'].items() if bv.get('type') == 'icon-with-text')
ben = S[fpk]['blocks'][bk]['settings']
_raw = S[hk]['blocks']['s1']['settings']['link']
cart_link = _raw if _raw.startswith('http') else 'https://gebeauty.com.br' + _raw  # url metafield needs a scheme

# resolve each icon's shopify://shop_images/<file> -> MediaImage gid
def icon_gid(shopify_url):
    fn = shopify_url.rsplit('/', 1)[-1]
    d = gql('query($q:String!){files(first:5,query:$q){nodes{... on MediaImage{id image{url}}}}}', {"q": f"filename:{fn}"})
    nodes = [n for n in d['data']['files']['nodes'] if n]
    return nodes[0]['id'] if nodes else None

icons = {n: icon_gid(ben[f'image_{n}']) for n in (1, 2, 3)}
print('icon gids:', icons)
assert all(icons.values()), 'missing an icon gid'

single = {f'benefit_{n}_texto': ben[f'heading_{n}'] for n in (1, 2, 3)}
files = {f'benefit_{n}_icone': icons[n] for n in (1, 2, 3)}

DEFN = 'mutation($d:MetafieldDefinitionInput!){metafieldDefinitionCreate(definition:$d){userErrors{code message}}}'
for k in single:
    r = gql(DEFN, {"d": {"name": 'LP ' + k, "namespace": "custom", "key": k, "type": "single_line_text_field", "ownerType": "PAGE"}})
    print('def', k, '->', r['data']['metafieldDefinitionCreate']['userErrors'] or 'OK')
for k in files:
    r = gql(DEFN, {"d": {"name": 'LP ' + k, "namespace": "custom", "key": k, "type": "file_reference", "ownerType": "PAGE"}})
    print('def', k, '->', r['data']['metafieldDefinitionCreate']['userErrors'] or 'OK')
# cta_cart_link — try url type
r = gql(DEFN, {"d": {"name": 'LP cta_cart_link', "namespace": "custom", "key": "cta_cart_link", "type": "url", "ownerType": "PAGE"}})
print('def cta_cart_link (url) ->', r['data']['metafieldDefinitionCreate']['userErrors'] or 'OK')

mfs = [{"ownerId": PAGE, "namespace": "custom", "key": k, "type": "single_line_text_field", "value": v} for k, v in single.items()]
mfs += [{"ownerId": PAGE, "namespace": "custom", "key": k, "type": "file_reference", "value": v} for k, v in files.items()]
mfs += [{"ownerId": PAGE, "namespace": "custom", "key": "cta_cart_link", "type": "url", "value": cart_link}]
r = gql('mutation($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){metafields{key} userErrors{field message}}}', {"m": mfs})
res = r['data']['metafieldsSet']
print('metafieldsSet errors:', res['userErrors'] or 'OK', '| set:', len(res['metafields']), '| cart_link:', cart_link)
