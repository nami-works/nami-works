"""Disassociate (productDeleteMedia) the non-hero media from the 3 new mist
fragrances, keeping only the hero at pos 0. Reads the manifest from
_mist_media_audit.py. Files already backed up locally + URLs in manifest, so this
is reversible. Run from c:\\claude\\gebeauty.  (no args)=DRY RUN ; 'apply'=detach."""
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
man = json.loads(Path("mist-new-media-manifest.json").read_text(encoding="utf-8"))
DEL = """
mutation($pid:ID!,$ids:[ID!]!){
  productDeleteMedia(productId:$pid, mediaIds:$ids){
    deletedMediaIds mediaUserErrors{field message} product{ id } }
}"""
for sku, d in man.items():
    pid = d["product_id"]
    rem = [m["id"] for m in d["media"] if m["pos"] != 0]
    keep = [m for m in d["media"] if m["pos"] == 0][0]
    print(f"\n{sku}  {d['title']}")
    print(f"  KEEP hero: {keep['url'].split('?')[0].split('/')[-1]}")
    print(f"  DETACH {len(rem)}: {[m['url'].split('?')[0].split('/')[-1] for m in d['media'] if m['pos']!=0]}")
    if APPLY:
        r = gql(DEL, {"pid": pid, "ids": rem})
        res = r.get("data", {}).get("productDeleteMedia", {})
        errs = res.get("mediaUserErrors") or r.get("errors")
        print(f"   -> {'OK, deletedMediaIds=' + str(len(res.get('deletedMediaIds') or [])) if not errs else errs}")
print("\n" + ("APPLIED." if APPLY else "DRY RUN — rerun with 'apply'."))
