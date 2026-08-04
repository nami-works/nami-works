"""Download the Canva-exported campanha-encerrada mobile banner, upload to Shopify
Files (traceable name), and repoint the LP banner_mobile metafield to it."""
import json, urllib.request
from pathlib import Path
import requests

CANVA_URL = "https://export-download.canva.com/7-vds/DAHQPa7-vds/-1/0/0001-46672334520309827.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAQYCGKMUH5AO7UJ26%2F20260723%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260723T050012Z&X-Amz-Expires=64477&X-Amz-Signature=737e9dff8c20932627e597e07960450503f8fd92c137f0d2228b148e68d8a047&X-Amz-SignedHeaders=host%3Bx-amz-expected-bucket-owner&response-expires=Thu%2C%2023%20Jul%202026%2022%3A54%3A49%20GMT"
FNAME = "travel-size-cortesia_encerrada_mobile.png"
PAGE = "gid://shopify/Page/164513415488"

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
URL = f"https://{SHOP}/admin/api/{VER}/graphql.json"
SD = Path(r"C:/Users/LUCASG~1/AppData/Local/Temp/claude/c--claude/630c36fd-0cfc-45b1-9b35-be664f12d11d/scratchpad")

def gql(q, v=None):
    body = json.dumps({"query": q, "variables": v or {}}).encode()
    req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    out = json.loads(urllib.request.urlopen(req).read().decode())
    if out.get("errors"): print("GQL ERR", json.dumps(out["errors"])[:600])
    return out

# 1) download the Canva export
local = SD / FNAME
local.write_bytes(requests.get(CANVA_URL).content)
print("downloaded", local, local.stat().st_size, "bytes")

# 2) staged upload to Shopify Files
STAGE = """mutation s($i:[StagedUploadInput!]!){stagedUploadsCreate(input:$i){stagedTargets{url resourceUrl parameters{name value}}}}"""
FCREATE = """mutation f($f:[FileCreateInput!]!){fileCreate(files:$f){files{id} userErrors{message}}}"""
MSET = """mutation m($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){metafields{key value} userErrors{field message}}}"""

t = gql(STAGE, {"i": [{"filename": FNAME, "mimeType": "image/png", "resource": "FILE", "httpMethod": "POST"}]})["data"]["stagedUploadsCreate"]["stagedTargets"][0]
form = {p["name"]: p["value"] for p in t["parameters"]}
with local.open("rb") as fh:
    r = requests.post(t["url"], data=form, files={"file": (FNAME, fh, "image/png")})
assert r.status_code in (200, 201, 204), f"{r.status_code}: {r.text[:200]}"
fid = gql(FCREATE, {"f": [{"originalSource": t["resourceUrl"], "contentType": "IMAGE"}]})["data"]["fileCreate"]["files"][0]["id"]
print("uploaded ->", fid)

# 3) repoint banner_mobile
res = gql(MSET, {"m": [{"ownerId": PAGE, "namespace": "custom", "key": "banner_mobile", "type": "file_reference", "value": fid}]})
print("metafieldsSet:", json.dumps(res.get("data", {}).get("metafieldsSet", {})))
