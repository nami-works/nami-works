"""Cross-link the 5 Body & Hair Mist products: each one's Search&Discovery
related_products = the OTHER 4 mists, and related_products_display = 'only manual'
(show only these, not ahead of algorithmic recs). Run from c:\\claude\\gebeauty.
  (no args) = DRY RUN ; 'apply' = write."""
import json, sys, urllib.request
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
APPLY = "apply" in sys.argv[1:]
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
NS = "shopify--discovery--product_recommendation"
MISTS = {  # sku -> gid
    "GEB 024": "gid://shopify/Product/9946377617728",
    "GEB 029": "gid://shopify/Product/10039126032704",
    "GEB 031": "gid://shopify/Product/10163564249408",
    "GEB 032": "gid://shopify/Product/10163564183872",
    "GEB 033": "gid://shopify/Product/10163564216640",
}
SET = "mutation($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){userErrors{field message}}}"
skus = list(MISTS)
for sku in skus:
    pid = MISTS[sku]
    others = [MISTS[s] for s in skus if s != sku]
    print(f"{sku}: related -> {[s for s in skus if s != sku]}  | display -> 'only manual'")
    if APPLY:
        mf = [
            {"ownerId": pid, "namespace": NS, "key": "related_products",
             "type": "list.product_reference", "value": json.dumps(others)},
            {"ownerId": pid, "namespace": NS, "key": "related_products_display",
             "type": "single_line_text_field", "value": "only manual"},
        ]
        r = gql(SET, {"m": mf})
        errs = r.get("data", {}).get("metafieldsSet", {}).get("userErrors") or r.get("errors")
        print("   ", "OK" if not errs else errs)
print("\n" + ("APPLIED." if APPLY else "DRY RUN — rerun with 'apply'."))
