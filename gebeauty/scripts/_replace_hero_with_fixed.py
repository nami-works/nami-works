"""Replace the #1 hero of a product with a locally-corrected PNG:
upload -> attach -> reorder to position #1 -> delete the old #1. Verifies after.
apply unless argv[1] != 'apply'."""
import json, urllib.request, sys, os, time
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
APPLY = len(sys.argv) > 1 and sys.argv[1] == 'apply'
TOKEN=None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='): TOKEN=line.strip().split('=',1)[1]
URL='https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json'
def gql(q,v=None):
    body=json.dumps({'query':q,**({'variables':v} if v else {})}).encode()
    req=urllib.request.Request(URL,data=body,headers={'Content-Type':'application/json','X-Shopify-Access-Token':TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode())
SC="C:/Users/LUCASG~1/AppData/Local/Temp/claude/c--claude/b4078ee5-bd3e-40ec-8f18-b2a031134f3e/scratchpad"
JOBS=[('mascara-mayday', SC+'/hero_fixed_mascara-mayday.png'),
      ('kit-travel-size', SC+'/hero_fixed_kit-travel-size.png')]

PQ='query($q:String){ products(first:1, query:$q){ nodes{ id media(first:40){ nodes{ ... on MediaImage { id status } } } } } }'
STAGE='mutation($input:[StagedUploadInput!]!){ stagedUploadsCreate(input:$input){ stagedTargets{ url resourceUrl parameters{name value} } userErrors{field message} } }'
CREATE='mutation($pid:ID!,$media:[CreateMediaInput!]!){ productCreateMedia(productId:$pid, media:$media){ media{ ... on MediaImage { id status } } mediaUserErrors{field message} } }'
REORDER='mutation($id:ID!,$moves:[MoveInput!]!){ productReorderMedia(id:$id, moves:$moves){ job{id} userErrors{field message} } }'
DELETE='mutation($pid:ID!,$mids:[ID!]!){ productDeleteMedia(productId:$pid, mediaIds:$mids){ deletedMediaIds userErrors{field message} } }'

def post_multipart(url, params, filename, data):
    boundary='----geb'+os.urandom(8).hex(); nl=b'\r\n'; buf=[]
    for p in params:
        buf.append(b'--'+boundary.encode()+nl); buf.append(('Content-Disposition: form-data; name="%s"'%p['name']).encode()+nl+nl); buf.append(str(p['value']).encode()+nl)
    buf.append(b'--'+boundary.encode()+nl); buf.append(('Content-Disposition: form-data; name="file"; filename="%s"'%filename).encode()+nl); buf.append(b'Content-Type: image/png'+nl+nl); buf.append(data+nl); buf.append(b'--'+boundary.encode()+b'--'+nl)
    req=urllib.request.Request(url,data=b''.join(buf),method='POST',headers={'Content-Type':'multipart/form-data; boundary='+boundary})
    return urllib.request.urlopen(req).status

for handle,path in JOBS:
    if not os.path.exists(path): print(f'{handle}: MISSING {path}'); continue
    p=gql(PQ,{'q':'handle:'+handle})['data']['products']['nodes'][0]
    pid=p['id']; old_first=p['media']['nodes'][0]['id']
    print(f"\n== {handle} == product {pid.split('/')[-1]} | old #1 media {old_first.split('/')[-1]}")
    if not APPLY:
        print('  (dry-run; pass apply)'); continue
    # 1) stage + upload
    st=gql(STAGE,{'input':[{'resource':'IMAGE','filename':os.path.basename(path),'mimeType':'image/png','httpMethod':'POST','fileSize':str(os.path.getsize(path))}]})['data']['stagedUploadsCreate']
    if st['userErrors']: print('  stage err',st['userErrors']); continue
    t=st['stagedTargets'][0]
    print('  upload POST', post_multipart(t['url'],t['parameters'],os.path.basename(path),open(path,'rb').read()))
    # 2) attach
    cr=gql(CREATE,{'pid':pid,'media':[{'mediaContentType':'IMAGE','originalSource':t['resourceUrl'],'alt':handle+' hero'}]})['data']['productCreateMedia']
    if cr['mediaUserErrors']: print('  create err',cr['mediaUserErrors']); continue
    newid=cr['media'][0]['id']; print('  created', newid.split('/')[-1], cr['media'][0]['status'])
    # 3) wait until READY
    for _ in range(20):
        stt=gql('query($id:ID!){ node(id:$id){ ... on MediaImage { status } } }',{'id':newid})['data']['node']['status']
        if stt=='READY': break
        time.sleep(2)
    print('  status', stt)
    # 4) reorder new -> position 0
    ro=gql(REORDER,{'id':pid,'moves':[{'id':newid,'newPosition':'0'}]})['data']['productReorderMedia']
    print('  reorder job', bool(ro.get('job')), 'errs', ro['userErrors'])
    time.sleep(2)
    # 5) delete old #1
    dl=gql(DELETE,{'pid':pid,'mids':[old_first]})['data']['productDeleteMedia']
    print('  deleted old', dl['deletedMediaIds'], 'errs', dl['userErrors'])
    # 6) verify
    v=gql(PQ,{'q':'handle:'+handle})['data']['products']['nodes'][0]['media']['nodes']
    print('  now #1 =', v[0]['id'].split('/')[-1], '| old gone:', old_first not in [m['id'] for m in v], '| media count:', len(v))
