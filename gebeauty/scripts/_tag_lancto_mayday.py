"""Add the `lancto` tag to the remaining new Mayday SKUs (122/123/124/125) so the
whole new line is excluded from the 'mês do consumidor' campaign collection
(rule TAG NOT_EQUALS 'lancto') and joins 'lançamentos'. Run from c:\\claude\\gebeauty."""
import json, sys, urllib.request
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
cfg = {}
for l in Path(".env").read_text(encoding="utf-8").splitlines():
    l = l.strip()
    if l.startswith("SHOPIFY") and "=" in l:
        k, v = l.split("=", 1); cfg[k.strip()] = v.strip().strip('"').strip("'")
URL = f"https://{cfg['SHOPIFY_SHOP_DOMAIN']}/admin/api/{cfg.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
def gql(q, v):
    b = json.dumps({"query": q, "variables": v}).encode()
    r = urllib.request.Request(URL, data=b, headers={"Content-Type": "application/json", "X-Shopify-Access-Token": cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]})
    return json.loads(urllib.request.urlopen(r).read().decode())
PIDS = {
    "GEB 122": "gid://shopify/Product/10196307280192",
    "GEB 123": "gid://shopify/Product/10196307411264",
    "GEB 124": "gid://shopify/Product/10196307444032",
    "GEB 125": "gid://shopify/Product/10196307509568",
}
M = "mutation($id:ID!,$tags:[String!]!){tagsAdd(id:$id,tags:$tags){userErrors{field message}}}"
for sku, pid in PIDS.items():
    r = gql(M, {"id": pid, "tags": ["lancto"]})
    errs = r.get("data", {}).get("tagsAdd", {}).get("userErrors") or r.get("errors")
    print(f"{sku}: {'OK (lancto added)' if not errs else errs}")
