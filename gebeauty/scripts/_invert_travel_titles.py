"""Invert travel-size product titles: 'travel size | <product>' -> '<product> | travel size'.
Targets product-type items whose title starts with 'travel size |' (excludes [rappi],
kits/dupla, charm bag). Run from c:\\claude\\gebeauty.  (no args)=DRY RUN ; 'apply'=rename."""
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
Q = "query($q:String!){products(first:50,query:$q){nodes{id title status productType variants(first:1){nodes{sku}}}}}"
seen = {}
for term in ["travel size", "travel-size"]:
    for n in gql(Q, {"q": f"title:*{term}*"})["data"]["products"]["nodes"]:
        seen[n["id"]] = n
UPD = "mutation($p:ProductUpdateInput!){productUpdate(product:$p){product{id title}userErrors{field message}}}"
targets = []
for n in seen.values():
    t = n["title"]
    if (n["productType"] or "").lower() == "product" and t.lower().startswith("travel size |") and " | " in t:
        prefix, rest = t.split(" | ", 1)
        targets.append((n, t, f"{rest} | {prefix}"))
targets.sort(key=lambda x: (x[0]["variants"]["nodes"] or [{}])[0].get("sku") or "")
for n, old, new in targets:
    sku = ((n["variants"]["nodes"] or [{}])[0].get("sku") or "?")
    print(f"  {sku:<9} {n['status']:<7}  '{old}'  ->  '{new}'")
    if APPLY:
        r = gql(UPD, {"p": {"id": n["id"], "title": new}})
        res = r.get("data", {}).get("productUpdate", {})
        print("     ", "OK" if not (res.get("userErrors") or r.get("errors")) else (res.get("userErrors") or r.get("errors")))
print(f"\n{len(targets)} items | " + ("APPLIED." if APPLY else "DRY RUN — rerun with 'apply'."))
