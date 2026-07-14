"""
Sephora Registry Mapper — GE Beauty
Reads products.json + enrichment tables, produces sephora_cadastro.csv

Sources:
  products.json             — dimensions, EAN, NCM/CEST, weights (canonical)
  GE Beauty_Cadastro B2B.xlsx (Drive) — sell-in prices, Anvisa for 5 SKUs
  Ficha Cadastro B4A (Drive)          — Anvisa process numbers for 5 SKUs

Usage:
  python sephora_mapper.py            # CSV + gap report
  python sephora_mapper.py --dry-run  # gap report only, no file written
"""

import csv, json, sys
from pathlib import Path

HERE   = Path(__file__).resolve().parent
PRODUCTS_JSON = HERE.parent / "products.json"
OUT_CSV       = HERE / "sephora_cadastro.csv"
ENRICH_JSON   = HERE / "sephora_enrich.json"   # images + grounded store descriptions

GAP = "[PENDENTE]"

# Enrichment pulled from the LIVE Shopify store (fetch_sephora_enrich.py):
#   img_by_sku/barcode  — featured image URL
#   desc_by_sku/barcode — first-sentence store description (grounded, anti-hallucination)
try:
    _ENRICH = json.loads(ENRICH_JSON.read_text(encoding="utf-8"))
except FileNotFoundError:
    _ENRICH = {"img_by_sku": {}, "img_by_barcode": {}, "desc_by_sku": {}, "desc_by_barcode": {}}


def _enrich_lookup(table_sku, table_bc, sku, ean):
    """Resolve an enrichment value by SKU, then EAN (with/without leading zeros)."""
    t_sku = _ENRICH.get(table_sku, {})
    t_bc  = _ENRICH.get(table_bc, {})
    if sku in t_sku:
        return t_sku[sku]
    ean = str(ean or "")
    return t_bc.get(ean) or t_bc.get(ean.lstrip("0")) or None

# ---------------------------------------------------------------------------
# Sell-in prices — GE Beauty_Cadastro de produtos B2B.xlsx (Drive, Aug 2025)
# Margem 35%: sell_in = sellout × 0.65
# NOTE: treat as initial reference only — Sephora terms are TBD.
# ---------------------------------------------------------------------------
B2B_PRICES = {
    "GEB 001": (61.75, 95.00),
    "GEB 002": (61.75, 95.00),
    "GEB 003": (64.35, 99.00),
    "GEB 008": (64.35, 99.00),
    "GEB 010": (26.00, 40.00),
    "GEB 011": (30.55, 47.00),
    "GEB 013": (26.00, 40.00),
    "GEB 019": (48.75, 75.00),
    "GEB 020": (44.85, 69.00),
    "GEB 021": (44.85, 69.00),
    "GEB 022": (51.35, 79.00),
    "GEB 023": (48.75, 75.00),   # coded GEB 004 in older B2B file
    "GEB 101": (96.85, 149.00),
    "GEB 102": (90.35, 139.00),
    "GEB 120": (96.85, 149.00),
}

# ---------------------------------------------------------------------------
# Anvisa process numbers — Ficha de Cadastro B4A (Drive, Jun 2025)
# Validade: 3 anos a partir da fabricação
# ---------------------------------------------------------------------------
ANVISA = {
    "GEB 003": "25351.083951/2020-17",
    "GEB 008": "25351.460673/2023-61",
    "GEB 010": "25351.083949/2020-30",
    "GEB 013": "25351.083906/2020-54",
    "GEB 022": "25351.441312/2024-04",
}

# ---------------------------------------------------------------------------
# Proposed English SAP names (max 40 chars — Sephora SAP system)
# Review with buyer before submitting.
# ---------------------------------------------------------------------------
SAP_NAMES_EN = {
    "GEB 001": "SULFATE-FREE SHAMPOO 250ML",
    "GEB 002": "CONDITIONING MASK 200ML",
    "GEB 003": "THERMAL PROTECTION LEAVE-IN 150ML",
    "GEB 008": "DRY SHAMPOO 150ML",
    "GEB 010": "CONDITIONING MASK 50ML",
    "GEB 011": "THERMAL PROTECTION LEAVE-IN 50ML",
    "GEB 013": "SULFATE-FREE SHAMPOO 60ML",
    "GEB 019": "STRENGTHENING BOOSTER 15ML",
    "GEB 020": "MOISTURIZING BOOSTER 15ML",
    "GEB 021": "DEFINITION BOOSTER 15ML",
    "GEB 022": "ANTI-FRIZZ BOOSTER 15ML",
    "GEB 023": "ANTIOXIDANT BOOSTER 15ML",
    "GEB 024": "MELON MOOD BODY HAIR MIST 200ML",
    # Mist line renumbered 2026-07 (was 025/026/027, same EANs)
    "GEB 031": "SANTAL SKIN BODY HAIR MIST 200ML",
    "GEB 032": "ROSE RITUAL BODY HAIR MIST 200ML",
    "GEB 033": "PEAR FRESH BODY HAIR MIST 200ML",
    "GEB 029": "MELON MOOD MINI BODY HAIR MIST",
    "GEB 101": "CURL DEFINING PRIMER 250ML",
    "GEB 102": "STRAIGHT HAIR PRIMER 150ML",
    "GEB 111": "CHARM BAG LEAVE-IN MINI 50ML",
    "GEB 120": "PLUMA LEAVE-IN 200ML",
    "GEB 121": "MAYDAY RECONSTRUCTIVE MASK 200ML",
    "GEB 122": "MAYDAY RECONSTRUCTIVE SHAMPOO",
    "GEB 123": "MAYDAY RECONSTRUCTIVE CONDITIONER",
    "GEB 124": "MAYDAY RECONSTRUCTIVE LEAVE-IN",
    "GEB 126": "MAYDAY OVERNIGHT REPAIR SERUM",
}

# ---------------------------------------------------------------------------
# Accessories (in B2B file, not in products.json)
# ---------------------------------------------------------------------------
ACCESSORIES = [
    {
        "sku": "7671",
        "name_pt": "Escova Oval GE Beauty",
        "ean": "7896025537286",
        "ncm": "9603.29.00",
        "cest": "20.057.00",
        "net_weight_g": 66,
        "gross_weight_g": 66,
        "dimensions_mm": {"l": 215, "w": 20, "h": 70},
        "sell_in": 25.35,
        "sellout": 39.00,
        "sap_en": "OVAL HAIR BRUSH",
        "category": "ACESSORIO",
    },
    {
        "sku": "7685GE",
        "name_pt": "Escova Polvo GE Beauty",
        "ean": "7896025540705",
        "ncm": "9603.29.00",
        "cest": "20.057.00",
        "net_weight_g": 78,
        "gross_weight_g": 78,
        "dimensions_mm": {"l": 45, "w": 65, "h": 240},
        "sell_in": 31.85,
        "sellout": 49.00,
        "sap_en": "OCTOPUS DETANGLING BRUSH",
        "category": "ACESSORIO",
    },
]

# ---------------------------------------------------------------------------
# Column headers matching Sephora CADASTROS NOVOS template
# ---------------------------------------------------------------------------
COLS = [
    "STATUS",
    "Tipo",
    "Categoria",
    "Canal",
    "Nro Lojas",
    "Marca",
    "Vendor",
    "Fornecedor",
    "Nome Produto (Site)",
    "Submarca",
    "Descricao do Item",
    "Nome SAP (ingles, max 40)",
    "Qtd Chars SAP",
    "Volumetria (max 5)",
    "Ref Fornecedor",
    "Profundidade MM",
    "Largura MM",
    "Altura MM",
    "Codigo ONU",
    "Ponto Inflamacao",
    "Pais Origem",
    "Codigo HS / NCM",
    "Faturado em Pack",
    "Qtd Unidades Pack",
    "EAN Pack",
    "EAN Unitario",
    "SAP Code (Sephora)",
    "Status Compra",
    "Custo S/ IPI (ref B2B)",
    "Custo C/ IPI",
    "Custo Total",
    "Markup",
    "Preco Venda Sugerido",
    "Aliq IPI %",
    "Aliq ICMS %",
    "ICMS-ST",
    "NCM",
    "NCM ok",
    "Codigo Excecao",
    "CST Item",
    "Origem Tributacao",
    "Nome Etiqueta",
    "Shade/Volumetria",
    "Status (ONE SHOT / ATIVO)",
    "Data Lancamento Retail",
    "Data Lancamento Dotcom",
    "Link Imagem",
    "Item Exclusivo",
    "Foco Ativacao",
    "Anvisa Processo",
    "Anvisa Validade Produto",
]


def brl(v):
    return f"R$ {v:.2f}".replace(".", ",")


def vol_from_name(name_pt):
    n = name_pt.lower().replace(" ml", "ml")   # catch "60 ml"
    for v in ["250ml", "200ml", "150ml", "100ml", "60ml", "50ml", "15ml"]:
        if v in n:
            return v.upper()
    return GAP


def map_row(p, category="CABELO"):
    sku     = p["sku"]
    dim     = p.get("dimensions_mm") or {}
    prices  = B2B_PRICES.get(sku)
    sell_in = prices[0] if prices else None
    sellout = prices[1] if prices else None
    anvisa  = ANVISA.get(sku, GAP)
    sap_en  = SAP_NAMES_EN.get(sku, GAP)
    vol     = vol_from_name(p.get("name_pt", ""))

    # Shampoo a Seco (GEB 008) is aerosol — ONU 1950; others 0
    is_aerosol = "seco" in p.get("name_pt", "").lower()
    onu = "1950" if is_aerosol else "0"
    # Ponto de inflamação: só se aplica a aerossol/inflamável (ONU != 0).
    # Não-inflamáveis (ONU 0) = N/A; aerossol fica pendente (FISPQ/fiscal).
    ponto_inflamacao = GAP if is_aerosol else "N/A"

    ean = p.get("ean")
    img  = _enrich_lookup("img_by_sku", "img_by_barcode", sku, ean) or GAP
    desc = (_enrich_lookup("desc_by_sku", "desc_by_barcode", sku, ean)
            or p.get("description_short_pt") or GAP)

    return {
        "STATUS":                    "NOK",
        "Tipo":                      "PRODUTO",
        "Categoria":                 category,
        "Canal":                     GAP,         # CDB1 retail / CDB3 dotcom — commercial
        "Nro Lojas":                 GAP,
        "Marca":                     "GE Beauty",
        "Vendor":                    GAP,         # Sephora assigns
        "Fornecedor":                "GE COSMETICOS LTDA",
        "Nome Produto (Site)":       p.get("name_pt", GAP),
        "Submarca":                  "",
        "Descricao do Item":         desc,
        "Nome SAP (ingles, max 40)": sap_en,
        "Qtd Chars SAP":             len(sap_en) if sap_en != GAP else GAP,
        "Volumetria (max 5)":        vol,
        "Ref Fornecedor":            sku,
        "Profundidade MM":           dim.get("l", GAP),
        "Largura MM":                dim.get("w", GAP),
        "Altura MM":                 dim.get("h", GAP),
        "Codigo ONU":                onu,
        "Ponto Inflamacao":          ponto_inflamacao,  # N/A p/ ONU 0; aerossol pendente (FISPQ)
        "Pais Origem":               "BRA",
        "Codigo HS / NCM":           p.get("ncm", GAP),
        "Faturado em Pack":          "NAO",
        "Qtd Unidades Pack":         "1",
        "EAN Pack":                  "",
        "EAN Unitario":              p.get("ean") or GAP,
        "SAP Code (Sephora)":        GAP,
        "Status Compra":             GAP,
        "Custo S/ IPI (ref B2B)":    brl(sell_in) if sell_in else GAP,
        "Custo C/ IPI":              GAP,         # needs IPI %
        "Custo Total":               GAP,
        "Markup":                    GAP,
        "Preco Venda Sugerido":      brl(sellout) if sellout else GAP,
        "Aliq IPI %":                "0",         # 0% assumed; confirm fiscal
        "Aliq ICMS %":               GAP,         # interestadual — fiscal team
        "ICMS-ST":                   "SIM",
        "NCM":                       p.get("ncm", GAP),
        "NCM ok":                    "",
        "Codigo Excecao":            "",
        "CST Item":                  "60",
        "Origem Tributacao":         "0",         # Nacional
        "Nome Etiqueta":             p.get("name_pt", GAP),
        "Shade/Volumetria":          vol,
        "Status (ONE SHOT / ATIVO)": "ATIVO",
        "Data Lancamento Retail":    GAP,
        "Data Lancamento Dotcom":    GAP,
        "Link Imagem":               img,
        "Item Exclusivo":            "NAO",
        "Foco Ativacao":             GAP,
        "Anvisa Processo":           anvisa,
        # Validade padrão GE Beauty = 3 anos (shelf_life_days 1095) para todo produto
        "Anvisa Validade Produto":   "3 anos a partir da fabricação",
    }


def map_accessory(a):
    sap = a["sap_en"]
    d   = a.get("dimensions_mm") or {}
    img  = _enrich_lookup("img_by_sku", "img_by_barcode", a["sku"], a.get("ean")) or GAP
    desc = _enrich_lookup("desc_by_sku", "desc_by_barcode", a["sku"], a.get("ean")) or GAP
    return {
        "STATUS":                    "NOK",
        "Tipo":                      "PRODUTO",
        "Categoria":                 a.get("category", "ACESSORIO"),
        "Canal":                     GAP,
        "Nro Lojas":                 GAP,
        "Marca":                     "GE Beauty",
        "Vendor":                    GAP,
        "Fornecedor":                "GE COSMETICOS LTDA",
        "Nome Produto (Site)":       a["name_pt"],
        "Submarca":                  "",
        "Descricao do Item":         desc,
        "Nome SAP (ingles, max 40)": sap,
        "Qtd Chars SAP":             len(sap),
        "Volumetria (max 5)":        GAP,
        "Ref Fornecedor":            a["sku"],
        "Profundidade MM":           d.get("l", GAP),
        "Largura MM":                d.get("w", GAP),
        "Altura MM":                 d.get("h", GAP),
        "Codigo ONU":                "0",
        "Ponto Inflamacao":          "0",
        "Pais Origem":               "BRA",
        "Codigo HS / NCM":           a.get("ncm", GAP),
        "Faturado em Pack":          "NAO",
        "Qtd Unidades Pack":         "1",
        "EAN Pack":                  "",
        "EAN Unitario":              a.get("ean") or GAP,
        "SAP Code (Sephora)":        GAP,
        "Status Compra":             GAP,
        "Custo S/ IPI (ref B2B)":    brl(a["sell_in"]),
        "Custo C/ IPI":              GAP,
        "Custo Total":               GAP,
        "Markup":                    GAP,
        "Preco Venda Sugerido":      brl(a["sellout"]),
        "Aliq IPI %":                "0",
        "Aliq ICMS %":               GAP,
        "ICMS-ST":                   "NAO",
        "NCM":                       a.get("ncm", GAP),
        "NCM ok":                    "",
        "Codigo Excecao":            "",
        "CST Item":                  "10",
        "Origem Tributacao":         "0",
        "Nome Etiqueta":             a["name_pt"],
        "Shade/Volumetria":          GAP,
        "Status (ONE SHOT / ATIVO)": "ATIVO",
        "Data Lancamento Retail":    GAP,
        "Data Lancamento Dotcom":    GAP,
        "Link Imagem":               img,
        "Item Exclusivo":            "NAO",
        "Foco Ativacao":             GAP,
        "Anvisa Processo":           "N/A",
        "Anvisa Validade Produto":   "N/A",
    }


def gap_report(rows):
    print("\n" + "=" * 70)
    print("  GAP REPORT — campos [PENDENTE] por SKU")
    print("=" * 70)
    gap_col = "Anvisa Processo"
    critical = ["EAN Unitario", "Profundidade MM", "Largura MM", "Altura MM",
                "Anvisa Processo", "Custo S/ IPI (ref B2B)"]

    for r in rows:
        sku  = r.get("Ref Fornecedor", "?")
        name = r.get("Nome Produto (Site)", "?")[:40]
        gaps = [c for c in COLS if r.get(c) == GAP]
        crit = [c for c in gaps if c in critical]
        if not gaps:
            print(f"  {sku:<10} OK  completo (campos opcionais pendentes)")
        else:
            flag = "!! CRITICO" if crit else "   info"
            print(f"  {sku:<10} {flag}  gaps={len(gaps)}  críticos: {crit or 'nenhum'}")

    print()
    # Summary by column
    print("  CAMPOS PENDENTES (total por coluna):")
    col_counts = {}
    for c in COLS:
        n = sum(1 for r in rows if r.get(c) == GAP)
        if n:
            col_counts[c] = n
    for c, n in sorted(col_counts.items(), key=lambda x: -x[1]):
        print(f"    {n:>3}x  {c}")
    print()


def main():
    dry_run = "--dry-run" in sys.argv

    products = json.loads(PRODUCTS_JSON.read_text(encoding="utf-8"))

    # Skip products with no EAN and no dimensions (not registerable)
    skip_no_ean = {p["sku"] for p in products if not p.get("ean")}
    if skip_no_ean:
        print(f"Skipping {len(skip_no_ean)} SKUs without EAN: {', '.join(sorted(skip_no_ean))}")

    rows = []
    for p in products:
        if not p.get("ean"):
            continue
        # Detect category for Mist products
        cat = "CABELO"
        if p.get("ncm", "").startswith("3307"):
            cat = "CABELO"  # body & hair mist — still haircare at Sephora
        rows.append(map_row(p, category=cat))

    for a in ACCESSORIES:
        rows.append(map_accessory(a))

    gap_report(rows)

    if dry_run:
        print("  [dry-run] CSV não gerado.")
        return

    with open(OUT_CSV, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        w.writerows(rows)

    print(f"  CSV gerado: {OUT_CSV}")
    print(f"  {len(rows)} linhas ({len(rows) - len(ACCESSORIES)} produtos + {len(ACCESSORIES)} acessórios)\n")


if __name__ == "__main__":
    main()
