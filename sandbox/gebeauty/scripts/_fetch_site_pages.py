"""One-off: find institutional copy (the Camila quote) in the live store pages."""
import json, re, urllib.request
from pathlib import Path

ENV = Path(__file__).resolve().parent.parent / ".env"
cfg = {}
for line in ENV.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        cfg[k.strip()] = v.strip().strip('"').strip("'")

DOMAIN = cfg.get("SHOPIFY_SHOP_DOMAIN", "ge-beauty-cosmeticos.myshopify.com")
URL = f"https://{DOMAIN}/admin/api/{cfg.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
Q = """query($c:String){ pages(first:100, after:$c){ pageInfo{hasNextPage endCursor} nodes{ title handle body } } }"""


def gql(q, v=None):
    body = json.dumps({"query": q, "variables": v or {}}).encode()
    req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json", "X-Shopify-Access-Token": cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())


def strip(html):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html or "")).strip()


cursor = None
print("PAGES:")
while True:
    d = gql(Q, {"c": cursor})["data"]["pages"]
    for n in d["nodes"]:
        txt = strip(n["body"])
        print(f"- {n['title']}  (/{n['handle']})  [{len(txt)} chars]")
        if "camila" in txt.lower():
            i = txt.lower().find("camila")
            print("   >>> CAMILA CONTEXT:", txt[max(0, i-400):i+400])
    if not d["pageInfo"]["hasNextPage"]:
        break
    cursor = d["pageInfo"]["endCursor"]
