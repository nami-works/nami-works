"""Read-only: (1) list existing 'dupla' bundle products to use as a registry template,
(2) dump full registry of components GEB 001 + GEB 019 to source compliant bundle copy.
Run from c:\\claude\\gebeauty: C:/Python314/python.exe scripts/_dupla_template_harvest.py"""
import json, sys, urllib.request
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
ENV = Path(__file__).resolve().parent.parent / ".env"
cfg = {}
for l in ENV.read_text(encoding="utf-8").splitlines():
    l = l.strip()
    if l.startswith("SHOPIFY") and "=" in l:
        k, v = l.split("=", 1); cfg[k.strip()] = v.strip().strip('"').strip("'")
URL = f"https://{cfg['SHOPIFY_SHOP_DOMAIN']}/admin/api/{cfg.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
def gql(q, v=None):
    b = json.dumps({"query": q, "variables": v or {}}).encode()
    r = urllib.request.Request(URL, data=b, headers={"Content-Type": "application/json", "X-Shopify-Access-Token": cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]})
    return json.loads(urllib.request.urlopen(r).read().decode())

# 1) existing duplas
print("="*70); print("EXISTING 'dupla' PRODUCTS (registry template candidates)"); print("="*70)
LQ = """
query($q:String!){ products(first:20, query:$q){ nodes{
  id title handle status productType tags seo{title description}
  descriptionHtml
  variants(first:3){ nodes{ price compareAtPrice sku } }
  metafields(first:60){ nodes{ namespace key type value } }
}}}
"""
seen = {}
for q in ["title:dupla*", "tag:dupla"]:
    for n in gql(LQ, {"q": q})["data"]["products"]["nodes"]:
        seen[n["id"]] = n
for n in seen.values():
    v = (n["variants"]["nodes"] or [{}])[0]
    print(f"\n- {n['title']}  [{n['status']}]  handle={n['handle']}")
    print(f"    productType={n['productType']!r}  price={v.get('price')} compareAt={v.get('compareAtPrice')}")
    print(f"    tags={n['tags']}")
    print(f"    seo.title={n['seo']['title']!r}")
    print(f"    seo.desc={n['seo']['description']!r}")
    print(f"    descHtml_len={len(n.get('descriptionHtml') or '')}")
    mfk = [f"{m['namespace']}.{m['key']}" for m in n["metafields"]["nodes"]]
    print(f"    metafields={mfk}")

# 2) component full registry
print("\n"+"="*70); print("COMPONENT REGISTRY (source of compliant claims)"); print("="*70)
CQ = """
query($q:String!){ products(first:1, query:$q){ nodes{
  id title handle productType tags seo{title description}
  descriptionHtml
  metafields(first:80){ nodes{ namespace key type value } }
}}}
"""
for sku in ["GEB 001", "GEB 019"]:
    nodes = gql(CQ, {"q": f"sku:'{sku}'"})["data"]["products"]["nodes"]
    if not nodes:
        print(f"\n### {sku}: NOT FOUND"); continue
    n = nodes[0]
    print(f"\n### {sku} — {n['title']}  (type={n['productType']!r})")
    print(f"    tags={n['tags']}")
    print(f"    seo.title={n['seo']['title']!r}")
    print(f"    seo.desc={n['seo']['description']!r}")
    print(f"    descriptionHtml:\n{n.get('descriptionHtml') or '(empty)'}\n")
    print("    metafields:")
    for m in n["metafields"]["nodes"]:
        val = m["value"] or ""
        short = val if len(val) <= 240 else val[:237] + "..."
        print(f"      {m['namespace']}.{m['key']} [{m['type']}] = {short}")
