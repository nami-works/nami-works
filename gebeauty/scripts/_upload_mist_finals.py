"""Append the 4 final images per scent to each mist DRAFT (earlier hero kept as featured).
Flow per product: stagedUploadsCreate(4) -> multipart POST each -> productCreateMedia(4).
"""
import json, urllib.request, os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
URL = "https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json"
HDRS = {"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN}
BASE = Path(r"G:\Drives compartilhados\GEB_Marketing\MARKETING COMPARTILHADO\IMAGENS\Produtos\Novos Body & Hair Mists")

ITEMS = [
 {"gid": "gid://shopify/Product/10163564183872", "prefix": "rose-ritual_",
  "alt": "Rose Ritual Body & Hair Mist GE Beauty, bruma perfumada de rosas para cabelo e corpo"},
 {"gid": "gid://shopify/Product/10163564216640", "prefix": "pear-fresh_",
  "alt": "Pear Fresh Body & Hair Mist GE Beauty, bruma perfumada de pera para cabelo e corpo"},
 {"gid": "gid://shopify/Product/10163564249408", "prefix": "santal-skin_",
  "alt": "Santal Skin Body & Hair Mist GE Beauty, bruma amadeirada para cabelo e corpo"},
]


def gql(q, v=None):
    b = json.dumps({"query": q, "variables": v or {}}).encode()
    return json.loads(urllib.request.urlopen(
        urllib.request.Request(URL, data=b, headers=HDRS), timeout=120).read())


STAGE = """mutation($input:[StagedUploadInput!]!){ stagedUploadsCreate(input:$input){
  stagedTargets{ url resourceUrl parameters{ name value } } userErrors{ field message } } }"""
CREATE_MEDIA = """mutation($pid:ID!,$media:[CreateMediaInput!]!){ productCreateMedia(productId:$pid, media:$media){
  media{ ... on MediaImage{ id status } } mediaUserErrors{ field message } userErrors{ field message } } }"""


def multipart_post(url, params, filebytes, filename):
    boundary = "----gebMistFinalBoundary91x"
    pre = b""
    for p in params:
        pre += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{p['name']}\"\r\n\r\n{p['value']}\r\n").encode()
    pre += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
            f"Content-Type: image/png\r\n\r\n").encode()
    body = pre + filebytes + (f"\r\n--{boundary}--\r\n").encode()
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return r.status


for it in ITEMS:
    files = sorted(BASE.glob(it["prefix"] + "*.png"))
    print(f"\n{it['prefix']} -> {it['gid'].rsplit('/',1)[-1]}  ({len(files)} images)")
    # stage all
    inputs = [{"resource": "IMAGE", "filename": f.name, "mimeType": "image/png",
               "httpMethod": "POST", "fileSize": str(f.stat().st_size)} for f in files]
    st = gql(STAGE, {"input": inputs})
    if st["data"]["stagedUploadsCreate"]["userErrors"]:
        print("  stage ERR:", st["data"]["stagedUploadsCreate"]["userErrors"]); continue
    targets = st["data"]["stagedUploadsCreate"]["stagedTargets"]
    media = []
    for f, tgt in zip(files, targets):
        code = multipart_post(tgt["url"], tgt["parameters"], f.read_bytes(), f.name)
        print(f"  {f.name} ({f.stat().st_size} b) -> HTTP {code}")
        media.append({"originalSource": tgt["resourceUrl"], "mediaContentType": "IMAGE", "alt": it["alt"]})
    cm = gql(CREATE_MEDIA, {"pid": it["gid"], "media": media})
    d = cm["data"]["productCreateMedia"]
    if d["mediaUserErrors"] or d["userErrors"]:
        print("  media ERR:", d["mediaUserErrors"], d["userErrors"]); continue
    print(f"  attached {len(d['media'])} media: " + ", ".join(m["status"] for m in d["media"]))
