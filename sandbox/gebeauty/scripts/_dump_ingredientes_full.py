import json
import sys
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
ENV = HERE.parent / ".env"


def load_env(p):
    o = {}
    for l in p.read_text(encoding="utf-8").splitlines():
        l = l.strip()
        if l and not l.startswith("#") and "=" in l:
            k, v = l.split("=", 1)
            o[k.strip()] = v.strip().strip('"').strip("'")
    return o


cfg = load_env(ENV)
URL = f"https://{cfg['SHOPIFY_SHOP_DOMAIN']}/admin/api/{cfg.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
TOKEN = cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]
Q = "query($id: ID!) { metaobject(id: $id) { fields { key value } } }"


def gql(vid):
    body = json.dumps({"query": Q, "variables": {"id": vid}}).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode("utf-8"))


scan = {r["sku"]: r for r in json.loads((HERE / "_scan_ingredientes_field.out.json").read_text(encoding="utf-8"))}


def full(sku):
    d = gql(scan[sku]["metaobject_id"])
    mo = d.get("data", {}).get("metaobject")
    if not mo:
        return f"(error: {d.get('errors')})"
    for f in mo["fields"]:
        if f["key"] == "ingredientes":
            return f["value"]
    return "(no ingredientes field)"


for s in ["GEB 019", "GEB 024", "GEB 029", "GEB 031", "GEB 032", "GEB 033", "GEB 121"]:
    print(f"\n===== {s} =====")
    print(full(s))
