"""Map coverage of the field that actually renders on the PDP:
descricao_longa metaobject -> `ingredientes` field, across core products.
For each: metaobject id, ingredientes length, whether it has a full-INCI block,
and a preview. Read-only. Output: _scan_ingredientes_field.out.json
"""
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
URL = f"https://{cfg.get('SHOPIFY_SHOP_DOMAIN','ge-beauty-cosmeticos.myshopify.com')}/admin/api/{cfg.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
TOKEN = cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]

CORE = {"GEB 001","GEB 002","GEB 003","GEB 008","GEB 019","GEB 020","GEB 021","GEB 022",
        "GEB 023","GEB 024","GEB 029","GEB 031","GEB 032","GEB 033","GEB 101","GEB 102",
        "GEB 120","GEB 121"}


def gql(query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode("utf-8"))


MO = "query($id: ID!) { metaobject(id: $id) { fields { key value } } }"


def main():
    d = json.loads((HERE / "_catalog_shopify_dump.out.json").read_text(encoding="utf-8"))
    out = []
    for n in d:
        if (n.get("productType") or "").lower() != "product" or n["status"] != "ACTIVE":
            continue
        t = n["title"].lower()
        if t.startswith("[") or "assinatura" in t:
            continue
        sku = ((n["variants"]["nodes"] or [{}])[0].get("sku") or "").strip()
        if sku not in CORE:
            continue
        ref = None
        for m in n.get("metafields", {}).get("nodes", []):
            if m["namespace"] == "custom" and m["key"] == "descricao_longa_com_abas":
                ref = m["value"]
        ing, mo_id = None, None
        if ref and "Metaobject" in ref:
            mo_id = ref
            dm = gql(MO, {"id": ref})
            mo = dm.get("data", {}).get("metaobject")
            if mo:
                for f in mo["fields"]:
                    if f["key"] == "ingredientes":
                        ing = f.get("value")
        has_inci = bool(ing and re.search(r"(lista completa|Aqua,|Water,)", ing, re.I))
        out.append({"sku": sku, "title": n["title"], "metaobject_id": mo_id,
                    "ingredientes_len": len(ing or ""), "has_full_inci": has_inci,
                    "preview": re.sub(r"\s+", " ", ing)[:110] if ing else None})
    out.sort(key=lambda r: r["sku"])
    (HERE / "_scan_ingredientes_field.out.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{'SKU':9} {'len':>5} {'INCI':4} title / preview")
    for r in out:
        print(f"{r['sku']:9} {r['ingredientes_len']:5} {'yes' if r['has_full_inci'] else 'no ':4} {r['title'][:22]:22} | {r['preview'] or '(EMPTY)'}")


if __name__ == "__main__":
    main()
