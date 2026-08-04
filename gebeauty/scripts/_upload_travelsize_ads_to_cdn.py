"""
Upload wave-1 travel-size ad statics to Shopify Files (CDN) so Meta's
ads_create_creative can fetch them via image_url. Prints the public CDN URLs.
Read/write on Shopify Files only (no product/theme changes). One-off for launch.
"""
import json
import time
import urllib.request
from pathlib import Path

try:
    import requests
except ImportError:
    requests = None


def load_env():
    env_path = Path(__file__).resolve().parents[1] / ".env"
    env = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


ENV = load_env()
SHOP = ENV["SHOPIFY_SHOP_DOMAIN"]
TOKEN = ENV["SHOPIFY_ADMIN_ACCESS_TOKEN"]
API_VERSION = ENV.get("SHOPIFY_API_VERSION", "2026-01")
URL = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"

BASE = Path(__file__).resolve().parents[1] / "imagery" / "travel-size-promo" / "creatives" / "matrix"
FILES = [
    BASE / "1x1_hook1_ganhe.png",
    BASE / "9x16_hook1_ganhe.png",
    BASE / "1x1_hook4_primeiro.png",
    BASE / "9x16_hook4_primeiro.png",
]


def gql(query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    with urllib.request.urlopen(req) as r:
        out = json.loads(r.read().decode("utf-8"))
    if out.get("errors"):
        print("GQL errors:", json.dumps(out["errors"])[:800])
    return out


STAGE = """
mutation stage($input:[StagedUploadInput!]!){
  stagedUploadsCreate(input:$input){
    stagedTargets{ url resourceUrl parameters{ name value } }
    userErrors{ field message }
  }
}"""

FILECREATE = """
mutation fc($files:[FileCreateInput!]!){
  fileCreate(files:$files){ files{ id fileStatus } userErrors{ field message } }
}"""

POLL = """
query poll($ids:[ID!]!){ nodes(ids:$ids){ ... on MediaImage { id fileStatus image { url } } } }"""


def upload_one(path):
    fn = path.name
    stage = gql(STAGE, {"input": [{"filename": fn, "mimeType": "image/png",
                                   "resource": "FILE", "httpMethod": "POST"}]})
    t = stage["data"]["stagedUploadsCreate"]["stagedTargets"][0]
    form = [(p["name"], p["value"]) for p in t["parameters"]]
    if requests is None:
        raise RuntimeError("requests module required for multipart upload")
    with path.open("rb") as fh:
        resp = requests.post(t["url"], data=dict(form),
                             files={"file": (fn, fh, "image/png")})
    if resp.status_code not in (200, 201, 204):
        raise RuntimeError(f"staged POST failed {resp.status_code}: {resp.text[:300]}")
    fc = gql(FILECREATE, {"files": [{"originalSource": t["resourceUrl"], "contentType": "IMAGE"}]})
    return fc["data"]["fileCreate"]["files"][0]["id"]


def main():
    ids = []
    for p in FILES:
        assert p.exists(), f"missing {p}"
        fid = upload_one(p)
        print(f"uploaded {p.name} -> {fid}")
        ids.append(fid)
    # poll for CDN urls
    urls = {}
    for _ in range(20):
        res = gql(POLL, {"ids": ids})
        for n in res["data"]["nodes"]:
            if n and n.get("image") and n["image"].get("url"):
                urls[n["id"]] = n["image"]["url"]
        if len(urls) == len(ids):
            break
        time.sleep(3)
    print("\n=== CDN URLS ===")
    for fid, path in zip(ids, FILES):
        print(f"{path.name}\t{urls.get(fid, 'PENDING')}")


if __name__ == "__main__":
    main()
