"""Set GEB 126 price to 139.00, then investigate the 'mês do consumidor'
collection: its ruleSet + how GEB 126 qualifies + collection type (manual/auto),
so we can remove it the right way. Run from c:\\claude\\gebeauty.
  (no args) = set price + investigate (read collection)
"""
import json, sys, urllib.request
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
cfg = {}
for l in Path(".env").read_text(encoding="utf-8").splitlines():
    l = l.strip()
    if l.startswith("SHOPIFY") and "=" in l:
        k, v = l.split("=", 1); cfg[k.strip()] = v.strip().strip('"').strip("'")
URL = f"https://{cfg['SHOPIFY_SHOP_DOMAIN']}/admin/api/{cfg.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
def gql(q, v=None):
    b = json.dumps({"query": q, "variables": v or {}}).encode()
    r = urllib.request.Request(URL, data=b, headers={"Content-Type": "application/json", "X-Shopify-Access-Token": cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]})
    return json.loads(urllib.request.urlopen(r).read().decode())

PID = "gid://shopify/Product/10196307476800"  # GEB 126

# 1) set price 139.00
PF = "query($id:ID!){product(id:$id){variants(first:1){nodes{id price}}}}"
vid = gql(PF, {"id": PID})["data"]["product"]["variants"]["nodes"][0]["id"]
UPD = "mutation($pid:ID!,$vars:[ProductVariantsBulkInput!]!){productVariantsBulkUpdate(productId:$pid,variants:$vars){productVariants{id price}userErrors{field message}}}"
r = gql(UPD, {"pid": PID, "vars": [{"id": vid, "price": "139.00"}]})
res = r.get("data", {}).get("productVariantsBulkUpdate", {})
print("PRICE set:", res.get("productVariants") or res.get("userErrors") or r.get("errors"))

# 2) product tags + its collections (with type + ruleSet)
PC = """
query($id:ID!){ product(id:$id){ tags
  collections(first:30){ nodes{ id title handle
    ruleSet{ appliedDisjunctively rules{ column relation condition } } } } } }
"""
p = gql(PC, {"id": PID})["data"]["product"]
print("\nproduct tags:", p["tags"])
print("collections + rules:")
for c in p["collections"]["nodes"]:
    rs = c.get("ruleSet")
    kind = "AUTOMATED" if rs else "MANUAL"
    print(f"\n  [{kind}] {c['title']}  ({c['handle']})  {c['id']}")
    if rs:
        print(f"     disjunctive={rs['appliedDisjunctively']}")
        for rule in rs["rules"]:
            print(f"     rule: {rule['column']} {rule['relation']} '{rule['condition']}'")
