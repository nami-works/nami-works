"""Build the redesign PDP ingredient carousel: create reusable ingredient-card
metaobjects (ingredientes_com_descri_o: nome + descri_o; imagem deferred) and link
each product's custom.ingredientes_com_foto to its list. Mists excluded per Lucas.

Idempotent: metaobjectUpsert keyed on handle. No args = DRY RUN; 'apply' = write.
"""
import json
import sys
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
ENV = HERE.parent / ".env"
APPLY = len(sys.argv) > 1 and sys.argv[1] == "apply"
MISTS = set()  # mists kept (óleo de mamona + AcquaBio) per Lucas 2026-07-02
MO_TYPE = "ingredientes_com_descri_o"


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


UPSERT = """
mutation($handle: MetaobjectHandleInput!, $mo: MetaobjectUpsertInput!) {
  metaobjectUpsert(handle: $handle, metaobject: $mo) {
    metaobject { id handle }
    userErrors { field message code }
  }
}
"""
SET = ("mutation($mf:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$mf){ "
       "metafields{ ownerType } userErrors{ field message } } }")


def resolve_product_ids():
    dump = json.loads((HERE / "_catalog_shopify_dump.out.json").read_text(encoding="utf-8"))
    ids = {}
    for n in dump:
        if (n.get("productType") or "").lower() != "product" or n["status"] != "ACTIVE":
            continue
        t = n["title"].lower()
        if t.startswith("[") or "assinatura" in t:
            continue
        sku = ((n["variants"]["nodes"] or [{}])[0].get("sku") or "").strip()
        if sku and sku not in ids:
            ids[sku] = n["id"]
    return ids


def main():
    matrix = json.loads((HERE.parent / "catalog-ingredient-cards-matrix.json").read_text(encoding="utf-8"))
    ing = matrix["ingredients"]
    prods = {sku: keys for sku, keys in matrix["products"].items() if sku not in MISTS}
    needed = sorted({k for keys in prods.values() for k in keys})
    pids = resolve_product_ids()

    missing_pid = [s for s in prods if s not in pids]
    print(f"{'DRY RUN' if not APPLY else 'APPLY'} — {len(needed)} unique cards, {len(prods)} products")
    print("cards:", ", ".join(needed))
    if missing_pid:
        print("!! unresolved product ids:", missing_pid)
    for sku, keys in prods.items():
        print(f"  {sku:9} -> {len(keys)}: {', '.join(keys)}")

    if not APPLY:
        print("\n(dry run — rerun with 'apply')")
        return

    # 1) upsert cards
    card_gid = {}
    for key in needed:
        v = ing[key]
        handle = {"type": MO_TYPE, "handle": key}
        mo = {"fields": [
            {"key": "nome_do_ingrediente", "value": v["nome"]},
            {"key": "descri_o", "value": v["descri"]},
        ]}
        d = gql(UPSERT, {"handle": handle, "mo": mo})
        res = d.get("data", {}).get("metaobjectUpsert", {})
        errs = res.get("userErrors") or d.get("errors")
        if errs:
            print("CARD ERROR", key, json.dumps(errs, ensure_ascii=False)); return
        card_gid[key] = res["metaobject"]["id"]
    print(f"upserted {len(card_gid)} cards")

    # 2) link products
    mf = []
    for sku, keys in prods.items():
        value = json.dumps([card_gid[k] for k in keys])
        mf.append({"ownerId": pids[sku], "namespace": "custom", "key": "ingredientes_com_foto",
                   "type": "list.metaobject_reference", "value": value})
    for i in range(0, len(mf), 25):
        d = gql(SET, {"mf": mf[i:i+25]})
        res = d.get("data", {}).get("metafieldsSet", {})
        if res.get("userErrors") or "errors" in d:
            print("LINK ERROR", json.dumps(d, ensure_ascii=False)[:400]); return
    print(f"linked custom.ingredientes_com_foto on {len(mf)} products")


if __name__ == "__main__":
    main()
