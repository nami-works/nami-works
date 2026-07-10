"""Upload local images to two products via Shopify staged uploads + productCreateMedia.
Additive (appends media). argv[1]=='apply' to actually upload; default = pre-check only."""
import json, urllib.request, sys, os, mimetypes
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

MM='G:/Drives compartilhados/GEB_Marketing/MARKETING COMPARTILHADO/IMAGENS/Produtos'
BATCHES=[
 ('gid://shopify/Product/9946377617728','melon mood 200ml',[
    MM+'/Melon Mood Body & Hair Splash/STILL TRATADAS/square/ge-48917.png',
    MM+'/Melon Mood Body & Hair Splash/STILL TRATADAS/square/ge-48931.png',
    MM+'/Melon Mood Body & Hair Splash/STILL TRATADAS/square/ge-48960.png']),
 ('gid://shopify/Product/10039126032704','melon mood travel size',[
    MM+'/Melon Mood Travel Size/melon-mood_travel-size (1).png',
    MM+'/Melon Mood Travel Size/melon-mood_travel-size (2).png',
    MM+'/Melon Mood Travel Size/melon-mood_travel-size (3).png',
    MM+'/Melon Mood Travel Size/melon-mood_travel-size (1).jpg']),
]

# pre-check
print('=== file pre-check ===')
ok=True
for pid,label,files in BATCHES:
    for f in files:
        ex=os.path.exists(f)
        print(f"  [{'OK ' if ex else 'MISS'}] {Path(f).name}  ({os.path.getsize(f) if ex else 0} bytes)")
        if not ex: ok=False
if not ok: print('Some files missing — fix paths before apply.')
if not APPLY:
    print('\\n(pre-check only; pass "apply" to upload)'); sys.exit(0)
if not ok:
    print('ABORT: missing files'); sys.exit(1)

STAGE='''mutation($input:[StagedUploadInput!]!){ stagedUploadsCreate(input:$input){ stagedTargets{ url resourceUrl parameters{name value} } userErrors{field message} } }'''
CREATE='''mutation($pid:ID!,$media:[CreateMediaInput!]!){ productCreateMedia(productId:$pid, media:$media){ media{ ... on MediaImage { id status } } mediaUserErrors{field message} } }'''

def post_multipart(url, params, filename, data, ctype):
    boundary='----geb'+os.urandom(8).hex(); nl=b'\r\n'; buf=[]
    for p in params:
        buf.append(b'--'+boundary.encode()+nl)
        buf.append(('Content-Disposition: form-data; name="%s"'%p['name']).encode()+nl+nl)
        buf.append(str(p['value']).encode()+nl)
    buf.append(b'--'+boundary.encode()+nl)
    buf.append(('Content-Disposition: form-data; name="file"; filename="%s"'%filename).encode()+nl)
    buf.append(('Content-Type: %s'%ctype).encode()+nl+nl)
    buf.append(data+nl)
    buf.append(b'--'+boundary.encode()+b'--'+nl)
    body=b''.join(buf)
    req=urllib.request.Request(url,data=body,method='POST',headers={'Content-Type':'multipart/form-data; boundary='+boundary})
    return urllib.request.urlopen(req).status

print('\\n=== uploading ===')
for pid,label,files in BATCHES:
    # 1) staged targets
    inp=[{'resource':'IMAGE','filename':Path(f).name,'mimeType':mimetypes.guess_type(f)[0] or 'image/png','httpMethod':'POST','fileSize':str(os.path.getsize(f))} for f in files]
    st=gql(STAGE,{'input':inp})['data']['stagedUploadsCreate']
    if st['userErrors']: print(f'  {label}: stage errors', st['userErrors']); continue
    targets=st['stagedTargets']
    media=[]
    for f,t in zip(files,targets):
        ctype=mimetypes.guess_type(f)[0] or 'image/png'
        code=post_multipart(t['url'],t['parameters'],Path(f).name,open(f,'rb').read(),ctype)
        print(f"  {label}: staged {Path(f).name} -> POST {code}")
        media.append({'mediaContentType':'IMAGE','originalSource':t['resourceUrl'],'alt':label})
    # 2) attach to product
    r=gql(CREATE,{'pid':pid,'media':media})['data']['productCreateMedia']
    print(f"  {label}: created {len(r['media'])} media | statuses={[m.get('status') for m in r['media']]} | errs={r['mediaUserErrors']}")
