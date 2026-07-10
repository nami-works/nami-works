"""Gap map: canonical snapshot (products.json) vs LIVE Shopify.

Shopify is the canonical source for identity / commercial / content fields
(title, EAN, price, status, productType, NCM via fullcomm.ncm, tagline via
custom.finalidade, descriptions). It is NOT the system of record for CEST,
dimensions, units_per_carton, shelf_life, or precise net/gross weight — those
come from Omie (fiscal) / Unilog (logistics), so products.json stays the
aggregator for them and this map does not flag Shopify for "missing" them.

Reads _catalog_shopify_dump.out.json (run _catalog_shopify_dump.py first) and
products.json. Emits _catalog_gap_map.out.json + a human gap map on stdout.
Read-only.
"""
import json
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def norm_ean(v):
    if not v:
        return None
    return str(v).strip().lstrip("0") or "0"


def norm_sku(v):
    if not v:
        return None
    return str(v).replace(" ", "").upper().strip()


def norm_ncm(v):
    if not v:
        return None
    return str(v).replace(".", "").replace(" ", "").strip()


def mf(node, ns, key):
    for m in node.get("metafields", {}).get("nodes", []):
        if m["namespace"] == ns and m["key"] == key:
            return m["value"]
    return None


def wt_grams(variant):
    w = (variant.get("inventoryItem") or {}).get("measurement", {}).get("weight")
    if not w:
        return None
    val, unit = w.get("value"), w.get("unit")
    if val is None:
        return None
    return val * 1000 if unit == "KILOGRAMS" else val


def main():
    shop = json.loads((HERE / "_catalog_shopify_dump.out.json").read_text(encoding="utf-8"))
    canon = json.loads((ROOT / "products.json").read_text(encoding="utf-8"))

    # --- index Shopify retail (product/acessorio) variants, keyed by EAN + SKU ---
    retail = []          # flattened variant rows for product/acessorio
    by_ean = defaultdict(list)
    by_sku = defaultdict(list)
    ean_collisions_active = defaultdict(list)  # all types, active only
    draft_or_nonretail = []

    for n in shop:
        ptype = (n.get("productType") or "").lower()
        for v in n["variants"]["nodes"]:
            row = {
                "title": n["title"], "status": n["status"], "productType": n.get("productType"),
                "sku": v.get("sku"), "barcode": v.get("barcode"), "price": v.get("price"),
                "compareAtPrice": v.get("compareAtPrice"), "wt_g": wt_grams(v),
                "ncm": mf(n, "fullcomm", "ncm"),
                "finalidade": mf(n, "custom", "finalidade"),
                "deschtml": bool((n.get("descriptionHtml") or "").strip()),
                "descricao_longa": mf(n, "custom", "descricao_longa_com_abas"),
            }
            if v.get("barcode") and n["status"] == "ACTIVE":
                ean_collisions_active[v["barcode"].strip()].append(row)
            if ptype in ("product", "acessorio") and n["status"] == "ACTIVE":
                retail.append(row)
                if row["barcode"]:
                    by_ean[norm_ean(row["barcode"])].append(row)
                if row["sku"]:
                    by_sku[norm_sku(row["sku"])].append(row)
            else:
                draft_or_nonretail.append(row)

    # --- join canonical -> Shopify retail ---
    canonical_only, matched = [], []
    matched_shop_keys = set()

    for c in canon:
        ce, cs = norm_ean(c.get("ean")), norm_sku(c.get("sku"))
        m = None
        if ce and by_ean.get(ce):
            m = by_ean[ce][0]; matched_shop_keys.add(id(m))
        elif cs and by_sku.get(cs):
            m = by_sku[cs][0]; matched_shop_keys.add(id(m))
        if m is None:
            canonical_only.append(c)
            continue
        diffs = []
        # EAN raw formatting
        if c.get("ean") and m.get("barcode") and str(c["ean"]).strip() != str(m["barcode"]).strip():
            if norm_ean(c["ean"]) == norm_ean(m["barcode"]):
                diffs.append(f"EAN leading-zero: canon={c['ean']} shopify={m['barcode']}")
            else:
                diffs.append(f"EAN MISMATCH: canon={c['ean']} shopify={m['barcode']}")
        if not c.get("ean"):
            diffs.append("canon EAN null (shopify has "+str(m.get('barcode'))+")")
        # NCM
        if c.get("ncm") and m.get("ncm") and norm_ncm(c["ncm"]) != norm_ncm(m["ncm"]):
            diffs.append(f"NCM: canon={c['ncm']} shopify={m['ncm']}")
        if c.get("ncm") and not m.get("ncm"):
            diffs.append(f"NCM missing on Shopify (canon {c['ncm']})")
        # price presence
        if not m.get("price") or float(m["price"]) == 0:
            diffs.append("Shopify price empty/zero")
        # content
        if not m.get("finalidade"):
            diffs.append("no custom.finalidade (canonical tagline)")
        matched.append({"sku": c["sku"], "shopify_title": m["title"], "price": m["price"],
                        "diffs": diffs})

    shopify_only = [r for r in retail if id(r) not in matched_shop_keys]

    # collisions
    collisions = {k: v for k, v in ean_collisions_active.items() if len(v) > 1}

    # Shopify retail hygiene: missing barcode / ncm / finalidade
    missing_barcode = [r for r in retail if not r.get("barcode")]
    missing_ncm = [r for r in retail if not r.get("ncm")]
    missing_fin = [r for r in retail if not r.get("finalidade")]

    out = {
        "counts": {
            "canonical_skus": len(canon), "shopify_retail_variants": len(retail),
            "matched": len(matched), "canonical_only": len(canonical_only),
            "shopify_only": len(shopify_only),
        },
        "canonical_only": canonical_only,
        "shopify_only": shopify_only,
        "matched_with_diffs": [m for m in matched if m["diffs"]],
        "active_ean_collisions": collisions,
        "shopify_missing_barcode": missing_barcode,
        "shopify_missing_ncm": [r["title"] for r in missing_ncm],
        "shopify_missing_finalidade": [r["title"] for r in missing_fin],
    }
    (HERE / "_catalog_gap_map.out.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    # ---- console report ----
    P = print
    P("="*72)
    P("CANONICAL (products.json) vs LIVE SHOPIFY — gap map")
    P("="*72)
    P(f"canonical SKUs: {len(canon)} | shopify active retail variants: {len(retail)}")
    P(f"matched: {len(matched)} | canonical-only: {len(canonical_only)} | shopify-only: {len(shopify_only)}")

    P("\n--- [A] In products.json, NO active product/acessorio on Shopify ---")
    for c in canonical_only:
        P(f"  {c['sku']:9} {c.get('name_pt','')[:50]:50} ean={c.get('ean')}")

    P("\n--- [B] Active product/acessorio on Shopify, NOT in products.json ---")
    for r in shopify_only:
        P(f"  {str(r['sku']):10} {r['title'][:45]:45} bc={r.get('barcode')} type={r['productType']}")

    P("\n--- [C] Matched SKUs with field divergences ---")
    for m in matched:
        if m["diffs"]:
            P(f"  {m['sku']:9} {m['shopify_title'][:40]:40}")
            for d in m["diffs"]:
                P(f"        - {d}")

    P("\n--- [D] Active EAN collisions on Shopify (excl. by-design rappi dupes) ---")
    for k, vs in collisions.items():
        P(f"  {k}:")
        for r in vs:
            P(f"        {r['productType']:9} {r['title'][:40]:40} sku={r['sku']}")

    P("\n--- [E] Shopify retail hygiene ---")
    P(f"  missing barcode: {[r['sku'] or r['title'] for r in missing_barcode]}")
    P(f"  missing NCM:     {out['shopify_missing_ncm']}")
    P(f"  missing finalidade: {out['shopify_missing_finalidade']}")

    P("\nJSON -> _catalog_gap_map.out.json")


if __name__ == "__main__":
    main()
