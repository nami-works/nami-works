"""Apply the full INCI to custom.ingredients on all core products.

INCI source = each product's own descricao_longa metaobject `ingredientes` field:
 - if it contains a 'Lista completa de ingredientes:' header, take the list after it
 - else, if the field IS a raw INCI list (starts with Aqua/Water/Alcohol), use it whole
Writes the extracted full INCI to custom.ingredients (single_line_text_field).

Run with no args = DRY RUN (prints what would be written). Run with 'apply' = write.
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
ENV = HERE.parent / ".env"
APPLY = len(sys.argv) > 1 and sys.argv[1] == "apply"


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


def gql(query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode("utf-8"))


MO = "query($id: ID!) { metaobject(id: $id) { fields { key value } } }"
SET = ("mutation($mf:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$mf){ "
       "metafields{ ownerType } userErrors{ field message } } }")

HEADER = re.compile(r"lista completa de ingredientes\s*:?\s*", re.I)
INCI_START = re.compile(r"^\s*(Aqua|Water|Alcohol)\b", re.I)


def extract_inci(ingredientes):
    if not ingredientes:
        return None
    m = HEADER.search(ingredientes)
    if m:
        tail = ingredientes[m.end():].strip()
        return re.sub(r"\s+", " ", tail).strip() or None
    if INCI_START.match(ingredientes):  # field is a bare INCI list (mists/Mayday)
        return re.sub(r"\s+", " ", ingredientes).strip()
    return None


def main():
    dump = json.loads((HERE / "_catalog_shopify_dump.out.json").read_text(encoding="utf-8"))
    rows, skipped = [], []
    for n in dump:
        if (n.get("productType") or "").lower() != "product" or n["status"] != "ACTIVE":
            continue
        t = n["title"].lower()
        if t.startswith("[") or "assinatura" in t:
            continue
        sku = ((n["variants"]["nodes"] or [{}])[0].get("sku") or "").strip()
        ref = next((m["value"] for m in n.get("metafields", {}).get("nodes", [])
                    if m["namespace"] == "custom" and m["key"] == "descricao_longa_com_abas"), None)
        if not ref or "Metaobject" not in ref:
            skipped.append((sku, n["title"], "no descricao_longa")); continue
        mo = gql(MO, {"id": ref}).get("data", {}).get("metaobject")
        ing = None
        if mo:
            ing = next((f["value"] for f in mo["fields"] if f["key"] == "ingredientes"), None)
        inci = extract_inci(ing)
        if not inci:
            skipped.append((sku, n["title"], "no extractable INCI")); continue
        rows.append({"id": n["id"], "sku": sku, "title": n["title"], "inci": inci})

    print(f"{'DRY RUN' if not APPLY else 'APPLYING'} — {len(rows)} products with INCI, {len(skipped)} skipped\n")
    for r in rows:
        print(f"  {r['sku']:9} {r['title'][:26]:26} | {r['inci'][:80]}")
    if skipped:
        print("\nSKIPPED:")
        for s in skipped:
            print(f"  {s[0]:9} {s[1][:26]:26} | {s[2]}")

    if not APPLY:
        print("\n(dry run — rerun with 'apply' to write)")
        return

    mf = [{"ownerId": r["id"], "namespace": "custom", "key": "ingredients",
           "type": "single_line_text_field", "value": r["inci"]} for r in rows]
    # batch in chunks of 25
    wrote = 0
    for i in range(0, len(mf), 25):
        d = gql(SET, {"mf": mf[i:i+25]})
        res = d.get("data", {}).get("metafieldsSet", {})
        if res.get("userErrors") or "errors" in d:
            print("ERROR:", json.dumps(d, ensure_ascii=False)[:400]); return
        wrote += len(res.get("metafields", []))
    print(f"\nwrote custom.ingredients (full INCI) on {wrote} products")


if __name__ == "__main__":
    main()
