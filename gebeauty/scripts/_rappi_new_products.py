"""
GE Beauty — Rappi Turbo new-product registration helper.

Phase 1: read existing Rappi Excel registry + query Shopify for all products,
         then diff against the SKUs Moustache Beams has already ordered.
Phase 2: write a new Excel file (same structure) for the NEW products only.
"""

from pathlib import Path
from dotenv import load_dotenv
import os
import json
import urllib.request
import urllib.error
import copy

# ---------------------------------------------------------------------------
# 0. Credentials
# ---------------------------------------------------------------------------
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
GQL_URL = "https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json"

# ---------------------------------------------------------------------------
# 1. SKUs already ordered by Moustache Beams (historical)
# ---------------------------------------------------------------------------
MOUSTACHE_HISTORICAL = {
    "GEB 001", "GEB 002", "GEB 003", "GEB 008", "GEB 010",
    "GEB 011", "GEB 013", "GEB 019", "GEB 020", "GEB 021",
    "GEB 023", "GEB 024", "GEB 101", "GEB 102", "GEB 120",
}

# ---------------------------------------------------------------------------
# 2. Excel paths
# ---------------------------------------------------------------------------
TEMPLATE_PATH = Path(
    r"G:\Drives compartilhados\GEB_Operações\B2B\Rappi\Turbo\Ficha Padrão Cadastro.xlsx"
)
OUTPUT_PATH = Path(
    r"G:\Drives compartilhados\GEB_Operações\B2B\Rappi\Turbo\Ficha Padrão Cadastro - NOVOS PRODUTOS.xlsx"
)

# ---------------------------------------------------------------------------
# 3. Read template Excel
# ---------------------------------------------------------------------------
print("=" * 60)
print("PHASE 1 — Excel template structure")
print("=" * 60)

try:
    import openpyxl
    wb_template = openpyxl.load_workbook(TEMPLATE_PATH)
    ws_template = wb_template.active
    print(f"Sheet name: {ws_template.title}")
    print(f"Dimensions: {ws_template.dimensions}")

    # Row 1 = headers
    headers = [cell.value for cell in ws_template[1]]
    print(f"\nHeaders ({len(headers)} columns):")
    for i, h in enumerate(headers, 1):
        print(f"  [{i:02d}] {h}")

    # First 2 data rows
    data_rows = list(ws_template.iter_rows(min_row=2, max_row=3, values_only=True))
    for ridx, row in enumerate(data_rows, 2):
        print(f"\nRow {ridx}:")
        for h, v in zip(headers, row):
            if v is not None:
                print(f"  {h}: {v}")

    TEMPLATE_OK = True
except FileNotFoundError as e:
    print(f"ERROR: Template file not found — {e}")
    TEMPLATE_OK = False
except PermissionError as e:
    print(f"ERROR: Permission denied reading template — {e}")
    TEMPLATE_OK = False
except Exception as e:
    print(f"ERROR: Could not read template — {type(e).__name__}: {e}")
    TEMPLATE_OK = False

# ---------------------------------------------------------------------------
# 4. Query Shopify — paginated GraphQL
# ---------------------------------------------------------------------------
print("\n" + "=" * 60)
print("PHASE 1 — Shopify product fetch")
print("=" * 60)

GQL_QUERY = """
query GetProducts($cursor: String) {
  products(first: 50, after: $cursor, query: "product_type:product") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      title
      productType
      descriptionHtml
      variants(first: 1) {
        nodes {
          sku
          barcode
          price
          compareAtPrice
          inventoryItem {
            measurement {
              weight { value unit }
            }
          }
        }
      }
      images(first: 5) {
        nodes { url altText }
      }
    }
  }
}
"""

GQL_QUERY_NO_FILTER = """
query GetProductsAll($cursor: String) {
  products(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      title
      productType
      variants(first: 1) {
        nodes { sku }
      }
    }
  }
}
"""


def gql_request(query: str, variables: dict) -> dict:
    payload = json.dumps({"query": query, "variables": variables}).encode("utf-8")
    req = urllib.request.Request(
        GQL_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": TOKEN,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_all_products(query: str, data_key: str = "products") -> list:
    products = []
    cursor = None
    page = 0
    while True:
        page += 1
        variables = {"cursor": cursor}
        resp = gql_request(query, variables)
        if "errors" in resp:
            print(f"GraphQL errors: {resp['errors']}")
            break
        page_data = resp["data"][data_key]
        nodes = page_data["nodes"]
        products.extend(nodes)
        print(f"  Page {page}: fetched {len(nodes)} products (total so far: {len(products)})")
        if not page_data["pageInfo"]["hasNextPage"]:
            break
        cursor = page_data["pageInfo"]["endCursor"]
    return products


print("\nFetching with product_type:product filter …")
all_products = fetch_all_products(GQL_QUERY)

if len(all_products) == 0:
    print("No products returned with product_type filter. Fetching ALL products to inspect types …")
    all_products_unfiltered = fetch_all_products(GQL_QUERY_NO_FILTER)
    product_types = sorted({p.get("productType", "") for p in all_products_unfiltered})
    print(f"\nUnique productType values found ({len(product_types)}):")
    for pt in product_types:
        print(f"  • '{pt}'")
    # Use unfiltered results but we can't populate full detail — warn
    print("\nWARNING: using unfiltered products; image/barcode/price data may be incomplete.")
    all_products = []
    # Re-fetch unfiltered with full detail
    GQL_QUERY_FULL = """
query GetProductsFull($cursor: String) {
  products(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      title
      productType
      descriptionHtml
      variants(first: 1) {
        nodes {
          sku
          barcode
          price
          compareAtPrice
          inventoryItem {
            measurement {
              weight { value unit }
            }
          }
        }
      }
      images(first: 5) {
        nodes { url altText }
      }
    }
  }
}
"""
    all_products = fetch_all_products(GQL_QUERY_FULL)

print(f"\nTotal products fetched: {len(all_products)}")

# ---------------------------------------------------------------------------
# 5. Print all products + identify NEW ones
# ---------------------------------------------------------------------------
print("\n" + "=" * 60)
print("PHASE 1 — Product list + NEW SKU identification")
print("=" * 60)

new_products = []
all_skus_found = []

print(f"\n{'SKU':<12} {'Title':<50} {'Barcode':<16} {'Price':>8}  STATUS")
print("-" * 110)

for p in all_products:
    variant = p["variants"]["nodes"][0] if p["variants"]["nodes"] else {}
    sku = (variant.get("sku") or "").strip()
    barcode = (variant.get("barcode") or "").strip()
    price = variant.get("price", "")
    title = p.get("title", "")
    all_skus_found.append(sku)

    # Normalize SKU for comparison (allow "GEB001" == "GEB 001")
    sku_norm = sku.replace(" ", "").upper()
    historical_norm = {s.replace(" ", "").upper() for s in MOUSTACHE_HISTORICAL}
    is_new = sku_norm not in historical_norm

    status = "NEW ***" if is_new else "already ordered"
    print(f"{sku:<12} {title[:50]:<50} {barcode:<16} {price:>8}  {status}")

    if is_new:
        new_products.append(p)

print("-" * 110)
print(f"\nSKUs already in Moustache history : {len(MOUSTACHE_HISTORICAL)}")
print(f"Products found in Shopify          : {len(all_products)}")
print(f"NEW products (not yet registered) : {len(new_products)}")

if new_products:
    print("\nNEW products to register:")
    for p in new_products:
        variant = p["variants"]["nodes"][0] if p["variants"]["nodes"] else {}
        sku = (variant.get("sku") or "").strip()
        print(f"  • {sku} — {p['title']}")

# ---------------------------------------------------------------------------
# 6. Phase 2 — Build new Excel file
# ---------------------------------------------------------------------------
print("\n" + "=" * 60)
print("PHASE 2 — Build new Excel registration file")
print("=" * 60)

if not new_products:
    print("No new products found — output file not created.")
else:
    if not TEMPLATE_OK:
        print("Template could not be read. Will create a minimal Excel from scratch.")

    try:
        if TEMPLATE_OK:
            # The template has a 2-row header block:
            #   Row 1: constraint labels ("Obrigatório (Texto e Números)", etc.)
            #   Row 2: semantic field names ("Nome do Produto", "EAN", etc.)
            #   Row 3+: data rows
            # Strategy: keep rows 1+2 intact, delete rows 3..end, append new data rows.
            wb_out = openpyxl.load_workbook(TEMPLATE_PATH)
            ws_out = wb_out.active

            max_row = ws_out.max_row
            # Delete data rows from the bottom up, keeping rows 1 and 2
            if max_row >= 3:
                for row_idx in range(max_row, 2, -1):
                    ws_out.delete_rows(row_idx)

            # Use row 2 (semantic names) as the column-mapping reference
            headers_row2 = [cell.value for cell in ws_out[2]]
            print(f"Semantic headers (row 2): {headers_row2}")

        else:
            # Minimal fallback: create from scratch with a single header row
            wb_out = openpyxl.Workbook()
            ws_out = wb_out.active
            ws_out.title = "Cadastro"
            headers_row2 = [
                "Nome do Produto", "Descrição do Produto", "Número EAN",
                "DUN/EAN da Caixa", "Qtd na Caixa", "EAN Display",
                "Qtd no Display", "Gramatura", "Unidade de Medida",
                "Categoria", "Link da Imagem", "NCM", "CEST",
                "Produto Perecível", "Entrega", "Shelf Life",
                "Peso Bruto", "Peso Líquidio", "Comprimento",
                "Largura", "Altura", "Paletização", "Armazenamento",
                "CNPJ", "UF ORIGEM", "Cidade", "UNC/MOQ",
                "Custo Bruto Unitário do Produto (com todos Impostos)", "Preço de Venda", "Curva",
            ]
            ws_out.append(headers_row2)
            print("Using fallback minimal headers (template was unreadable).")

        # Build a header→index map (case-insensitive, partial match) against row 2
        def find_col(headers, *keywords):
            """Return 0-based column index for the first header matching any keyword."""
            kw_lower = [k.lower() for k in keywords]
            for i, h in enumerate(headers):
                h_str = str(h or "").lower()
                if any(k in h_str for k in kw_lower):
                    return i
            return None

        # Map using row-2 semantic field names
        col_ean    = find_col(headers_row2, "ean", "barcode", "código de barras", "gtin", "número ean")
        col_name   = find_col(headers_row2, "nome", "name")
        col_desc   = find_col(headers_row2, "descri")
        col_weight = find_col(headers_row2, "gramatura", "peso líq", "peso liq", "peso bruto")
        col_wunit  = find_col(headers_row2, "unidade de medida")
        col_categ  = find_col(headers_row2, "categoria")
        col_img1   = find_col(headers_row2, "imagem", "link da imagem")
        col_shelf  = find_col(headers_row2, "shelf")
        col_price  = find_col(headers_row2, "preço de venda", "preco de venda")
        col_cnpj   = find_col(headers_row2, "cnpj")
        col_uf     = find_col(headers_row2, "uf origem")
        col_city   = find_col(headers_row2, "cidade")
        # Gramatura = volume/weight value; Unidade de Medida = its unit
        col_gram   = find_col(headers_row2, "gramatura")

        print(f"\nColumn mapping:")
        mapping_pairs = [
            ("EAN", col_ean), ("Name", col_name), ("Description", col_desc),
            ("Gramatura", col_gram), ("Unid.Medida", col_wunit), ("Categoria", col_categ),
            ("LinkImagem", col_img1), ("ShelfLife", col_shelf), ("Preco", col_price),
            ("CNPJ", col_cnpj), ("UF", col_uf), ("Cidade", col_city),
        ]
        for name, idx in mapping_pairs:
            col_letter = openpyxl.utils.get_column_letter(idx + 1) if idx is not None else "—"
            print(f"  {name:<14}: col {col_letter} (index {idx})")

        def set_cell(row_values, col_idx, value):
            if col_idx is not None and col_idx < len(row_values):
                row_values[col_idx] = value

        num_cols = len(headers_row2)

        for p in new_products:
            variant = p["variants"]["nodes"][0] if p["variants"]["nodes"] else {}
            sku     = (variant.get("sku") or "").strip()
            barcode = (variant.get("barcode") or "").strip()
            price   = variant.get("price") or ""
            comp    = variant.get("compareAtPrice") or ""
            inv_item = variant.get("inventoryItem") or {}
            measurement = (inv_item.get("measurement") or {})
            weight_obj  = (measurement.get("weight") or {})
            weight  = weight_obj.get("value") or ""
            wunit   = weight_obj.get("unit") or ""
            title   = p.get("title", "")
            # Strip HTML from description
            desc_html = p.get("descriptionHtml", "") or ""
            # Simple HTML tag strip
            import re
            desc_plain = re.sub(r"<[^>]+>", " ", desc_html).strip()
            desc_plain = re.sub(r"\s+", " ", desc_plain)

            images = [img["url"] for img in (p.get("images") or {}).get("nodes", [])]
            img1 = images[0] if images else ""

            # Convert weight to grams if needed
            if weight and wunit:
                try:
                    w_float = float(weight)
                    if wunit.upper() == "KILOGRAMS":
                        w_float *= 1000
                    elif wunit.upper() == "POUNDS":
                        w_float *= 453.592
                    elif wunit.upper() == "OUNCES":
                        w_float *= 28.3495
                    weight = round(w_float)
                except (ValueError, TypeError):
                    pass

            # Parse weight into value + unit for Gramatura / Unidade de Medida
            gram_value = weight  # already converted to grams above (or raw float)
            gram_unit  = "g" if weight else wunit

            row_values = [None] * num_cols
            set_cell(row_values, col_ean,   barcode)
            set_cell(row_values, col_name,  title)
            set_cell(row_values, col_desc,  desc_plain)
            set_cell(row_values, col_gram,  gram_value)
            set_cell(row_values, col_wunit, gram_unit)
            set_cell(row_values, col_categ, "Cosméticos")
            set_cell(row_values, col_img1,  img1)
            set_cell(row_values, col_price, price)
            # CNPJ, UF, Cidade default to GE Beauty's values (same as template sample)
            set_cell(row_values, col_cnpj,  "34987157000174")
            set_cell(row_values, col_uf,    "SP")
            set_cell(row_values, col_city,  "Cajamar")

            ws_out.append(row_values)

        wb_out.save(OUTPUT_PATH)
        print(f"\nOutput file written: {OUTPUT_PATH}")
        print(f"Rows written: {len(new_products)}")

    except Exception as e:
        import traceback
        print(f"\nERROR writing output Excel: {type(e).__name__}: {e}")
        traceback.print_exc()

print("\n" + "=" * 60)
print("DONE")
print("=" * 60)
