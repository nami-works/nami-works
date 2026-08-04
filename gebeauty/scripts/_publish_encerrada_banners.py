"""
Publish the Canva-native 'campanha encerrada' hero pair to the LP:
- download the two Canva PNG exports (page1 mobile 4:5, page2 desktop 1.91:1)
- pad desktop 1.91:1 -> 3:1 (2016x672) with whitespace on the right (product/text untouched)
- upload both to Shopify Files (staged upload) with traceable names
- repoint page metafields banner_desktop / banner_mobile
Self-contained (Shopify Admin API + PIL); no MCP dependency.
"""
import json, time, urllib.request
from pathlib import Path
from PIL import Image
try:
    import requests
except ImportError:
    requests = None

SD = Path(r"C:/Users/LUCASG~1/AppData/Local/Temp/claude/c--claude/630c36fd-0cfc-45b1-9b35-be664f12d11d/scratchpad")
PAGE = "gid://shopify/Page/164513415488"
MOBILE_URL = "https://export-download.canva.com/060tk/DAHQQI060tk/-1/0/0001-1116277317817267232.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAQYCGKMUH5AO7UJ26%2F20260724%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260724T104706Z&X-Amz-Expires=18340&X-Amz-Signature=eaeb290a268790bf8acf0ba091b27cb38afb071a0c11f99de983658fd3411f6d&X-Amz-SignedHeaders=host%3Bx-amz-expected-bucket-owner&response-expires=Fri%2C%2024%20Jul%202026%2015%3A52%3A46%20GMT"
DESKTOP_URL = "https://export-download.canva.com/060tk/DAHQQI060tk/-1/0/0002-1116277317817267232.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAQYCGKMUH5AO7UJ26%2F20260724%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260724T141621Z&X-Amz-Expires=5618&X-Amz-Signature=99fc63d9611394291d87a94c4c455f0551069ad68cfc7a4f81922ffb3b13637d&X-Amz-SignedHeaders=host%3Bx-amz-expected-bucket-owner&response-expires=Fri%2C%2024%20Jul%202026%2015%3A49%3A59%20GMT"

def load_env():
    env = {}
    for line in (Path(__file__).resolve().parents[1] / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1); env[k.strip()] = v.strip()
    return env

ENV = load_env()
SHOP, TOKEN = ENV["SHOPIFY_SHOP_DOMAIN"], ENV["SHOPIFY_ADMIN_ACCESS_TOKEN"]
VER = ENV.get("SHOPIFY_API_VERSION", "2026-01")
GQL = f"https://{SHOP}/admin/api/{VER}/graphql.json"

def gql(q, v=None):
    body = json.dumps({"query": q, "variables": v or {}}).encode()
    req = urllib.request.Request(GQL, data=body, headers={"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    out = json.loads(urllib.request.urlopen(req).read().decode())
    if out.get("errors"): print("GQL errors:", json.dumps(out["errors"])[:600])
    return out

# 1) download exports
urllib.request.urlretrieve(MOBILE_URL, SD / "exp_mobile.png")
urllib.request.urlretrieve(DESKTOP_URL, SD / "exp_desktop.png")
print("downloaded exports")

# 2) desktop 1.91:1 -> 3:1 (2016x672), whitespace right, product/text untouched
d = Image.open(SD / "exp_desktop.png").convert("RGB")
scale = 672 / d.height
d2 = d.resize((round(d.width * scale), 672))
bg = d2.getpixel((d2.width - 6, d2.height - 6))  # clean light bg from bottom-right
canvas = Image.new("RGB", (2016, 672), bg)
canvas.paste(d2, (0, 0))
final_desktop = SD / "final_encerrada_desktop.png"
canvas.save(final_desktop)
final_mobile = SD / "final_encerrada_mobile.png"
Image.open(SD / "exp_mobile.png").convert("RGB").save(final_mobile)
print(f"processed desktop {d2.width}x672 padded to 2016x672; mobile ready")

# 3) upload to Shopify Files
STAGE = """mutation s($i:[StagedUploadInput!]!){stagedUploadsCreate(input:$i){stagedTargets{url resourceUrl parameters{name value}} userErrors{message}}}"""
FC = """mutation fc($f:[FileCreateInput!]!){fileCreate(files:$f){files{id fileStatus} userErrors{message}}}"""

def upload(path, name):
    st = gql(STAGE, {"i": [{"filename": name, "mimeType": "image/png", "resource": "FILE", "httpMethod": "POST"}]})
    t = st["data"]["stagedUploadsCreate"]["stagedTargets"][0]
    form = {p["name"]: p["value"] for p in t["parameters"]}
    with path.open("rb") as fh:
        r = requests.post(t["url"], data=form, files={"file": (name, fh, "image/png")})
    assert r.status_code in (200, 201, 204), f"POST {r.status_code}: {r.text[:200]}"
    fc = gql(FC, {"f": [{"originalSource": t["resourceUrl"], "contentType": "IMAGE", "filename": name}]})
    return fc["data"]["fileCreate"]["files"][0]["id"]

desktop_id = upload(final_desktop, "travel-size-cortesia_encerrada_desktop_canva.png")
mobile_id = upload(final_mobile, "travel-size-cortesia_encerrada_mobile_canva.png")
print("uploaded:", desktop_id, mobile_id)
time.sleep(4)  # let files register

# 4) repoint metafields
MS = """mutation m($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){metafields{key value} userErrors{message}}}"""
res = gql(MS, {"m": [
    {"ownerId": PAGE, "namespace": "custom", "key": "banner_desktop", "type": "file_reference", "value": desktop_id},
    {"ownerId": PAGE, "namespace": "custom", "key": "banner_mobile", "type": "file_reference", "value": mobile_id},
]})
print("repointed:", json.dumps(res.get("data", {}).get("metafieldsSet", {})))
