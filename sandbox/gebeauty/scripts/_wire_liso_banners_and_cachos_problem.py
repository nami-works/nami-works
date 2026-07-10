# -*- coding: utf-8 -*-
"""Three uploads in one pass:
  1. Primer Liso LP hero banners (mobile + desktop) from the committed Canva export
     URLs -> Shopify Files -> banner_mobile / banner_desktop on the Liso page.
  2. Primer Cachos LP problem-section image (local file) -> Shopify Files ->
     imagem_problema on the Cachos page (favor for the initiative session).
URL sources use fileCreate originalSource directly (Shopify fetches). The local file
uses a staged upload. Both poll to READY before wiring the page metafields."""
import json, urllib.request, urllib.error, mimetypes, time, uuid, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')

TOKEN = None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='):
        TOKEN = line.strip().split('=', 1)[1]
API = 'https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01'
LISO_PAGE = "gid://shopify/Page/164368908608"
CACHOS_PAGE = "gid://shopify/Page/164358750528"

BANNER_MOBILE_URL = "https://export-download.canva.com/VWJLY/DAHOXhVWJLY/-1/0/0001-8371574188717979141.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAQYCGKMUH5AO7UJ26%2F20260703%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260703T055226Z&X-Amz-Expires=65753&X-Amz-Signature=b8db270f1c36073b0f65566fc4d37d61b3e1e17ef1c22d5ae4608c1feac4c2e7&X-Amz-SignedHeaders=host%3Bx-amz-expected-bucket-owner&response-expires=Sat%2C%2004%20Jul%202026%2000%3A08%3A19%20GMT"
BANNER_DESKTOP_URL = "https://export-download.canva.com/VWJLY/DAHOXhVWJLY/-1/0/0002-3771147166144329280.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAQYCGKMUH5AO7UJ26%2F20260703%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260703T015246Z&X-Amz-Expires=79062&X-Amz-Signature=ea0b1eb061a8517ee124d2d5234af9aae1e0a7b6288a53c370c7699f0a1fc7c0&X-Amz-SignedHeaders=host%3Bx-amz-expected-bucket-owner&response-expires=Fri%2C%2003%20Jul%202026%2023%3A50%3A28%20GMT"
CACHOS_PROBLEM_SRC = Path(r"C:/Users/Lucas Guimarães/Desktop/scalp-references/scalp_curly_darkbrown.png")


def gql(q, v=None):
    b = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    r = urllib.request.Request(f'{API}/graphql.json', data=b, headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    return json.loads(urllib.request.urlopen(r).read())


def file_create_from_url(url, alt):
    fc = gql('''mutation($files:[FileCreateInput!]!){fileCreate(files:$files){
      files{id fileStatus} userErrors{field message}}}''',
        {"files": [{"originalSource": url, "contentType": "IMAGE", "alt": alt}]})
    r = fc['data']['fileCreate']
    if r['userErrors']:
        raise SystemExit(f'fileCreate errors: {r["userErrors"]}')
    return r['files'][0]['id']


def staged_upload_local(src, filename, alt):
    data = src.read_bytes()
    mime = mimetypes.guess_type(str(src))[0] or 'image/png'
    su = gql('''mutation($input:[StagedUploadInput!]!){stagedUploadsCreate(input:$input){
      stagedTargets{url resourceUrl parameters{name value}} userErrors{field message}}}''',
        {"input": [{"filename": filename, "mimeType": mime, "resource": "FILE", "httpMethod": "POST", "fileSize": str(len(data))}]})['data']['stagedUploadsCreate']
    if su['userErrors']:
        raise SystemExit(f'stagedUploadsCreate: {su["userErrors"]}')
    t = su['stagedTargets'][0]
    boundary = '----ge' + uuid.uuid4().hex
    crlf = '\r\n'
    body = b''
    for p in t['parameters']:
        body += ('--' + boundary + crlf).encode()
        body += (f'Content-Disposition: form-data; name="{p["name"]}"' + crlf + crlf).encode()
        body += (p['value'] + crlf).encode()
    body += ('--' + boundary + crlf).encode()
    body += (f'Content-Disposition: form-data; name="file"; filename="{filename}"' + crlf).encode()
    body += (f'Content-Type: {mime}' + crlf + crlf).encode()
    body += data + crlf.encode() + ('--' + boundary + '--' + crlf).encode()
    req = urllib.request.Request(t['url'], data=body, method='POST', headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    with urllib.request.urlopen(req) as resp:
        print(f'  staged upload HTTP {resp.status} ({filename})')
    return file_create_from_url(t['resourceUrl'], alt)


def wait_ready(file_gid, label):
    for i in range(40):
        d = gql('query($id:ID!){node(id:$id){... on MediaImage{id fileStatus image{url width height}}}}', {"id": file_gid})
        node = d['data']['node'] or {}
        if node.get('fileStatus') == 'READY':
            print(f'  READY {label}: {node["id"]} {node.get("image")}')
            return node['id']
        time.sleep(2)
    raise SystemExit(f'timed out waiting for {label}')


def set_mf(page_gid, key, gid):
    r = gql('mutation($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){metafields{key value} userErrors{field message}}}',
        {"m": [{"ownerId": page_gid, "namespace": "custom", "key": key, "type": "file_reference", "value": gid}]})['data']['metafieldsSet']
    print(f'  set {key}:', r['userErrors'] or r['metafields'])


print('== Liso banners ==')
mob = file_create_from_url(BANNER_MOBILE_URL, "Primer Liso Intacto - escova perfeita por ate 24h (hero mobile)")
desk = file_create_from_url(BANNER_DESKTOP_URL, "Primer Liso Intacto - escova perfeita por ate 24h (hero desktop)")
mob_gid = wait_ready(mob, 'banner_mobile')
desk_gid = wait_ready(desk, 'banner_desktop')
set_mf(LISO_PAGE, 'banner_mobile', mob_gid)
set_mf(LISO_PAGE, 'banner_desktop', desk_gid)

print('== Cachos problem image ==')
print(f'  file exists: {CACHOS_PROBLEM_SRC.exists()} | {CACHOS_PROBLEM_SRC.stat().st_size:,} bytes' if CACHOS_PROBLEM_SRC.exists() else '  MISSING FILE')
cp = staged_upload_local(CACHOS_PROBLEM_SRC, "primer-cachos-lp-problema.png",
                         "Primer Cachos Definidos - cachos com frizz (secao problema)")
cp_gid = wait_ready(cp, 'cachos imagem_problema')
set_mf(CACHOS_PAGE, 'imagem_problema', cp_gid)
print('DONE')
