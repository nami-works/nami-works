"""Pull the CURATED hero-actives portion (before 'Lista completa de ingredientes:')
from each product's descricao_longa.ingredientes. This is GE's own already-chosen
3-5 hero ingredients + friendly descriptions — the source for the ingredient x
product matrix. Output: _extract_hero_actives.out.json"""
import json
import re
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
MO = "query($id: ID!) { metaobject(id: $id) { fields { key value } } }"
HEADER = re.compile(r"lista completa de ingredientes", re.I)


def gql(vid):
    body = json.dumps({"query": MO, "variables": {"id": vid}}).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode("utf-8"))


def main():
    scan = {r["sku"]: r for r in json.loads((HERE / "_scan_ingredientes_field.out.json").read_text(encoding="utf-8"))}
    out = {}
    for sku, r in scan.items():
        mid = r["metaobject_id"]
        d = gql(mid)
        mo = d.get("data", {}).get("metaobject")
        ing = None
        if mo:
            ing = next((f["value"] for f in mo["fields"] if f["key"] == "ingredientes"), None)
        curated = None
        if ing:
            m = HEADER.search(ing)
            curated = ing[:m.start()].strip() if m else (None if re.match(r"^\s*(Aqua|Water|Alcohol)", ing) else ing.strip())
        out[sku] = {"title": r["title"], "curated": curated}
    (HERE / "_extract_hero_actives.out.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    for sku, v in out.items():
        print(f"\n===== {sku} {v['title']} =====")
        print(v["curated"] or "(no curated hero section — raw INCI only)")


if __name__ == "__main__":
    main()
