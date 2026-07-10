"""Drop 'back in stock' etiqueta from 3 products; add 'lançamento' to the 3
newly added body & hair mists. Idempotent. Dry-run unless argv[1]=='apply'.
"""
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

BIS = 'gid://shopify/Metaobject/223415828800'   # back in stock
LANC = 'gid://shopify/Metaobject/45203259712'   # lançamento
REMOVE = {'melon-mood-body-hair-mist', 'primer-cachos-definidos', 'primer-liso-intacto'}
ADD = {'rose-ritual-body-hair-mist', 'pear-fresh-body-hair-mist', 'santal-skin-body-hair-mist'}

handles = list(REMOVE | ADD)
qfilter = ' OR '.join(f'handle:{h}' for h in handles)
q = '''query($q:String){ products(first:20, query:$q){ nodes{ id handle
  et: metafield(namespace:"custom", key:"etiquetas"){ references(first:25){ nodes{ ... on Metaobject { id handle } } } } } } }'''
prods = gql(q, {'q': qfilter})['data']['products']['nodes']

SET = '''mutation($mf:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$mf){ userErrors{ field message } } }'''
DEL = '''mutation($mf:[MetafieldIdentifierInput!]!){ metafieldsDelete(metafields:$mf){ deletedMetafields{ key } userErrors{ field message } } }'''

print('MODE:', 'APPLY' if APPLY else 'DRY-RUN')
for p in prods:
    h = p['handle']
    refs = [(x['id'], x['handle']) for x in (p['et']['references']['nodes'] if p['et'] else [])]
    cur_ids = [i for i, _ in refs]
    if h in REMOVE:
        new = [i for i in cur_ids if i != BIS]
    else:  # ADD
        new = cur_ids + ([LANC] if LANC not in cur_ids else [])
    cur_h = [hh for _, hh in refs]
    new_h = []
    for i in new:
        new_h.append(next((hh for ii, hh in refs if ii == i), 'lancamento' if i == LANC else i))
    if new == cur_ids:
        print(f'  {h}: {cur_h} (no change, skip)'); continue
    print(f'  {h}: {cur_h}  ->  {new_h}')
    if APPLY:
        if not new:
            r = gql(DEL, {'mf': [{'ownerId': p['id'], 'namespace': 'custom', 'key': 'etiquetas'}]})
            print('       DELETE errs=', r['data']['metafieldsDelete']['userErrors'])
        else:
            r = gql(SET, {'mf': [{'ownerId': p['id'], 'namespace': 'custom', 'key': 'etiquetas',
                                  'type': 'list.metaobject_reference', 'value': json.dumps(new)}]})
            print('       SET errs=', r['data']['metafieldsSet']['userErrors'])
