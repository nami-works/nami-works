"""Set 'tagline para home' (custom.finalidade) on the 5 body & hair mists.
Dry-run unless argv[1]=='apply'. Idempotent."""
import json, urllib.request, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
APPLY = len(sys.argv) > 1 and sys.argv[1] == 'apply'
TOKEN = None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='):
        TOKEN = line.strip().split('=', 1)[1]
URL = 'https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json'
def gql(q, v=None):
    body = json.dumps({'query': q, **({'variables': v} if v else {})}).encode()
    req = urllib.request.Request(URL, data=body, headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode())

TAGLINES = {
    'melon-mood-body-hair-mist': 'leveza perfumada de melão, peônia e white musk',
    'melon-mood-body-hair-mist-travel-size': 'leveza perfumada de melão em qualquer lugar',
    'pear-fresh-body-hair-mist': 'frescor vibrante de pêra, lírio e musk',
    'rose-ritual-body-hair-mist': 'delicadeza floral de rosas, lichia e frutas vermelhas',
    'santal-skin-body-hair-mist': 'elegância de sândalo, cardamomo e patchouli',
}
SET = '''mutation($mf:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$mf){ userErrors{field message} } }'''
Q = '''query($q:String){ products(first:1, query:$q){ nodes{ id handle fin: metafield(namespace:"custom", key:"finalidade"){ value } } } }'''

print('MODE:', 'APPLY' if APPLY else 'DRY-RUN')
for handle, new in TAGLINES.items():
    p = gql(Q, {'q': f'handle:{handle}'})['data']['products']['nodes'][0]
    cur = p['fin']['value'] if p['fin'] else None
    if cur == new:
        print(f'  {handle}: already set, skip'); continue
    print(f'  {handle}:')
    print(f'      before: {cur!r}')
    print(f'      after : {new!r}')
    if APPLY:
        r = gql(SET, {'mf': [{'ownerId': p['id'], 'namespace': 'custom', 'key': 'finalidade',
                              'type': 'single_line_text_field', 'value': new}]})
        print('      errs=', r['data']['metafieldsSet']['userErrors'])
