"""Replace composed media with the user's manually-cropped squares from the /square folder.
Per scent: upload the 4 user squares -> delete current idx1-4 media (hero idx0 kept).
Pass scents as args, e.g. --scents rose,pear
"""
import json, sys, urllib.request, os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
URL = "https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json"
HDRS = {"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN}
SQDIR = Path(r"G:\Drives compartilhados\GEB_Marketing\MARKETING COMPARTILHADO\IMAGENS\Produtos\Novos Body & Hair Mists\square")
CUR = json.loads((Path(__file__).resolve().parent / "_mist_media_cur.json").read_text(encoding="utf-8"))

scents_arg = "rose,pear"
if "--scents" in sys.argv:
    scents_arg = sys.argv[sys.argv.index("--scents") + 1]
SCENTS = scents_arg.split(",")

PREFIX = {"rose": "sq_rose-ritual_", "pear": "sq_pear-fresh_", "santal": "sq_santal-skin_"}
ALT = {"rose": "Rose Ritual Body & Hair Mist GE Beauty, bruma perfumada de rosas para cabelo e corpo",
       "pear": "Pear Fresh Body & Hair Mist GE Beauty, bruma perfumada de pera para cabelo e corpo",
       "santal": "Santal Skin Body & Hair Mist GE Beauty, bruma amadeirada para cabelo e corpo"}
GID = {"rose": "gid://shopify/Product/10163564183872",
       "pear": "gid://shopify/Product/10163564216640",
       "santal": "gid://shopify/Product/10163564249408"}


def gql(q, v=None):
    b = json.dumps({"query": q, "variables": v or {}}).encode()
    return json.loads(urllib.request.urlopen(urllib.request.Request(URL, data=b, headers=HDRS), timeout=120).read())


STAGE = """mutation($i:[StagedUploadInput!]!){ stagedUploadsCreate(input:$i){ stagedTargets{ url resourceUrl parameters{ name value } } userErrors{ field message } } }"""
CREATE = """mutation($pid:ID!,$m:[CreateMediaInput!]!){ productCreateMedia(productId:$pid,media:$m){ media{ ... on MediaImage{ status image{width height} } } mediaUserErrors{ field message } userErrors{ field message } } }"""
DELETE = """mutation($pid:ID!,$ids:[ID!]!){ productDeleteMedia(productId:$pid, mediaIds:$ids){ deletedMediaIds mediaUserErrors{ field message } userErrors{ field message } } }"""


def mp_post(url, params, fb, fn):
    bnd = "----gebUserSq77"
    pre = b""
    for p in params:
        pre += (f"--{bnd}\r\nContent-Disposition: form-data; name=\"{p['name']}\"\r\n\r\n{p['value']}\r\n").encode()
    pre += (f"--{bnd}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{fn}\"\r\nContent-Type: image/png\r\n\r\n").encode()
    body = pre + fb + (f"\r\n--{bnd}--\r\n").encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": f"multipart/form-data; boundary={bnd}"})
    return urllib.request.urlopen(req, timeout=300).status


for scent in SCENTS:
    files = sorted(SQDIR.glob(PREFIX[scent] + "*.png"))
    print(f"\n{scent}: {len(files)} user squares -> {[f.name for f in files]}")
    inputs = [{"resource": "IMAGE", "filename": f.name, "mimeType": "image/png", "httpMethod": "POST", "fileSize": str(f.stat().st_size)} for f in files]
    st = gql(STAGE, {"i": inputs})
    targets = st["data"]["stagedUploadsCreate"]["stagedTargets"]
    media = []
    for f, tgt in zip(files, targets):
        code = mp_post(tgt["url"], tgt["parameters"], f.read_bytes(), f.name)
        media.append({"originalSource": tgt["resourceUrl"], "mediaContentType": "IMAGE", "alt": ALT[scent]})
        print(f"  {f.name} -> HTTP {code}")
    cm = gql(CREATE, {"pid": GID[scent], "m": media})
    d = cm["data"]["productCreateMedia"]
    if d["mediaUserErrors"] or d["userErrors"]:
        print("  CREATE ERR:", d["mediaUserErrors"], d["userErrors"]); continue
    print("  added:", ", ".join(f"{m['status']}({m['image']['width']}x{m['image']['height']})" if m.get('image') else m['status'] for m in d["media"]))
    old_ids = [CUR[scent][i]["mediaId"] for i in (1, 2, 3, 4)]
    dl = gql(DELETE, {"pid": GID[scent], "ids": old_ids})
    dd = dl["data"]["productDeleteMedia"]
    print(f"  deleted {len(dd['deletedMediaIds'])} previous squares; errors={dd['mediaUserErrors']} {dd['userErrors']}")
