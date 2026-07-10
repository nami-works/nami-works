"""Retry Santal Skin image upload (per-file staging, one retry each)."""
import json, time, urllib.request, urllib.error, os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
URL = "https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json"
HDRS = {"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN}
BASE = Path(r"G:\Drives compartilhados\GEB_Marketing\MARKETING COMPARTILHADO\IMAGENS\Produtos\Novos Body & Hair Mists")
GID = "gid://shopify/Product/10163564249408"
ALT = "Santal Skin Body & Hair Mist GE Beauty, bruma amadeirada para cabelo e corpo"


def gql(q, v=None):
    b = json.dumps({"query": q, "variables": v or {}}).encode()
    return json.loads(urllib.request.urlopen(urllib.request.Request(URL, data=b, headers=HDRS), timeout=120).read())


STAGE = """mutation($input:[StagedUploadInput!]!){ stagedUploadsCreate(input:$input){
  stagedTargets{ url resourceUrl parameters{ name value } } userErrors{ field message } } }"""
CREATE_MEDIA = """mutation($pid:ID!,$media:[CreateMediaInput!]!){ productCreateMedia(productId:$pid, media:$media){
  media{ ... on MediaImage{ id status } } mediaUserErrors{ field message } userErrors{ field message } } }"""


def mp_post(url, params, fb, fn):
    bnd = "----gebSantalRetry44"
    pre = b""
    for p in params:
        pre += (f"--{bnd}\r\nContent-Disposition: form-data; name=\"{p['name']}\"\r\n\r\n{p['value']}\r\n").encode()
    pre += (f"--{bnd}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{fn}\"\r\nContent-Type: image/png\r\n\r\n").encode()
    body = pre + fb + (f"\r\n--{bnd}--\r\n").encode()
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={bnd}"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return r.status


def upload_one(f):
    """Stage + POST one file, with one retry. Returns resourceUrl or None."""
    for attempt in (1, 2):
        st = gql(STAGE, {"input": [{"resource": "IMAGE", "filename": f.name, "mimeType": "image/png",
                                    "httpMethod": "POST", "fileSize": str(f.stat().st_size)}]})
        tgt = st["data"]["stagedUploadsCreate"]["stagedTargets"][0]
        try:
            code = mp_post(tgt["url"], tgt["parameters"], f.read_bytes(), f.name)
            print(f"  {f.name} -> HTTP {code} (attempt {attempt})")
            return tgt["resourceUrl"]
        except urllib.error.HTTPError as e:
            print(f"  {f.name} attempt {attempt} HTTP {e.code}; {'retrying' if attempt == 1 else 'giving up'}")
            time.sleep(2)
    return None


media = []
for f in sorted(BASE.glob("santal-skin_*.png")):
    ru = upload_one(f)
    if ru:
        media.append({"originalSource": ru, "mediaContentType": "IMAGE", "alt": ALT})
if media:
    cm = gql(CREATE_MEDIA, {"pid": GID, "media": media})
    d = cm["data"]["productCreateMedia"]
    print("media errors:", d["mediaUserErrors"], d["userErrors"])
    print("attached:", ", ".join(m["status"] for m in d["media"]))
