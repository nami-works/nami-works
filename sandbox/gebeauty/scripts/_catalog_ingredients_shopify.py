"""Pull the ingredient / INCI-relevant content from each core Shopify listing,
for the ingredient-quality assessment. Read-only.

Captures every field a listing could carry ingredient info in: custom.ingredients,
custom.caracteristicas, custom.beneficio_em_destaque_*, custom.descricao_longa_com_abas
(metaobject ref -> resolved separately if needed), descriptionHtml.

Output: _catalog_ingredients_shopify.out.json
"""
import json
import urllib.request
from pathlib import Path

ENV = Path(__file__).resolve().parent.parent / ".env"


def load_env(path):
    out = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


cfg = load_env(ENV)
DOMAIN = cfg.get("SHOPIFY_SHOP_DOMAIN", "ge-beauty-cosmeticos.myshopify.com")
TOKEN = cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]
VERSION = cfg.get("SHOPIFY_API_VERSION", "2026-01")
URL = f"https://{DOMAIN}/admin/api/{VERSION}/graphql.json"

QUERY = """
query($cursor: String) {
  products(first: 50, after: $cursor, sortKey: ID, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    nodes {
      title handle productType
      descriptionHtml
      variants(first:1){ nodes { sku barcode } }
      metafields(first: 50) { nodes { namespace key type value } }
    }
  }
}
"""

INGREDIENT_KEYS = {
    ("custom", "ingredients"), ("custom", "ingredientes"), ("custom", "inci"),
    ("custom", "composicao"), ("custom", "caracteristicas"),
    ("custom", "descricao_longa_com_abas"), ("custom", "descricao_completa_em_markdown"),
}


def graphql(q, v=None):
    body = json.dumps({"query": q, "variables": v or {}}).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    rows, cursor = [], None
    while True:
        d = graphql(QUERY, {"cursor": cursor})
        conn = d["data"]["products"]
        for n in conn["nodes"]:
            if (n.get("productType") or "").lower() != "product":
                continue
            v = (n["variants"]["nodes"] or [{}])[0]
            mfs = {f"{m['namespace']}.{m['key']}": m["value"] for m in n["metafields"]["nodes"]}
            ing = {k: val for (ns, key), _ in [(k, 1) for k in INGREDIENT_KEYS]
                   for k, val in [(f"{ns}.{key}", mfs.get(f"{ns}.{key}"))] if val}
            rows.append({
                "sku": (v.get("sku") or "").strip(), "title": n["title"],
                "handle": n["handle"], "barcode": v.get("barcode"),
                "descriptionHtml": n.get("descriptionHtml"),
                "ingredient_metafields": ing,
                "all_metafield_keys": sorted(mfs.keys()),
            })
        if not conn["pageInfo"]["hasNextPage"]:
            break
        cursor = conn["pageInfo"]["endCursor"]
    rows.sort(key=lambda r: r["sku"])
    out = Path(__file__).resolve().parent / "_catalog_ingredients_shopify.out.json"
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(rows)} core product listings -> {out.name}")
    for r in rows:
        has = list(r["ingredient_metafields"].keys())
        print(f"  {r['sku']:9} {r['title'][:34]:34} ingredient-fields: {has if has else 'NONE'}")


if __name__ == "__main__":
    main()
