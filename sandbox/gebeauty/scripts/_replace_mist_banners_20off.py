# -*- coding: utf-8 -*-
"""Replace the Body & Hair Mist banners (até 20% off copy) on the live store:
  - Collection /collections/body-hair-mist  -> collection metafields custom.banner_1 (desktop) + custom.banner_1_mb (mobile)
  - Homepage slideshow slide_XrHipC in templates/index.json -> image (desktop) + image_mb (mobile)
Uploads 4 new Files (old files left in place, reversible). Backs up index.json before the theme write."""
import json, urllib.request, urllib.error, mimetypes, time, uuid, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')

TOKEN = None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='):
        TOKEN = line.strip().split('=', 1)[1]
API = 'https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01'
MAIN_THEME = 181379236160
COLLECTION_GID = "gid://shopify/Collection/515330376000"
SC = Path(r"C:/Users/LUCASG~1/AppData/Local/Temp/claude/c--Users-Lucas-Guimar-es-Desktop-nami-works/1a71e06c-72a4-46bf-832b-900de4a1ac01/scratchpad")

# escaped-slash forms as stored in the JSON template
OLD_HOME_WEB = r"shopify:\/\/shop_images\/lancamento-novos-body-hair-mists_banner-web_home.png"
OLD_HOME_MOB = r"shopify:\/\/shop_images\/lancamento-novos-body-hair-mists_banner-mobile_home_e74c0c55-cebd-4973-a408-19ccb8706746.png"

UPLOADS = {
    "col_web":  (SC / "final-desktop-collection.png", "lancamento-body-hair-mists_banner-web_colecao_20off.png",  "body & hair mist - colecao (desktop, ate 20% off)"),
    "col_mob":  (SC / "final-mobile-collection.png",  "lancamento-body-hair-mists_banner-mobile_colecao_20off.png", "body & hair mist - colecao (mobile, ate 20% off)"),
    "home_web": (SC / "final-desktop-homepage.png",   "lancamento-body-hair-mists_banner-web_home_20off.png",   "body & hair mist - home (desktop, ate 20% off)"),
    "home_mob": (SC / "final-mobile-homepage.png",    "lancamento-body-hair-mists_banner-mobile_home_20off.png", "body & hair mist - home (mobile, ate 20% off)"),
}

def gql(q, v=None):
    b = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    r = urllib.request.Request(f'{API}/graphql.json', data=b,
        headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    return json.loads(urllib.request.urlopen(r).read())

def rest_get(path):
    r = urllib.request.Request(f'{API}/{path}', headers={'X-Shopify-Access-Token': TOKEN})
    return json.loads(urllib.request.urlopen(r).read())

def rest_put(path, payload):
    b = json.dumps(payload).encode()
    r = urllib.request.Request(f'{API}/{path}', data=b, method='PUT',
        headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    return json.loads(urllib.request.urlopen(r).read())

def file_create_from_url(url, alt):
    fc = gql('''mutation($files:[FileCreateInput!]!){fileCreate(files:$files){files{id fileStatus} userErrors{field message}}}''',
        {"files": [{"originalSource": url, "contentType": "IMAGE", "alt": alt}]})['data']['fileCreate']
    if fc['userErrors']:
        raise SystemExit(f'fileCreate errors: {fc["userErrors"]}')
    return fc['files'][0]['id']

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
    crlf = '\r\n'; body = b''
    for p in t['parameters']:
        body += ('--'+boundary+crlf).encode()
        body += (f'Content-Disposition: form-data; name="{p["name"]}"'+crlf+crlf).encode()
        body += (p['value']+crlf).encode()
    body += ('--'+boundary+crlf).encode()
    body += (f'Content-Disposition: form-data; name="file"; filename="{filename}"'+crlf).encode()
    body += (f'Content-Type: {mime}'+crlf+crlf).encode()
    body += data + crlf.encode() + ('--'+boundary+'--'+crlf).encode()
    req = urllib.request.Request(t['url'], data=body, method='POST', headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    with urllib.request.urlopen(req) as resp:
        print(f'  staged HTTP {resp.status} ({filename})')
    return file_create_from_url(t['resourceUrl'], alt)

def wait_ready(gid, label):
    for _ in range(40):
        n = gql('query($id:ID!){node(id:$id){... on MediaImage{id fileStatus image{url width height}}}}', {"id": gid})['data']['node'] or {}
        if n.get('fileStatus') == 'READY':
            print(f'  READY {label}: {n["id"]}  {n["image"]["width"]}x{n["image"]["height"]}')
            return n['id'], n['image']['url']
        time.sleep(2)
    raise SystemExit(f'timeout waiting {label}')

print("== 1. UPLOAD 4 files ==")
res = {}
for k, (src, fname, alt) in UPLOADS.items():
    assert src.exists(), f"missing {src}"
    gid = staged_upload_local(src, fname, alt)
    res[k] = wait_ready(gid, k)

print("\n== 2. COLLECTION metafields ==")
m = gql('mutation($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){metafields{key value} userErrors{field message}}}',
    {"m": [
        {"ownerId": COLLECTION_GID, "namespace": "custom", "key": "banner_1", "type": "file_reference", "value": res["col_web"][0]},
        {"ownerId": COLLECTION_GID, "namespace": "custom", "key": "banner_1_mb", "type": "file_reference", "value": res["col_mob"][0]},
    ]})['data']['metafieldsSet']
if m['userErrors']:
    raise SystemExit(f'metafieldsSet errors: {m["userErrors"]}')
for mf in m['metafields']:
    print(f"  set custom.{mf['key']} = {mf['value']}")

print("\n== 3. HOMEPAGE theme index.json ==")
def ref_from_url(url):  # -> escaped shopify://shop_images/<filename>
    fn = url.split('?')[0].rsplit('/', 1)[-1]
    return "shopify:\\/\\/shop_images\\/" + fn
new_home_web = ref_from_url(res["home_web"][1])
new_home_mob = ref_from_url(res["home_mob"][1])
print(f"  new desktop ref: {new_home_web}")
print(f"  new mobile  ref: {new_home_mob}")

asset = rest_get(f"themes/{MAIN_THEME}/assets.json?asset[key]=templates%2Findex.json")["asset"]
val = asset["value"]
(SC / "index.json.bak").write_text(val, encoding='utf-8')
print(f"  backed up index.json ({len(val)} bytes) -> {SC/'index.json.bak'}")

c_web = val.count(OLD_HOME_WEB); c_mob = val.count(OLD_HOME_MOB)
print(f"  occurrences: desktop={c_web} mobile={c_mob}")
if c_web != 1 or c_mob != 1:
    raise SystemExit("ABORT: expected exactly 1 occurrence of each old ref; not editing.")
val = val.replace(OLD_HOME_WEB, new_home_web).replace(OLD_HOME_MOB, new_home_mob)
# sanity: still valid JSON
json.loads(val)
r = rest_put(f"themes/{MAIN_THEME}/assets.json", {"asset": {"key": "templates/index.json", "value": val}})
print(f"  PUT index.json -> updated_at={r.get('asset',{}).get('updated_at')}")
print("\nDONE")
