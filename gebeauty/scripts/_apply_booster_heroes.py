"""Replace the #1 hero of the 4 booster products with the bg-normalized PNGs (antifrizz
untouched). Flow: stage+upload -> productCreateMedia -> wait READY -> reorder to #1 ->
delete old #1 -> verify. Fixes collection grid, nossos-boosters LP, and PDP thumbnail at once.
Dry-run unless argv[1]=='apply'. Corrected PNGs live in the session scratchpad."""
import json, urllib.request, sys, os, time
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
APPLY = len(sys.argv) > 1 and sys.argv[1] == 'apply'
TOKEN=None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='): TOKEN=line.strip().split('=',1)[1]
URL='https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json'
SC=r"C:/Users/LUCASG~1/AppData/Local/Temp/claude/c--Users-Lucas-Guimar-es-Desktop-nami-works/0823b26b-fda8-4dcd-b164-b799bf85aa82/scratchpad/boosters-hero"
JOBS=[('booster-fortificante', SC+'/flat_booster-fortificante.png'),
      ('booster-hidratante',   SC+'/flat_booster-hidratante.png'),
      ('booster-definicao',    SC+'/flat_booster-definicao.png'),
      ('booster-antioxidante', SC+'/flat2_booster-antioxidante.png')]
def gql(q,v=None):
    body=json.dumps({'query':q,**({'variables':v} if v else {})}).encode()
    req=urllib.request.Request(URL,data=body,headers={'Content-Type':'application/json','X-Shopify-Access-Token':TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode())
PQ='query($q:String){ products(first:1, query:$q){ nodes{ id media(first:40){ nodes{ ... on MediaImage { id status } } } } } }'
STAGE='mutation($input:[StagedUploadInput!]!){ stagedUploadsCreate(input:$input){ stagedTargets{ url resourceUrl parameters{name value} } userErrors{field message} } }'
CREATE='mutation($pid:ID!,$media:[CreateMediaInput!]!){ productCreateMedia(productId:$pid, media:$media){ media{ ... on MediaImage { id status } } mediaUserErrors{field message} } }'
REORDER='mutation($id:ID!,$moves:[MoveInput!]!){ productReorderMedia(id:$id, moves:$moves){ job{id} userErrors{field message} } }'
DELETE='mutation($pid:ID!,$mids:[ID!]!){ productDeleteMedia(productId:$pid, mediaIds:$mids){ deletedMediaIds userErrors{field message} } }'
def post_mp(url,params,fn,data):
    b='----geb'+os.urandom(8).hex(); nl=b'\r\n'; buf=[]
    for p in params: buf+=[b'--'+b.encode()+nl,('Content-Disposition: form-data; name="%s"'%p['name']).encode()+nl+nl,str(p['value']).encode()+nl]
    buf+=[b'--'+b.encode()+nl,('Content-Disposition: form-data; name="file"; filename="%s"'%fn).encode()+nl,b'Content-Type: image/png'+nl+nl,data+nl,b'--'+b.encode()+b'--'+nl]
    return urllib.request.urlopen(urllib.request.Request(url,data=b''.join(buf),method='POST',headers={'Content-Type':'multipart/form-data; boundary='+b})).status
print(f'MODE={"APPLY" if APPLY else "DRY-RUN"} | jobs={len(JOBS)}')
for handle,path in JOBS:
    if not os.path.exists(path): print(f'{handle}: MISSING {path}'); continue
    p=gql(PQ,{'q':'handle:'+handle})['data']['products']['nodes'][0]
    pid=p['id']; old=p['media']['nodes'][0]['id']
    print(f"\n== {handle} == product {pid.split('/')[-1]} | old #1 {old.split('/')[-1]}")
    if not APPLY: print('  (dry-run; pass apply)'); continue
    st=gql(STAGE,{'input':[{'resource':'IMAGE','filename':os.path.basename(path),'mimeType':'image/png','httpMethod':'POST','fileSize':str(os.path.getsize(path))}]})['data']['stagedUploadsCreate']
    if st['userErrors']: print('  stage err',st['userErrors']); continue
    t=st['stagedTargets'][0]
    print('  upload', post_mp(t['url'],t['parameters'],os.path.basename(path),open(path,'rb').read()))
    cr=gql(CREATE,{'pid':pid,'media':[{'mediaContentType':'IMAGE','originalSource':t['resourceUrl'],'alt':handle}]})['data']['productCreateMedia']
    if cr['mediaUserErrors']: print('  create err',cr['mediaUserErrors']); continue
    newid=cr['media'][0]['id']
    stt='PENDING'
    for _ in range(30):
        stt=gql('query($id:ID!){ node(id:$id){ ... on MediaImage { status } } }',{'id':newid})['data']['node']['status']
        if stt=='READY': break
        time.sleep(2)
    print('  status',stt)
    ro=gql(REORDER,{'id':pid,'moves':[{'id':newid,'newPosition':'0'}]})['data']['productReorderMedia']
    print('  reorder job',bool(ro.get('job')),'errs',ro['userErrors']); time.sleep(2)
    dl=gql(DELETE,{'pid':pid,'mids':[old]})['data']['productDeleteMedia']
    print('  deleted old',dl['deletedMediaIds'],'errs',dl['userErrors'])
    v=gql(PQ,{'q':'handle:'+handle})['data']['products']['nodes'][0]['media']['nodes']
    print('  now #1 =',v[0]['id'].split('/')[-1],'| old gone:',old not in [m['id'] for m in v],'| media count:',len(v))
print('\nDONE')
