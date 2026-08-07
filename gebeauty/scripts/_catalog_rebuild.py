"""Rebuild the canonical catalog (products.json) FROM live Shopify.

Model: Shopify is canonical for store-facing fields (title, EAN, price,
status, productType, NCM, tagline). Omie (fiscal: cest) and Unilog (logistics:
dimensions_mm, units_per_carton, shelf_life_*, net/gross weight) remain the
system of record for their fields, so those are preserved from the current
products.json rather than overwritten. Raphael/regulatory owns the inci/
free_of/vegan/anvisa_* fields the same way — nothing on Shopify sources them.

Output: canonical row = live Shopify store-fields  +  preserved Omie/Unilog/
regulatory fields  +  a `core` flag (product=core, acessorio=non-core) + provenance.

SKUs that exist in the current products.json but NOT on Shopify (B2B-only:
sachês, not-yet-created SKUs) are carried forward with on_shopify=false so the
aggregate isn't lost.

Writes a PREVIEW to _catalog_rebuild.out.json (never overwrites products.json
directly — promote manually after review). Reads _catalog_shopify_dump.out.json
(run _catalog_shopify_dump.py first). Read-only against Shopify.
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

# Fields Omie/Unilog/Raphael own — preserved from existing products.json, not from Shopify.
PRESERVE = ["cest", "dimensions_mm", "units_per_carton", "shelf_life_days",
            "shelf_life_expedicao_days", "net_weight_g", "gross_weight_g",
            "inci", "free_of", "vegan", "anvisa_process", "anvisa_expiry"]


def norm_ean_join(v):
    return str(v).strip().lstrip("0") if v else None


def norm_sku(v):
    return str(v).replace(" ", "").upper().strip() if v else None


def gtin13(v):
    """Normalize a barcode to 13-digit GTIN (pad UPC-A 12 -> EAN-13)."""
    if not v:
        return None
    s = str(v).strip()
    return s.zfill(13) if s.isdigit() and len(s) == 12 else s


def ncm_dotted(v):
    """Shopify stores 8-digit dotless; canonical style is 3305.10.00."""
    if not v:
        return None
    s = str(v).replace(".", "").strip()
    return f"{s[0:4]}.{s[4:6]}.{s[6:8]}" if len(s) == 8 and s.isdigit() else v


def mf(node, ns, key):
    for m in node.get("metafields", {}).get("nodes", []):
        if m["namespace"] == ns and m["key"] == key:
            return m["value"]
    return None


def main():
    shop = json.loads((HERE / "_catalog_shopify_dump.out.json").read_text(encoding="utf-8"))
    canon = json.loads((ROOT / "products.json").read_text(encoding="utf-8"))

    canon_by_ean = {norm_ean_join(c.get("ean")): c for c in canon if c.get("ean")}
    canon_by_sku = {norm_sku(c.get("sku")): c for c in canon if c.get("sku")}
    used_canon = set()

    rows = []
    for n in shop:
        ptype = (n.get("productType") or "").lower()
        if ptype not in ("product", "acessorio"):
            continue  # kits/rappi/brinde/gift-card/assinatura are not canonical rows
        v = (n["variants"]["nodes"] or [{}])[0]
        ean = gtin13(v.get("barcode"))
        # find the matching existing canonical row (EAN first, then SKU)
        prev = canon_by_ean.get(norm_ean_join(v.get("barcode"))) or canon_by_sku.get(norm_sku(v.get("sku")))
        if prev:
            used_canon.add(id(prev))
        row = {
            "sku": (v.get("sku") or "").strip() or (prev or {}).get("sku"),
            # keep the curated B2B name if we had one; else Shopify title
            "name_pt": (prev or {}).get("name_pt") or n["title"],
            "shopify_title": n["title"],
            "ean": ean or (prev or {}).get("ean"),
            "ncm": ncm_dotted(mf(n, "fullcomm", "ncm")) or (prev or {}).get("ncm"),
            "price": v.get("price"),
            "compare_at_price": v.get("compareAtPrice"),
            "finalidade": mf(n, "custom", "finalidade"),
            "core": ptype == "product",
            "product_type": n.get("productType"),
            "shopify_status": n["status"],
            "on_shopify": True,
        }
        for f in PRESERVE:
            row[f] = (prev or {}).get(f)
        rows.append(row)

    # carry forward canonical-only rows (B2B-only, not on Shopify)
    for c in canon:
        if id(c) in used_canon:
            continue
        row = {
            "sku": c.get("sku"), "name_pt": c.get("name_pt"), "shopify_title": None,
            "ean": c.get("ean"), "ncm": c.get("ncm"), "price": None,
            "compare_at_price": None, "finalidade": None,
            "core": True,  # B2B-only consumables; adjust per SKU if needed
            "product_type": None, "shopify_status": None, "on_shopify": False,
        }
        for f in PRESERVE:
            row[f] = c.get(f)
        rows.append(row)

    def sortkey(r):
        s = str(r.get("sku") or "")
        return (0, s) if s.upper().startswith("GEB") else (1, s)
    rows.sort(key=sortkey)

    out = HERE / "_catalog_rebuild.out.json"
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")

    core = [r for r in rows if r["core"]]
    acc = [r for r in rows if not r["core"]]
    off = [r for r in rows if not r["on_shopify"]]
    print(f"{len(rows)} canonical rows -> {out.name} (PREVIEW; promote to products.json after review)")
    print(f"  core (product): {len(core)} | non-core (acessorio): {len(acc)} | not-on-shopify: {len(off)}")
    print(f"  not-on-shopify SKUs: {[r['sku'] for r in off]}")
    print(f"  non-core SKUs: {[r['sku'] for r in acc]}")


if __name__ == "__main__":
    main()
