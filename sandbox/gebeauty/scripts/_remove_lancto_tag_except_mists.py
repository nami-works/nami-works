"""Remove the exact admin tag 'lancto' from every product that has it EXCEPT the 3 new
body & hair mists. Only the literal 'lancto' tag (NOT lancto-essencial / lancto2025 / etc).
Dry-run unless argv[1]=='apply'. Also reports any smart collection ruled on tag 'lancto'."""
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

TAG='lancto'
KEEP={'rose-ritual-body-hair-mist','pear-fresh-body-hair-mist','santal-skin-body-hair-mist'}

# side-effect: collections ruled on this tag
CQ='{ collections(first:250){ nodes{ handle title ruleSet{ rules{ column relation condition } } } } }'
ruled=[]
for n in gql(CQ)['data']['collections']['nodes']:
    rs=n['ruleSet']
    if rs and any(r['column']=='TAG' and r['condition'].strip().lower()==TAG for r in rs['rules']):
        ruled.append(n['handle'])
print('Smart collections ruled on tag "%s": %s' % (TAG, ruled or 'none'))

Q='''query($c:String){ products(first:200, after:$c, query:"tag:lancto"){ nodes{ id title handle tags } pageInfo{ hasNextPage endCursor } } }'''
RM='''mutation($id:ID!,$tags:[String!]!){ tagsRemove(id:$id, tags:$tags){ userErrors{field message} } }'''

affected=[]; kept=[]; c=None
while True:
    r=gql(Q,{'c':c}); pr=r['data']['products']
    for n in pr['nodes']:
        if TAG not in [t.strip() for t in n['tags']]: continue   # defensive exact-match
        if n['handle'] in KEEP: kept.append(n['handle'])
        else: affected.append((n['id'],n['title'],n['handle']))
    if pr['pageInfo']['hasNextPage']: c=pr['pageInfo']['endCursor']
    else: break

print('MODE:', 'APPLY' if APPLY else 'DRY-RUN')
print(f'KEEP "{TAG}" on: {sorted(kept)}')
print(f'REMOVE "{TAG}" from {len(affected)} product(s):')
for pid,title,handle in affected:
    print(f'  {title}  ({handle})')
    if APPLY:
        res=gql(RM,{'id':pid,'tags':[TAG]})
        print('      errs=', res['data']['tagsRemove']['userErrors'])
