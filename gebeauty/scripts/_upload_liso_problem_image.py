# -*- coding: utf-8 -*-
"""Upload a local PNG to Shopify Files (staged upload -> fileCreate -> poll READY)
and wire its MediaImage gid to the Primer Liso LP page's custom.imagem_problema
(the problem-section image, per the updated initiative). Idempotent-ish: re-running
uploads a new file; safe because it only sets the page metafield to the newest gid."""
import json, urllib.request, urllib.error, mimetypes, time, uuid, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')

TOKEN = None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='):
        TOKEN = line.strip().split('=', 1)[1]
API = 'https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01'
PAGE_GID = "gid://shopify/Page/164368908608"   # Primer Liso Intacto LP
SRC = Path(r"C:/Users/Lucas Guimarães/Desktop/scalp-references/scalp_straight_lightbrown.png")
FILENAME = "primer-liso-lp-problema.png"
ALT = "Primer Liso Intacto - cabelo liso com frizz e volta da umidade (secao problema)"


def gql(q, v=None):
    b = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    r = urllib.request.Request(f'{API}/graphql.json', data=b, headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    return json.loads(urllib.request.urlopen(r).read())


data = SRC.read_bytes()
mime = mimetypes.guess_type(str(SRC))[0] or 'image/png'
print(f'file: {SRC.name} | {len(data):,} bytes | {mime}')

# 1. stagedUploadsCreate
staged = gql('''mutation($input:[StagedUploadInput!]!){stagedUploadsCreate(input:$input){
  stagedTargets{url resourceUrl parameters{name value}} userErrors{field message}}}''',
    {"input": [{"filename": FILENAME, "mimeType": mime, "resource": "FILE", "httpMethod": "POST", "fileSize": str(len(data))}]})
su = staged['data']['stagedUploadsCreate']
if su['userErrors']:
    print('stagedUploadsCreate errors:', su['userErrors']); sys.exit(1)
target = su['stagedTargets'][0]
upload_url = target['url']
resource_url = target['resourceUrl']
params = target['parameters']

# 2. POST multipart to the staged target
boundary = '----ge' + uuid.uuid4().hex
crlf = '\r\n'
body = b''
for p in params:
    body += ('--' + boundary + crlf).encode()
    body += (f'Content-Disposition: form-data; name="{p["name"]}"' + crlf + crlf).encode()
    body += (p['value'] + crlf).encode()
body += ('--' + boundary + crlf).encode()
body += (f'Content-Disposition: form-data; name="file"; filename="{FILENAME}"' + crlf).encode()
body += (f'Content-Type: {mime}' + crlf + crlf).encode()
body += data + crlf.encode()
body += ('--' + boundary + '--' + crlf).encode()
req = urllib.request.Request(upload_url, data=body, method='POST',
                             headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
try:
    with urllib.request.urlopen(req) as resp:
        print('staged upload HTTP', resp.status)
except urllib.error.HTTPError as e:
    print('staged upload FAILED', e.code, e.read().decode()[:400]); sys.exit(1)

# 3. fileCreate from the staged resource
fc = gql('''mutation($files:[FileCreateInput!]!){fileCreate(files:$files){
  files{id fileStatus alt ... on MediaImage{id}} userErrors{field message}}}''',
    {"files": [{"originalSource": resource_url, "contentType": "IMAGE", "alt": ALT}]})
r = fc['data']['fileCreate']
if r['userErrors']:
    print('fileCreate errors:', r['userErrors']); sys.exit(1)
file_gid = r['files'][0]['id']
print('fileCreate ->', file_gid, r['files'][0]['fileStatus'])

# 4. poll until READY to get the MediaImage gid
media_gid = None
for i in range(30):
    d = gql('query($id:ID!){node(id:$id){... on MediaImage{id fileStatus image{url width height}}}}', {"id": file_gid})
    node = d['data']['node'] or {}
    status = node.get('fileStatus')
    if status == 'READY':
        media_gid = node['id']
        print('READY ->', media_gid, node.get('image'))
        break
    print(f'  [{i}] status={status}, waiting...')
    time.sleep(2)
if not media_gid:
    print('timed out waiting for READY'); sys.exit(1)

# 5. set the page metafield
ms = gql('mutation($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){metafields{key value} userErrors{field message}}}',
    {"m": [{"ownerId": PAGE_GID, "namespace": "custom", "key": "imagem_problema", "type": "file_reference", "value": media_gid}]})
res = ms['data']['metafieldsSet']
print('metafieldsSet:', res['userErrors'] or 'OK', '->', res['metafields'])
