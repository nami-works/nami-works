"""Apply specific regen heroes from hero-validation-regen/ to live store.
Usage: python _apply_regen.py apply <handle> [<handle> ...]"""
import json, urllib.request, sys, os, time
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
APPLY = len(sys.argv)>1 and sys.argv[1]=='apply'
HANDLES=sys.argv[2:]
TOKEN=[l.strip().split('=',1)[1] for l in open(Path(__file__).resolve().parent.parent/'.env',encoding='utf-8') if l.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN=')][0]
URL='https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json'
FOLDER=Path('c:/Users/Lucas Guimarães/Desktop/nami-works/sandbox/gebeauty/hero-validation-regen')
def gql(q,v=None):
    body=json.dumps({'query':q,**({'variables':v} if v else {})}).encode()
    req=urllib.request.Request(URL,data=body,headers={'Content-Type':'application/json','X-Shopify-Access-Token':TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode())
PQ='query($q:String){ products(first:1, query:$q){ nodes{ id media(first:40){ nodes{ ... on MediaImage { id } } } } } }'
STAGE='mutation($input:[StagedUploadInput!]!){ stagedUploadsCreate(input:$input){ stagedTargets{ url resourceUrl parameters{name value} } userErrors{field message} } }'
CREATE='mutation($pid:ID!,$media:[CreateMediaInput!]!){ productCreateMedia(productId:$pid, media:$media){ media{ ... on MediaImage { id status } } mediaUserErrors{field message} } }'
REORDER='mutation($id:ID!,$moves:[MoveInput!]!){ productReorderMedia(id:$id, moves:$moves){ job{id} userErrors{field message} } }'
DELETE='mutation($pid:ID!,$mids:[ID!]!){ productDeleteMedia(productId:$pid, mediaIds:$mids){ deletedMediaIds userErrors{field message} } }'
def post_mp(url,params,fn,data):
    b='----geb'+os.urandom(8).hex(); nl=b'\r\n'; buf=[]
    for p in params: buf+=[b'--'+b.encode()+nl,('Content-Disposition: form-data; name="%s"'%p['name']).encode()+nl+nl,str(p['value']).encode()+nl]
    buf+=[b'--'+b.encode()+nl,('Content-Disposition: form-data; name="file"; filename="%s"'%fn).encode()+nl,b'Content-Type: image/png'+nl+nl,data+nl,b'--'+b.encode()+b'--'+nl]
    return urllib.request.urlopen(urllib.request.Request(url,data=b''.join(buf),method='POST',headers={'Content-Type':'multipart/form-data; boundary='+b})).status
print(f'MODE={"APPLY" if APPLY else "DRY"} handles={HANDLES}')
for h in HANDLES:
    path=FOLDER/f'{h}.png'
    if not path.exists(): print('  MISSING',h); continue
    p=gql(PQ,{'q':'handle:'+h})['data']['products']['nodes'][0]; pid=p['id']; old=p['media']['nodes'][0]['id']
    if not APPLY: print(f'  {h}: would replace {old.split("/")[-1]}'); continue
    st=gql(STAGE,{'input':[{'resource':'IMAGE','filename':h+'.png','mimeType':'image/png','httpMethod':'POST','fileSize':str(os.path.getsize(path))}]})['data']['stagedUploadsCreate']['stagedTargets'][0]
    post_mp(st['url'],st['parameters'],h+'.png',open(path,'rb').read())
    cr=gql(CREATE,{'pid':pid,'media':[{'mediaContentType':'IMAGE','originalSource':st['resourceUrl'],'alt':h}]})['data']['productCreateMedia']
    if cr['mediaUserErrors']: print('  ERR',h,cr['mediaUserErrors']); continue
    newid=cr['media'][0]['id']
    for _ in range(20):
        if gql('query($id:ID!){ node(id:$id){ ... on MediaImage { status } } }',{'id':newid})['data']['node']['status']=='READY': break
        time.sleep(2)
    gql(REORDER,{'id':pid,'moves':[{'id':newid,'newPosition':'0'}]}); time.sleep(1.5)
    d=gql(DELETE,{'pid':pid,'mids':[old]})['data']['productDeleteMedia']
    print(f'  {h}: new #1 {newid.split("/")[-1]} deleted {d["deletedMediaIds"]}')
print('DONE')
