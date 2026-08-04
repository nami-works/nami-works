"""
Upload the 'campanha encerrada' banners to Shopify Files and repoint the cortesia
LP metafields banner_desktop / banner_mobile to them (unlink only; old files stay).
Page: gid://shopify/Page/164513415488 (lp-e4fa5694b3a8).
"""
import json, time, urllib.request
from pathlib import Path
try:
    import requests
except ImportError:
    requests = None

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
PAGE = "gid://shopify/Page/164513415488"

FILES = [
    ("banner_desktop", SD / "ban_encerrada_desktop_final.png", "travel-size-cortesia_encerrada_desktop.png"),
    ("banner_mobile",  SD / "ban_mobile_canva.png",            "travel-size-cortesia_encerrada_mobile.png"),
]

def gql(q, v=None):
    body = json.dumps({"query": q, "variables": v or {}}).encode()
    req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    out = json.loads(urllib.request.urlopen(req).read().decode())
    if out.get("errors"): print("GQL ERR", json.dumps(out["errors"])[:600])
    return out

STAGE = """mutation s($i:[StagedUploadInput!]!){stagedUploadsCreate(input:$i){stagedTargets{url resourceUrl parameters{name value}} userErrors{message}}}"""
FCREATE = """mutation f($f:[FileCreateInput!]!){fileCreate(files:$f){files{id fileStatus} userErrors{message}}}"""
MSET = """mutation m($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){metafields{key value} userErrors{field message}}}"""

def upload(path, fname):
    t = gql(STAGE, {"i": [{"filename": fname, "mimeType": "image/png", "resource": "FILE", "httpMethod": "POST"}]})["data"]["stagedUploadsCreate"]["stagedTargets"][0]
    form = {p["name"]: p["value"] for p in t["parameters"]}
    with path.open("rb") as fh:
        r = requests.post(t["url"], data=form, files={"file": (fname, fh, "image/png")})
    assert r.status_code in (200, 201, 204), f"staged POST {r.status_code}: {r.text[:200]}"
    fid = gql(FCREATE, {"f": [{"originalSource": t["resourceUrl"], "contentType": "IMAGE"}]})["data"]["fileCreate"]["files"][0]["id"]
    return fid

def main():
    metas = []
    for key, path, fname in FILES:
        assert path.exists(), f"missing {path}"
        fid = upload(path, fname)
        print(f"uploaded {fname} -> {fid}")
        metas.append({"ownerId": PAGE, "namespace": "custom", "key": key, "type": "file_reference", "value": fid})
    res = gql(MSET, {"m": metas})
    print("metafieldsSet:", json.dumps(res.get("data", {}).get("metafieldsSet", {})))

if __name__ == "__main__":
    main()
