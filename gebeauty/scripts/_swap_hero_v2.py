"""Swap LP hero to the continuity-first pair:
 desktop = local raster (banner_encerrada_desktop.png), mobile = Canva export URL.
Upload both to Shopify Files (traceable names) and repoint banner_desktop / banner_mobile."""
import json, urllib.request
from pathlib import Path
import requests

MOBILE_URL = "https://export-download.canva.com/7-vds/DAHQPa7-vds/-1/0/0001-242578916197697922.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAQYCGKMUH5AO7UJ26%2F20260723%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260723T191216Z&X-Amz-Expires=15401&X-Amz-Signature=33197729fcd0d06f618da23b2187746155321055ea5ec575994f99d70525e0cd&X-Amz-SignedHeaders=host%3Bx-amz-expected-bucket-owner&response-expires=Thu%2C%2023%20Jul%202026%2023%3A28%3A57%20GMT"
PAGE = "gid://shopify/Page/164513415488"
SD = Path(r"C:/Users/LUCASG~1/AppData/Local/Temp/claude/c--claude/630c36fd-0cfc-45b1-9b35-be664f12d11d/scratchpad")

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

def gql(q, v=None):
    body = json.dumps({"query": q, "variables": v or {}}).encode()
    req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    out = json.loads(urllib.request.urlopen(req).read().decode())
    if out.get("errors"): print("ERR", json.dumps(out["errors"])[:500])
    return out

STAGE = """mutation s($i:[StagedUploadInput!]!){stagedUploadsCreate(input:$i){stagedTargets{url resourceUrl parameters{name value}}}}"""
FCREATE = """mutation f($f:[FileCreateInput!]!){fileCreate(files:$f){files{id} userErrors{message}}}"""
MSET = """mutation m($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){metafields{key} userErrors{field message}}}"""

def upload(path, fname):
    t = gql(STAGE, {"i": [{"filename": fname, "mimeType": "image/png", "resource": "FILE", "httpMethod": "POST"}]})["data"]["stagedUploadsCreate"]["stagedTargets"][0]
    form = {p["name"]: p["value"] for p in t["parameters"]}
    with path.open("rb") as fh:
        r = requests.post(t["url"], data=form, files={"file": (fname, fh, "image/png")})
    assert r.status_code in (200, 201, 204), f"{r.status_code}: {r.text[:200]}"
    return gql(FCREATE, {"f": [{"originalSource": t["resourceUrl"], "contentType": "IMAGE"}]})["data"]["fileCreate"]["files"][0]["id"]

# desktop (local raster)
d_local = SD / "banner_encerrada_desktop.png"
d_id = upload(d_local, "travel-size-cortesia_linhacontinua_desktop.png")
print("desktop ->", d_id)

# mobile (download Canva export first)
m_local = SD / "travel-size-cortesia_linhacontinua_mobile.png"
m_local.write_bytes(requests.get(MOBILE_URL).content)
m_id = upload(m_local, "travel-size-cortesia_linhacontinua_mobile.png")
print("mobile ->", m_id)

res = gql(MSET, {"m": [
    {"ownerId": PAGE, "namespace": "custom", "key": "banner_desktop", "type": "file_reference", "value": d_id},
    {"ownerId": PAGE, "namespace": "custom", "key": "banner_mobile", "type": "file_reference", "value": m_id},
]})
print("metafieldsSet:", json.dumps(res.get("data", {}).get("metafieldsSet", {})))
