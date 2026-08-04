"""
One-time historical bulk pull WITH line items + discount codes, for the retention-lab historical case.
Read-only. Writes _cache/history_full.jsonl (bulk JSONL: order rows + lineItem child rows via __parentId).
"""
import json, sys, time, urllib.request
from pathlib import Path
HERE = Path(__file__).resolve().parent; TEN = HERE.parent
sys.stdout.reconfigure(encoding="utf-8")
env = {}
for line in (TEN / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1); env[k.strip()] = v.strip()
URL = f"https://{env['SHOPIFY_SHOP_DOMAIN']}/admin/api/{env.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
def gql(q):
    req = urllib.request.Request(URL, data=json.dumps({"query": q}).encode(),
        headers={"Content-Type": "application/json", "X-Shopify-Access-Token": env["SHOPIFY_ADMIN_ACCESS_TOKEN"]})
    return json.loads(urllib.request.urlopen(req).read().decode())

BULK = '''mutation { bulkOperationRunQuery(query: """
{ orders(query: "created_at:>=2023-06-01") { edges { node {
    id createdAt cancelledAt displayFinancialStatus
    customer { id }
    subtotalPriceSet { shopMoney { amount } }
    discountCodes
    lineItems { edges { node { quantity sku product { id title } } } }
} } } }
""") { bulkOperation { id status } userErrors { field message } } }'''

r = gql(BULK)
ue = r["data"]["bulkOperationRunQuery"]["userErrors"]
if ue: raise SystemExit(f"userErrors: {ue}")
print("bulk started:", r["data"]["bulkOperationRunQuery"]["bulkOperation"]); sys.stdout.flush()
while True:
    time.sleep(8)
    c = gql('{ currentBulkOperation { status objectCount url errorCode } }')["data"]["currentBulkOperation"]
    print("  ", c["status"], c.get("objectCount")); sys.stdout.flush()
    if c["status"] in ("COMPLETED", "FAILED", "CANCELED"): break
if c["status"] != "COMPLETED": raise SystemExit(f"bulk {c['status']}: {c.get('errorCode')}")
out = HERE / "_cache" / "history_full.jsonl"
if c["url"]:
    urllib.request.urlretrieve(c["url"], out)
    print("downloaded ->", out, out.stat().st_size, "bytes")
else:
    out.write_text("", encoding="utf-8"); print("empty result")
