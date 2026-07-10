"""Remove the 'lançamento' etiqueta (custom.etiquetas) from every product that has it,
EXCEPT the 3 new body & hair mists. Other etiquetas on each product are preserved;
if 'lançamento' was the only one, the metafield is deleted. Dry-run unless argv[1]=='apply'."""
import json, urllib.request, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
APPLY = len(sys.argv) > 1 and sys.argv[1] == 'apply'
TOKEN=None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='):
        TOKEN=line.strip().split('=',1)[1]
URL='https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json'
def gql(q,v=None):
    body=json.dumps({'query':q,**({'variables':v} if v else {})}).encode()
    req=urllib.request.Request(URL,data=body,headers={'Content-Type':'application/json','X-Shopify-Access-Token':TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode())

LANC='gid://shopify/Metaobject/45203259712'   # etiqueta 'lançamento'
KEEP={'rose-ritual-body-hair-mist','pear-fresh-body-hair-mist','santal-skin-body-hair-mist'}

Q='''query($c:String){ products(first:200, after:$c){ nodes{ id title handle
  et: metafield(namespace:"custom", key:"etiquetas"){ references(first:25){ nodes{ ... on Metaobject { id handle } } } } }
  pageInfo{ hasNextPage endCursor } } }'''
SET='''mutation($mf:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$mf){ userErrors{field message} } }'''
DEL='''mutation($mf:[MetafieldIdentifierInput!]!){ metafieldsDelete(metafields:$mf){ deletedMetafields{key} userErrors{field message} } }'''

affected=[]; kept=[]; c=None
while True:
    r=gql(Q,{'c':c}); pr=r['data']['products']
    for n in pr['nodes']:
        et=n['et']
        if not et: continue
        refs=[(x['id'],x['handle']) for x in et['references']['nodes']]
        if LANC in [i for i,_ in refs]:
            if n['handle'] in KEEP: kept.append(n['handle'])
            else: affected.append((n['id'],n['title'],n['handle'],refs))
    if pr['pageInfo']['hasNextPage']: c=pr['pageInfo']['endCursor']
    else: break

print('MODE:', 'APPLY' if APPLY else 'DRY-RUN')
print(f'KEEP (lançamento stays): {sorted(kept)}')
print(f'REMOVE lançamento from {len(affected)} product(s):')
for pid,title,handle,refs in affected:
    new=[i for i,_ in refs if i!=LANC]
    new_h=[h for i,h in refs if i!=LANC]
    old_h=[h for _,h in refs]
    print(f'  {title}  ({handle})')
    print(f'      {old_h}  ->  {new_h if new_h else "(metafield deleted)"}')
    if APPLY:
        if new:
            res=gql(SET,{'mf':[{'ownerId':pid,'namespace':'custom','key':'etiquetas','type':'list.metaobject_reference','value':json.dumps(new)}]})
            print('      SET errs=', res['data']['metafieldsSet']['userErrors'])
        else:
            res=gql(DEL,{'mf':[{'ownerId':pid,'namespace':'custom','key':'etiquetas'}]})
            print('      DELETE errs=', res['data']['metafieldsDelete']['userErrors'])
