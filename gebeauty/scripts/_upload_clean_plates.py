"""Pad the clean desktop plate 1.91:1 -> 3:1 (edge-stretch, keeps hero height) and
upload both clean plates to Shopify Files. Print MediaImage IDs. Does NOT repoint yet
(image repoint happens together with the live-text template binding)."""
import json, time, urllib.request
from pathlib import Path
from PIL import Image
import requests

SD = Path(r"C:/Users/LUCASG~1/AppData/Local/Temp/claude/c--claude/630c36fd-0cfc-45b1-9b35-be664f12d11d/scratchpad")
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

# desktop: 1.91:1 clean plate -> 3:1 (2016x672), edge-stretch right (product left, whitespace right)
d = Image.open(SD / "plate_clean_desktop.png").convert("RGB")
d2 = d.resize((round(d.width * 672 / d.height), 672))
canvas = Image.new("RGB", (2016, 672), (255, 255, 255))
canvas.paste(d2, (0, 0))
canvas.paste(d2.crop((d2.width - 2, 0, d2.width, 672)).resize((2016 - d2.width, 672)), (d2.width, 0))
desk = SD / "final_clean_desktop.png"; canvas.save(desk)
mob = SD / "plate_clean_mobile.png"
print("desktop padded to", canvas.size)

STAGE = """mutation s($i:[StagedUploadInput!]!){stagedUploadsCreate(input:$i){stagedTargets{url resourceUrl parameters{name value}} userErrors{message}}}"""
FC = """mutation fc($f:[FileCreateInput!]!){fileCreate(files:$f){files{id} userErrors{message}}}"""
def upload(path, name):
    st = gql(STAGE, {"i": [{"filename": name, "mimeType": "image/png", "resource": "FILE", "httpMethod": "POST"}]})
    t = st["data"]["stagedUploadsCreate"]["stagedTargets"][0]
    with path.open("rb") as fh:
        r = requests.post(t["url"], data={p["name"]: p["value"] for p in t["parameters"]}, files={"file": (name, fh, "image/png")})
    assert r.status_code in (200, 201, 204), r.status_code
    return gql(FC, {"f": [{"originalSource": t["resourceUrl"], "contentType": "IMAGE", "filename": name}]})["data"]["fileCreate"]["files"][0]["id"]

print("DESKTOP_CLEAN_ID=", upload(desk, "travel-size-cortesia_plate_clean_desktop.png"))
print("MOBILE_CLEAN_ID=", upload(mob, "travel-size-cortesia_plate_clean_mobile.png"))
