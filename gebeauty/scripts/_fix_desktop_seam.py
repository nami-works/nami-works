"""Re-pad the desktop banner by stretching the image's own right-edge column (seamless
gradient continuation) instead of a flat fill; re-upload + repoint banner_desktop."""
import json, time, urllib.request
from pathlib import Path
from PIL import Image
import requests

SD = Path(r"C:/Users/LUCASG~1/AppData/Local/Temp/claude/c--claude/630c36fd-0cfc-45b1-9b35-be664f12d11d/scratchpad")
PAGE = "gid://shopify/Page/164513415488"

def load_env():
    env = {}
    for line in (Path(__file__).resolve().parents[1] / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1); env[k.strip()] = v.strip()
    return env
ENV = load_env(); SHOP, TOKEN = ENV["SHOPIFY_SHOP_DOMAIN"], ENV["SHOPIFY_ADMIN_ACCESS_TOKEN"]
VER = ENV.get("SHOPIFY_API_VERSION", "2026-01"); GQL = f"https://{SHOP}/admin/api/{VER}/graphql.json"
def gql(q, v=None):
    body = json.dumps({"query": q, "variables": v or {}}).encode()
    req = urllib.request.Request(GQL, data=body, headers={"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    o = json.loads(urllib.request.urlopen(req).read().decode())
    if o.get("errors"): print("GQL:", json.dumps(o["errors"])[:400])
    return o

d = Image.open(SD / "exp_desktop.png").convert("RGB")
d2 = d.resize((round(d.width * 672 / d.height), 672))
canvas = Image.new("RGB", (2016, 672), (255, 255, 255))
canvas.paste(d2, (0, 0))
edge = d2.crop((d2.width - 2, 0, d2.width, 672)).resize((2016 - d2.width, 672))  # stretch right edge column
canvas.paste(edge, (d2.width, 0))
out = SD / "final_encerrada_desktop.png"; canvas.save(out)
print("re-padded desktop (edge-stretch), size", canvas.size)

STAGE = """mutation s($i:[StagedUploadInput!]!){stagedUploadsCreate(input:$i){stagedTargets{url resourceUrl parameters{name value}} userErrors{message}}}"""
FC = """mutation fc($f:[FileCreateInput!]!){fileCreate(files:$f){files{id} userErrors{message}}}"""
st = gql(STAGE, {"i": [{"filename": "travel-size-cortesia_encerrada_desktop_canva.png", "mimeType": "image/png", "resource": "FILE", "httpMethod": "POST"}]})
t = st["data"]["stagedUploadsCreate"]["stagedTargets"][0]
with out.open("rb") as fh:
    r = requests.post(t["url"], data={p["name"]: p["value"] for p in t["parameters"]}, files={"file": ("d.png", fh, "image/png")})
assert r.status_code in (200, 201, 204), r.status_code
fid = gql(FC, {"f": [{"originalSource": t["resourceUrl"], "contentType": "IMAGE", "filename": "travel-size-cortesia_encerrada_desktop_canva.png"}]})["data"]["fileCreate"]["files"][0]["id"]
time.sleep(4)
MS = """mutation m($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){metafields{key value} userErrors{message}}}"""
print("repoint:", json.dumps(gql(MS, {"m": [{"ownerId": PAGE, "namespace": "custom", "key": "banner_desktop", "type": "file_reference", "value": fid}]})["data"]["metafieldsSet"]))
