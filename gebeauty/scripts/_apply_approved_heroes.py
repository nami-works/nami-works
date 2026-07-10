"""Apply approved corrected heroes from the validation folder: for each approved handle,
upload sandbox/gebeauty/hero-validation/<handle>.png -> attach -> reorder to #1 -> delete old #1.
Approved = folder files MINUS the 7 reproved MINUS already-live mascara-mayday.
Dry-run unless argv[1]=='apply'."""
import json, urllib.request, sys, os, time
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
APPLY = len(sys.argv)>1 and sys.argv[1]=='apply'
TOKEN=None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='): TOKEN=line.strip().split('=',1)[1]
URL='https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json'
FOLDER=Path('c:/Users/Lucas Guimarães/Desktop/nami-works/sandbox/gebeauty/hero-validation')
REPROVED={'kit-cabelo-renovado','kit-finalizacao-com-brilho-1','kit-beach-hair','kit-reconstrucao-leveza','kit-travel-size','shampoo-sem-sulfato-travel-size','travel-size-kit-para-todo-dia'}
ALREADY={'mascara-mayday'}
approved=sorted({p.stem for p in FOLDER.glob('*.png')} - REPROVED - ALREADY)
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
print(f'approved to apply: {len(approved)} | MODE={"APPLY" if APPLY else "DRY-RUN"}')
ok=0; fail=[]
for i,h in enumerate(approved,1):
    path=FOLDER/f'{h}.png'
    try:
        p=gql(PQ,{'q':'handle:'+h})['data']['products']['nodes'][0]; pid=p['id']; old=p['media']['nodes'][0]['id']
        if not APPLY: print(f'  [{i}/{len(approved)}] {h}: would replace old {old.split("/")[-1]}'); continue
        st=gql(STAGE,{'input':[{'resource':'IMAGE','filename':h+'.png','mimeType':'image/png','httpMethod':'POST','fileSize':str(os.path.getsize(path))}]})['data']['stagedUploadsCreate']['stagedTargets'][0]
        post_mp(st['url'],st['parameters'],h+'.png',open(path,'rb').read())
        cr=gql(CREATE,{'pid':pid,'media':[{'mediaContentType':'IMAGE','originalSource':st['resourceUrl'],'alt':h}]})['data']['productCreateMedia']
        if cr['mediaUserErrors']: fail.append((h,cr['mediaUserErrors'])); print(f'  [{i}] {h} CREATE ERR'); continue
        newid=cr['media'][0]['id']
        for _ in range(20):
            if gql('query($id:ID!){ node(id:$id){ ... on MediaImage { status } } }',{'id':newid})['data']['node']['status']=='READY': break
            time.sleep(2)
        gql(REORDER,{'id':pid,'moves':[{'id':newid,'newPosition':'0'}]}); time.sleep(1.5)
        d=gql(DELETE,{'pid':pid,'mids':[old]})['data']['productDeleteMedia']
        ok+=1; print(f'  [{i}/{len(approved)}] {h}: new #1 {newid.split("/")[-1]} deleted {d["deletedMediaIds"]}')
    except Exception as e:
        fail.append((h,str(e))); print(f'  [{i}] {h} ERROR {e}')
print(f'\nDONE ok={ok} fail={len(fail)}')
for h,e in fail: print('  FAIL',h,e)
