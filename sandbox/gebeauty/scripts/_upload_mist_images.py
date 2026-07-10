"""Upload the 3 canonical mist images as featured media on the DRAFT products.
Flow: stagedUploadsCreate -> multipart POST to staged target -> productCreateMedia.
"""
import json, urllib.request, os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
URL = "https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json"
HDRS = {"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN}

ITEMS = [
 {"gid": "gid://shopify/Product/10163564183872", "file": r"C:\Users\Lucas Guimarães\Downloads\rose-ritual.png",
  "alt": "Rose Ritual Body & Hair Mist GE Beauty, bruma perfumada de rosas para cabelo e corpo"},
 {"gid": "gid://shopify/Product/10163564216640", "file": r"C:\Users\Lucas Guimarães\Downloads\pear-fresh.png",
  "alt": "Pear Fresh Body & Hair Mist GE Beauty, bruma perfumada de pera para cabelo e corpo"},
 {"gid": "gid://shopify/Product/10163564249408", "file": r"C:\Users\Lucas Guimarães\Downloads\santal-skin.png",
  "alt": "Santal Skin Body & Hair Mist GE Beauty, bruma amadeirada para cabelo e corpo"},
]


def gql(q, v=None):
    b = json.dumps({"query": q, "variables": v or {}}).encode()
    return json.loads(urllib.request.urlopen(
        urllib.request.Request(URL, data=b, headers=HDRS), timeout=120).read())


STAGE = """
mutation($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets { url resourceUrl parameters { name value } }
    userErrors { field message }
  }
}
"""
CREATE_MEDIA = """
mutation($pid: ID!, $media: [CreateMediaInput!]!) {
  productCreateMedia(productId: $pid, media: $media) {
    media { ... on MediaImage { id status } }
    mediaUserErrors { field message }
    userErrors { field message }
  }
}
"""


def multipart_post(url, params, filebytes, filename):
    boundary = "----gebMistBoundary7d3f"
    pre = b""
    for p in params:
        pre += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{p['name']}\"\r\n\r\n{p['value']}\r\n").encode()
    pre += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
            f"Content-Type: image/png\r\n\r\n").encode()
    body = pre + filebytes + (f"\r\n--{boundary}--\r\n").encode()
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.status


for it in ITEMS:
    name = Path(it["file"]).name
    data = Path(it["file"]).read_bytes()
    print(f"\n{name} ({len(data)} bytes) -> {it['gid'].rsplit('/',1)[-1]}")
    st = gql(STAGE, {"input": [{"resource": "IMAGE", "filename": name,
                                "mimeType": "image/png", "httpMethod": "POST",
                                "fileSize": str(len(data))}]})
    ue = st["data"]["stagedUploadsCreate"]["userErrors"]
    if ue:
        print("  stage ERR:", ue); continue
    tgt = st["data"]["stagedUploadsCreate"]["stagedTargets"][0]
    code = multipart_post(tgt["url"], tgt["parameters"], data, name)
    print(f"  staged upload HTTP {code}")
    cm = gql(CREATE_MEDIA, {"pid": it["gid"], "media": [
        {"originalSource": tgt["resourceUrl"], "mediaContentType": "IMAGE", "alt": it["alt"]}]})
    d = cm["data"]["productCreateMedia"]
    if d["mediaUserErrors"] or d["userErrors"]:
        print("  media ERR:", d["mediaUserErrors"], d["userErrors"]); continue
    m = d["media"][0]
    print(f"  attached media {m['id'].rsplit('/',1)[-1]} status={m['status']}")
