"""Reformat the 'body & hair mists (full-size)' collection description heading
to match the 'para todo dia' reference pattern: <h4><strong>..</strong></h4> + <p>.
Preserves the live text content. Dry-run unless argv[1]=='apply'."""
import json, urllib.request, sys, re
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

TARGET='gid://shopify/Collection/515330572608'
cur=gql('query($id:ID!){ collection(id:$id){ descriptionHtml } }',{'id':TARGET})['data']['collection']['descriptionHtml'] or ''

def to_h4_strong(m):
    inner=m.group(2).strip()
    # avoid double <strong>
    if not re.search(r'<\s*strong', inner, re.I):
        inner=f'<strong>{inner}</strong>'
    return f'<h4>{inner}</h4>'

# convert any h1/h2/h3 heading to h4>strong (reference pattern)
new=re.sub(r'<\s*h([1-3])\s*>(.*?)<\s*/\s*h\1\s*>', to_h4_strong, cur, flags=re.I|re.S)

print('--- BEFORE ---'); print(cur)
print('--- AFTER ---'); print(new)
if new==cur:
    print('\n(no change needed)'); sys.exit(0)
if APPLY:
    r=gql('''mutation($input:CollectionInput!){ collectionUpdate(input:$input){ collection{ descriptionHtml } userErrors{ field message } } }''',
          {'input':{'id':TARGET,'descriptionHtml':new}})
    res=r['data']['collectionUpdate']
    print('\nuserErrors=',res['userErrors'])
    print('verified descriptionHtml now:')
    print(res['collection']['descriptionHtml'])
