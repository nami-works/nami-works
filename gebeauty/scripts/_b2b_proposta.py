"""
GE Beauty — Unified B2B Proposal Generator
============================================
Two modes:
  full  — Self-contained branded HTML (GE logo + Shopify product thumbnails).
           Open in browser → Ctrl+P → A4 Landscape → Margens mínimas → Save as PDF.
  lite  — Reportlab PDF, no images, no network. Fast, good for iterations.

Data source: Excel simulator at
  G:/Drives compartilhados/GEB_Comercial/Boxes/GEB_B2B_Box_Dashboard.xlsx
  → Dashboard sheet, rows 55–69, cols B=SKU C=Produto E=Volume F=PrecoUnit H=Retail

Usage:
  C:/Python314/python.exe gebeauty/scripts/_b2b_proposta.py \
    --mode full \
    --client-name "UAUBOX S.A." \
    --client-display "UAU Box" \
    --payment "A combinar" \
    --frete "CIF para São Paulo" \
    --disponibilidade "Pronta entrega" \
    --validade "7 dias" \
    --date "01 de julho de 2026" \
    --out "../B2B_Proposta_UAUBox_20260702.html"
"""

import argparse
import base64
import io
import json
import re
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT   = SCRIPT_DIR.parent.parent         # gebeauty/scripts → repo root
ENV_FILE    = SCRIPT_DIR.parent / ".env"       # gebeauty/.env

EXCEL_PATH  = Path(
    "G:/Drives compartilhados/GEB_Comercial/Boxes/GEB_B2B_Box_Dashboard.xlsx"
)
# Dashboard sheet, rows 55–69 (0-indexed: 54–68), cols:
#   B(1)=SKU  C(2)=Produto  E(4)=Volume  F(5)=PrecoUnit  H(7)=Retail
SHEET_NAME  = "Dashboard"
ROW_START   = 54   # 0-indexed (row 55 in Excel)
ROW_END     = 69   # exclusive
COL_SKU     = 1    # B
COL_PRODUTO = 2    # C
COL_VOLUME  = 4    # E
COL_PRECO   = 5    # F
COL_RETAIL  = 7    # H

SHOP_DOMAIN = "ge-beauty-cosmeticos.myshopify.com"
API_VERSION = "2026-01"

# ── Logo URLs ─────────────────────────────────────────────────────────────────
LOGO_URLS = [
    "https://cdn.shopify.com/s/files/1/0807/8344/2240/files/ge_beauty_logo-01_copia.svg?v=1696611815",
    "https://cdn.shopify.com/s/files/1/0807/8344/2240/files/ge_beauty_logo_horizontal.png?v=1777325446",
]

# ── Handle map (SKU → Shopify product handle) ─────────────────────────────────
HANDLES = {
    "GEB001": "shampoo-sem-sulfato",
    "GEB002": "mascara-condicionadora",
    "GEB003": "leave-in-com-protecao-termica",
    "GEB008": "shampoo-a-seco",
    "GEB010": "mascara-condicionadora-50ml",
    "GEB013": "shampoo-sem-sulfato-60ml",
    "GEB019": "booster-fortificante",
    "GEB020": "booster-hidratante",
    "GEB021": "booster-definicao",
    "GEB022": "booster-antifrizz",
    "GEB023": "booster-antioxidante",
    "GEB024": "melon-mood-body-hair-mist",
    "GEB029": "melon-mood-body-hair-mist-travel-size",
    "GEB101": "primer-cachos-definidos",
    "GEB102": "primer-liso-intacto",
    "GEB120": "leave-in-pluma",
    "GEB121": "mascara-mayday",
}

# ── Volume labels per SKU ─────────────────────────────────────────────────────
VOLS = {
    "GEB001": "250 ml", "GEB002": "200 ml", "GEB003": "150 ml",
    "GEB008": "150 ml", "GEB010": "50 ml",  "GEB013": "60 ml",
    "GEB019": "15 ml",  "GEB020": "15 ml",  "GEB021": "15 ml",
    "GEB022": "15 ml",  "GEB023": "15 ml",  "GEB024": "200 ml",
    "GEB029": "100 ml", "GEB101": "250 ml", "GEB102": "150 ml",
    "GEB120": "200 ml", "GEB121": "200 g",
}


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def load_env():
    """Load key=value pairs from gebeauty/.env."""
    env = {}
    if not ENV_FILE.exists():
        return env
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def normalize_sku(raw):
    """'GEB 024' → 'GEB024'."""
    return re.sub(r"\s+", "", str(raw).strip()).upper()


def read_excel_rows():
    """
    Read simulator rows from the Dashboard sheet (rows 55–69).
    Returns list of dicts: {sku, produto, volume, preco_unit, retail}
    Skips rows where SKU is empty.
    """
    try:
        from openpyxl import load_workbook
    except ImportError:
        print("[!] openpyxl not installed. Run: C:/Python314/python.exe -m pip install openpyxl")
        sys.exit(1)

    if not EXCEL_PATH.exists():
        print(f"[!] Excel not found: {EXCEL_PATH}")
        sys.exit(1)

    wb = load_workbook(str(EXCEL_PATH), data_only=True)
    ws = wb[SHEET_NAME]

    rows = []
    for row_idx in range(ROW_START, ROW_END):
        row = list(ws.iter_rows(min_row=row_idx + 1, max_row=row_idx + 1, values_only=True))[0]
        raw_sku = row[COL_SKU]
        if not raw_sku:
            continue
        sku = normalize_sku(raw_sku)
        produto   = str(row[COL_PRODUTO] or "").strip()
        volume    = row[COL_VOLUME]
        preco     = row[COL_PRECO]
        retail    = row[COL_RETAIL]

        try:
            volume = int(volume) if volume is not None else 0
        except (TypeError, ValueError):
            volume = 0

        try:
            preco = float(preco) if preco is not None else 0.0
        except (TypeError, ValueError):
            preco = 0.0

        try:
            retail = float(retail) if retail is not None else 0.0
        except (TypeError, ValueError):
            retail = 0.0

        if volume <= 0 or preco <= 0:
            continue

        rows.append({"sku": sku, "produto": produto, "volume": volume,
                     "preco_unit": preco, "retail": retail})

    return rows


def fmt_brl(v):
    """28.5 → 'R$&thinsp;28,50'"""
    s = f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {s}"


def fmt_brl_plain(v):
    """28.5 → 'R$ 28,50' (plain text for reportlab)"""
    s = f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {s}"


def fmt_units(n):
    """1000 → '1.000 un'"""
    return f"{n:,.0f}".replace(",", ".") + " un"


def fmt_units_plain(n):
    """1000 → '1.000 un' plain text"""
    return f"{n:,.0f}".replace(",", ".") + " un"


def desc_pct(retail, preco):
    if not retail or not preco:
        return "—"
    pct = round((retail - preco) / retail * 100)
    return f"{pct}%"


def today_ptbr():
    months = [
        "", "janeiro", "fevereiro", "março", "abril", "maio", "junho",
        "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
    ]
    d = datetime.now()
    return f"{d.day:02d} de {months[d.month]} de {d.year}"


def slugify(text):
    """'UAUBOX S.A.' → 'UAUBox'"""
    slug = re.sub(r"[^A-Za-z0-9]", "", text)
    return slug or "Cliente"


def default_out(client_name, mode, date_str):
    date_tag = datetime.now().strftime("%Y%m%d")
    slug = slugify(client_name)
    ext = "html" if mode == "full" else "pdf"
    return str(SCRIPT_DIR.parent / f"B2B_Proposta_{slug}_{date_tag}.{ext}")


# ─────────────────────────────────────────────────────────────────────────────
# Full mode — HTML with images
# ─────────────────────────────────────────────────────────────────────────────

def fetch_raw(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            ct = r.headers.get("Content-Type", "application/octet-stream").split(";")[0]
            return r.read(), ct
    except Exception as e:
        print(f"  [!] fetch {url[:70]}: {e}")
        return None, None


def resize_and_b64(img_bytes, size=(60, 60)):
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(img_bytes)).convert("RGBA")
        w, h = img.size
        m = min(w, h)
        img = img.crop(((w - m) // 2, (h - m) // 2, (w + m) // 2, (h + m) // 2))
        img = img.resize(size, Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="WebP", quality=72)
        b64 = base64.b64encode(buf.getvalue()).decode()
        return f"data:image/webp;base64,{b64}"
    except Exception as e:
        print(f"  [!] resize error: {e}")
        return None


def fetch_product_image(sku, token):
    """Fetch main product image URL from Shopify by handle."""
    handle = HANDLES.get(sku)
    if not handle:
        # Derive handle by transforming SKU (best-effort)
        handle = sku.lower().replace("geb", "geb-")

    query = """
    query($handle: String!) {
      productByHandle(handle: $handle) {
        images(first: 1) {
          edges { node { url } }
        }
      }
    }
    """
    url = f"https://{SHOP_DOMAIN}/admin/api/{API_VERSION}/graphql.json"
    body = json.dumps({"query": query, "variables": {"handle": handle}}).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read().decode("utf-8"))
        edges = (data.get("data", {})
                     .get("productByHandle") or {})
        edges = edges.get("images", {}).get("edges", [])
        if edges:
            return edges[0]["node"]["url"]
    except Exception as e:
        print(f"  [!] Shopify image {sku}: {e}")
    return None


def build_html(rows, args, logo_b64, logo_mime, thumbs, client_legal, client_display,
               no_grand_total=False):
    """Build the branded HTML proposal. CSS/structure mirrors _b2b_build_proposta_canonical.py."""

    # Logo element
    if logo_b64 and "svg" in (logo_mime or ""):
        logo_el = f'<img class="brand-logo" src="{logo_b64}" alt="GE Beauty">'
    elif logo_b64:
        logo_el = f'<img class="brand-logo" src="{logo_b64}" alt="GE Beauty">'
    else:
        logo_el = '<span class="brand-name-txt">GE Beauty</span>'

    # Table rows
    rows_html = ""
    total_units = 0
    total_value = 0.0
    for r in rows:
        sku      = r["sku"]
        produto  = r["produto"]
        volume   = r["volume"]
        preco    = r["preco_unit"]
        retail   = r["retail"]
        thumb    = thumbs.get(sku)
        pct      = desc_pct(retail, preco)
        vol_lbl  = VOLS.get(sku, "—")
        line_tot = volume * preco
        total_units += volume
        total_value  += line_tot
        sku_display = sku[:3] + " " + sku[3:]  # GEB024 → GEB 024

        img_tag = ""
        if thumb:
            img_tag = f'<img class="prod-img" src="{thumb}" alt="{produto}" loading="lazy">'

        rows_html += f"""
        <tr>
          <td class="td-name">
            <div class="name-cell">
              {img_tag}
              <span class="name-text">{produto}</span>
            </div>
          </td>
          <td class="td-vol">{vol_lbl}</td>
          <td class="td-ref">{sku_display}</td>
          <td class="td-num">{fmt_brl(retail) if retail else '&mdash;'}</td>
          <td class="td-num">{fmt_units(volume)}</td>
          <td class="td-num">{fmt_brl(preco)}</td>
          <td class="td-sellout">{pct}</td>
          <td class="td-total">{fmt_brl(line_tot)}</td>
        </tr>"""

    totals_section = "" if no_grand_total else f"""
  <!-- Totals -->
  <div class="totals">
    <div class="total-item">
      <div class="total-label">Total de Unidades</div>
      <div class="total-val">{fmt_units(total_units)}</div>
    </div>
    <div class="total-item">
      <div class="total-label">Valor Total da Proposta</div>
      <div class="total-val accent">{fmt_brl(total_value)}</div>
    </div>
  </div>"""

    html = f"""<title>Cotação — GE Beauty</title>
<style>
  *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}

  body {{
    background: #EEEBE9;
    display: flex;
    justify-content: center;
    padding: 40px 16px 64px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, Helvetica, sans-serif;
    -webkit-font-smoothing: antialiased;
  }}

  .document {{
    background: #fff;
    width: 1200px;
    max-width: 100%;
    box-shadow: 0 4px 40px rgba(0,0,0,0.14);
  }}

  /* ── Header ── */
  .doc-header {{
    background: #DF372F;
    padding: 18px 48px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }}

  .brand-logo {{
    height: 36px;
    width: auto;
    display: block;
    filter: brightness(0) invert(1);
  }}

  .brand-name-txt {{
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 26px;
    font-weight: 700;
    color: #fff;
    letter-spacing: 0.04em;
  }}

  .doc-meta-right {{
    text-align: right;
  }}

  .doc-date {{
    font-size: 14.5px;
    color: rgba(255,255,255,0.72);
    letter-spacing: 0.04em;
  }}

  /* ── Meta strip ── */
  .meta-strip {{
    padding: 12px 48px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    border-bottom: 1px solid #EDE9E8;
  }}

  .meta-cell.right {{ text-align: right; }}

  .meta-eyebrow {{
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #B0A5A3;
    margin-bottom: 5px;
  }}

  .meta-primary {{
    font-size: 14px;
    font-weight: 700;
    color: #1A1A1A;
    line-height: 1.2;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }}

  .meta-secondary {{
    margin-top: 3px;
    font-size: 12px;
    color: #7A706E;
    line-height: 1.5;
  }}

  /* ── Table ── */
  .table-section {{
    padding: 14px 48px 0;
    overflow-x: auto;
  }}

  table {{
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-variant-numeric: tabular-nums;
  }}

  col.c-name   {{ width: auto; }}
  col.c-vol    {{ width: 92px; }}
  col.c-ref    {{ width: 100px; }}
  col.c-retail {{ width: 148px; }}
  col.c-qty    {{ width: 120px; }}
  col.c-unit   {{ width: 148px; }}
  col.c-sell   {{ width: 110px; }}
  col.c-total  {{ width: 130px; }}

  thead tr {{ border-bottom: 2px solid #DF372F; }}

  thead th {{
    padding: 0 6px 10px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.11em;
    color: #B0A5A3;
    text-align: left;
    vertical-align: bottom;
    line-height: 1.3;
  }}

  thead th.c {{ text-align: center; }}

  tbody tr td {{
    padding: 4px 8px;
    font-size: 13px;
    color: #1A1A1A;
    border-bottom: 1px solid #EDEAE8;
    vertical-align: middle;
  }}

  tbody tr:nth-child(even) {{ background: #F6F4F3; }}
  tbody tr:last-child td {{ border-bottom: none; }}

  /* Name cell with image */
  .name-cell {{
    display: flex;
    align-items: center;
    gap: 12px;
  }}

  .prod-img {{
    width: 36px;
    height: 36px;
    object-fit: cover;
    border-radius: 4px;
    flex-shrink: 0;
    background: #F5F3F2;
    display: block;
  }}

  .name-text {{
    font-size: 13px;
    line-height: 1.35;
  }}

  .td-vol  {{ text-align: center; white-space: nowrap; }}
  .td-ref  {{ text-align: center; white-space: nowrap; letter-spacing: 0.06em; }}
  .td-num  {{ text-align: center; white-space: nowrap; }}

  .td-sellout {{
    text-align: center;
    white-space: nowrap;
    font-weight: 700;
    color: #2A7A3A;
  }}

  .td-total {{
    text-align: center;
    white-space: nowrap;
    font-weight: 600;
  }}

  /* ── Totals strip ── */
  .totals {{
    padding: 10px 48px 12px;
    display: flex;
    justify-content: flex-end;
    align-items: flex-end;
    gap: 48px;
    border-top: 2px solid #1A1A1A;
    margin: 0 48px;
  }}

  .total-item {{ text-align: right; }}

  .total-label {{
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.13em;
    color: #B0A5A3;
    margin-bottom: 3px;
  }}

  .total-val {{
    font-size: 16px;
    font-weight: 700;
    color: #1A1A1A;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
  }}

  .total-val.accent {{
    font-size: 20px;
    color: #DF372F;
  }}

  /* ── Conditions ── */
  .conditions {{
    margin: 12px 48px 0;
    padding: 10px 16px;
    background: #FAF8F7;
    border-left: 3px solid #DF372F;
  }}

  .cond-eyebrow {{
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: #B0A5A3;
    margin-bottom: 8px;
  }}

  .cond-grid {{
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
  }}

  .cond-key {{
    font-size: 12px;
    color: #7A706E;
    margin-bottom: 2px;
  }}

  .cond-val {{
    font-size: 14px;
    font-weight: 600;
    color: #1A1A1A;
    line-height: 1.3;
  }}

  /* ── Footer ── */
  .doc-footer {{
    margin-top: 10px;
    padding: 10px 48px;
    border-top: 1px solid #EDE9E8;
    display: flex;
    justify-content: flex-end;
    align-items: center;
  }}

  .footer-copy {{
    font-size: 13px;
    color: #B0A5A3;
    line-height: 1.7;
    text-align: right;
  }}

  /* ── Print ── */
  @media print {{
    html {{ zoom: 0.95; }}
    body {{ background: white; padding: 0; }}
    .document {{ box-shadow: none; width: 100%; }}
    @page {{ size: A4 landscape; margin: 3mm 6mm; }}
  }}
</style>

<div class="document">

  <!-- Header -->
  <div class="doc-header">
    <div class="brand-block">
      {logo_el}
    </div>
    <div class="doc-meta-right">
      <div class="doc-date">{args.date}</div>
    </div>
  </div>

  <!-- Meta strip -->
  <div class="meta-strip">
    <div class="meta-cell">
      <div class="meta-eyebrow">Para</div>
      <div class="meta-primary">{client_legal}</div>
      <div class="meta-secondary">Cotação para compra em atacado &nbsp;&middot;&nbsp; Validade: {args.validade}</div>
    </div>
    <div class="meta-cell right">
      <div class="meta-eyebrow">Contato</div>
      <div class="meta-primary">Lucas Guimarães</div>
      <div class="meta-secondary">lucas@gebeauty.com.br &nbsp;&middot;&nbsp; (11) 97277-6427</div>
    </div>
  </div>

  <!-- Product table -->
  <div class="table-section">
    <table>
      <colgroup>
        <col class="c-name">
        <col class="c-vol">
        <col class="c-ref">
        <col class="c-retail">
        <col class="c-qty">
        <col class="c-unit">
        <col class="c-sell">
        <col class="c-total">
      </colgroup>
      <thead>
        <tr>
          <th>Produto</th>
          <th class="c">Vol.</th>
          <th class="c">Ref.</th>
          <th class="c">Preço<br>Varejo</th>
          <th class="c">Qtd.</th>
          <th class="c">Preço<br>Atacado</th>
          <th class="c">Desc. s/<br>Tabela</th>
          <th class="c">Valor<br>Total</th>
        </tr>
      </thead>
      <tbody>{rows_html}
      </tbody>
    </table>
  </div>

{totals_section}

  <!-- Conditions -->
  <div class="conditions">
    <div class="cond-eyebrow">Condições Comerciais</div>
    <div class="cond-grid">
      <div>
        <div class="cond-key">Prazo de pagamento</div>
        <div class="cond-val">{args.payment}</div>
      </div>
      <div>
        <div class="cond-key">Frete</div>
        <div class="cond-val">{args.frete}</div>
      </div>
      <div>
        <div class="cond-key">Disponibilidade</div>
        <div class="cond-val">{args.disponibilidade}</div>
      </div>
      <div>
        <div class="cond-key">Validade da cotação</div>
        <div class="cond-val">{args.validade}</div>
      </div>
    </div>
  </div>

  <!-- Footer -->
  <div class="doc-footer">
    <div class="footer-copy">
      GE COSMÉTICOS LTDA. &nbsp;&ndash;&nbsp; 34.987.157/0001-74<br>
      Proposta sujeita a confirmação de estoque no momento de confirmação da compra.
    </div>
  </div>

</div>
"""
    return html, total_units, total_value


def run_full(rows, args):
    env = load_env()
    token = env.get("SHOPIFY_ADMIN_ACCESS_TOKEN", "")

    # Logo
    print("Fetching logo...")
    logo_b64 = None
    logo_mime = None
    for url in LOGO_URLS:
        data, ct = fetch_raw(url)
        if data:
            logo_b64 = f"data:{ct};base64,{base64.b64encode(data).decode()}"
            logo_mime = ct
            print(f"  logo ok ({len(data)//1024}kB, {ct})")
            break

    # Product thumbnails
    thumbs = {}
    if token:
        print("Fetching product images from Shopify...")
        for r in rows:
            sku = r["sku"]
            img_url = fetch_product_image(sku, token)
            if img_url:
                img_data, _ = fetch_raw(img_url)
                if img_data:
                    thumb = resize_and_b64(img_data)
                    thumbs[sku] = thumb
                    print(f"  {sku}: {'ok' if thumb else 'resize failed'}")
                else:
                    thumbs[sku] = None
                    print(f"  {sku}: download failed")
            else:
                thumbs[sku] = None
                print(f"  {sku}: no image found")
    else:
        print("  [!] No SHOPIFY_ADMIN_ACCESS_TOKEN in .env — skipping product images")

    client_legal   = args.client_name
    client_display = args.client_display or args.client_name

    html, total_units, total_value = build_html(
        rows, args, logo_b64, logo_mime, thumbs, client_legal, client_display,
        no_grand_total=args.no_grand_total,
    )

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html, encoding="utf-8")
    size_kb = out_path.stat().st_size // 1024
    print(f"\nHTML written: {out_path} ({size_kb} kB)")
    print(f"  Total unidades: {fmt_units_plain(total_units)}")
    print(f"  Valor total:    {fmt_brl_plain(total_value)}")

    print(f"\nAbrir no navegador e imprimir:")
    print(f"  Start-Process \"{out_path}\"")
    print("  Ctrl+P → A4 Paisagem → Margens mínimas → Salvar como PDF")


# ─────────────────────────────────────────────────────────────────────────────
# Lite mode — Reportlab PDF
# ─────────────────────────────────────────────────────────────────────────────

def run_lite(rows, args):
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import mm
        from reportlab.platypus import (
            SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
        )
    except ImportError:
        print("[!] reportlab not installed. Run: C:/Python314/python.exe -m pip install reportlab")
        sys.exit(1)

    GEB_RED   = colors.HexColor("#DF372F")
    GEB_DARK  = colors.HexColor("#1A1A1A")
    GEB_GREY  = colors.HexColor("#B0A5A3")
    GEB_STRIP = colors.HexColor("#F6F4F3")
    GEB_GREEN = colors.HexColor("#2A7A3A")
    WHITE     = colors.white

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    doc = SimpleDocTemplate(
        str(out_path),
        pagesize=landscape(A4),
        leftMargin=14*mm,
        rightMargin=14*mm,
        topMargin=12*mm,
        bottomMargin=12*mm,
    )

    styles = getSampleStyleSheet()
    body_style = ParagraphStyle(
        "body", fontName="Helvetica", fontSize=9, leading=12,
        textColor=GEB_DARK,
    )
    title_style = ParagraphStyle(
        "title", fontName="Helvetica-Bold", fontSize=15, leading=18,
        textColor=WHITE,
    )
    sub_style = ParagraphStyle(
        "sub", fontName="Helvetica", fontSize=8, leading=10,
        textColor=colors.HexColor("#FAF8F7"),
    )
    label_style = ParagraphStyle(
        "label", fontName="Helvetica-Bold", fontSize=7, leading=9,
        textColor=GEB_GREY, spaceAfter=2,
    )
    val_style = ParagraphStyle(
        "val", fontName="Helvetica-Bold", fontSize=9, leading=11,
        textColor=GEB_DARK,
    )

    # Build table data
    header = [
        "Produto", "Vol.", "Ref.", "Preço Varejo",
        "Qtd.", "Preço Atacado", "Desc. s/Tabela", "Valor Total"
    ]

    data_rows = []
    total_units = 0
    total_value = 0.0
    for r in rows:
        sku      = r["sku"]
        produto  = r["produto"]
        volume   = r["volume"]
        preco    = r["preco_unit"]
        retail   = r["retail"]
        vol_lbl  = VOLS.get(sku, "—")
        pct      = desc_pct(retail, preco)
        line_tot = volume * preco
        total_units += volume
        total_value  += line_tot
        sku_display = sku[:3] + " " + sku[3:]

        data_rows.append([
            Paragraph(produto, body_style),
            vol_lbl,
            sku_display,
            fmt_brl_plain(retail) if retail else "—",
            fmt_units_plain(volume),
            fmt_brl_plain(preco),
            pct,
            fmt_brl_plain(line_tot),
        ])

    table_data = [header] + data_rows

    col_widths = [None, 22*mm, 24*mm, 35*mm, 28*mm, 35*mm, 26*mm, 32*mm]

    t = Table(table_data, colWidths=col_widths, repeatRows=1)

    style_cmds = [
        # Header
        ("BACKGROUND",   (0, 0), (-1, 0), GEB_RED),
        ("TEXTCOLOR",    (0, 0), (-1, 0), WHITE),
        ("FONTNAME",     (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",     (0, 0), (-1, 0), 8),
        ("ALIGN",        (0, 0), (-1, 0), "CENTER"),
        ("VALIGN",       (0, 0), (-1, 0), "MIDDLE"),
        ("BOTTOMPADDING",(0, 0), (-1, 0), 6),
        ("TOPPADDING",   (0, 0), (-1, 0), 6),
        ("LINEBELOW",    (0, 0), (-1, 0), 1.5, GEB_RED),
        # Body
        ("FONTNAME",     (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE",     (0, 1), (-1, -1), 8),
        ("TEXTCOLOR",    (0, 1), (-1, -1), GEB_DARK),
        ("VALIGN",       (0, 1), (-1, -1), "MIDDLE"),
        ("ALIGN",        (1, 1), (-1, -1), "CENTER"),
        ("ALIGN",        (0, 1), (0, -1),  "LEFT"),
        ("TOPPADDING",   (0, 1), (-1, -1), 3),
        ("BOTTOMPADDING",(0, 1), (-1, -1), 3),
        ("LINEBELOW",    (0, 1), (-1, -1), 0.5, colors.HexColor("#EDEAE8")),
        ("GRID",         (0, 0), (-1, -1), 0, colors.white),
        # Alternating rows
        *[("BACKGROUND", (0, i), (-1, i), GEB_STRIP)
          for i in range(2, len(table_data), 2)],
        # Desc column green
        ("TEXTCOLOR",    (6, 1), (6, -1), GEB_GREEN),
        ("FONTNAME",     (6, 1), (6, -1), "Helvetica-Bold"),
        # Total column bold
        ("FONTNAME",     (7, 1), (7, -1), "Helvetica-Bold"),
    ]
    t.setStyle(TableStyle(style_cmds))

    # Totals row
    totals_data = [
        ["", "", "", "", "", "",
         "Total Unidades:", fmt_units_plain(total_units)],
        ["", "", "", "", "", "",
         "Valor Total:",    fmt_brl_plain(total_value)],
    ]
    totals_t = Table(totals_data, colWidths=col_widths)
    totals_t.setStyle(TableStyle([
        ("FONTNAME",  (6, 0), (6, -1), "Helvetica-Bold"),
        ("FONTSIZE",  (6, 0), (-1, -1), 9),
        ("TEXTCOLOR", (7, 0), (7, 0), GEB_DARK),
        ("TEXTCOLOR", (7, 1), (7, 1), GEB_RED),
        ("FONTNAME",  (7, 0), (7, -1), "Helvetica-Bold"),
        ("FONTSIZE",  (7, 1), (7, 1), 12),
        ("ALIGN",     (6, 0), (-1, -1), "RIGHT"),
        ("LINEABOVE", (0, 0), (-1, 0), 1.5, GEB_DARK),
        ("TOPPADDING",(0, 0), (-1, -1), 4),
    ]))

    # Conditions table
    cond_labels = ["Prazo de pagamento", "Frete", "Disponibilidade", "Validade da cotação"]
    cond_vals   = [args.payment, args.frete, args.disponibilidade, args.validade]
    cond_data   = [
        [Paragraph(lb, label_style) for lb in cond_labels],
        [Paragraph(v,  val_style)   for v  in cond_vals],
    ]
    cond_t = Table(cond_data, colWidths=["25%"] * 4)
    cond_t.setStyle(TableStyle([
        ("BACKGROUND",  (0, 0), (-1, -1), colors.HexColor("#FAF8F7")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING",  (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING",(0,-1),(-1,-1), 8),
        ("LINEAFTER",   (0, 0), (-1, -1), 0, WHITE),
    ]))

    # Header paragraph
    header_para = Paragraph(
        f"<font size='18'><b>GE Beauty</b></font><br/>"
        f"<font size='10'>Cotação Atacado &nbsp;|&nbsp; {args.date}</font>",
        ParagraphStyle("hd", fontName="Helvetica-Bold", fontSize=18,
                       textColor=WHITE, leading=22),
    )
    client_para = Paragraph(
        f"<b>Para:</b> {args.client_name}",
        ParagraphStyle("cl", fontName="Helvetica", fontSize=9,
                       textColor=colors.HexColor("#FAF8F7"), leading=12),
    )

    # Header block table (red background)
    hdr_data = [[header_para, client_para]]
    hdr_t = Table(hdr_data, colWidths=["60%", "40%"])
    hdr_t.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (-1, -1), GEB_RED),
        ("LEFTPADDING",  (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING",   (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 10),
        ("ALIGN",        (1, 0), (1, 0),   "RIGHT"),
        ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
    ]))

    footer_para = Paragraph(
        "GE COSMÉTICOS LTDA. – 34.987.157/0001-74 | "
        "Proposta sujeita a confirmação de estoque no momento de confirmação da compra.",
        ParagraphStyle("ft", fontName="Helvetica", fontSize=7,
                       textColor=GEB_GREY, leading=10),
    )

    story = [hdr_t, Spacer(1, 4*mm), t, Spacer(1, 2*mm)]
    if not args.no_grand_total:
        story += [totals_t, Spacer(1, 4*mm)]
    story += [cond_t, Spacer(1, 4*mm), footer_para]

    doc.build(story)
    size_kb = out_path.stat().st_size // 1024
    print(f"\nPDF written: {out_path} ({size_kb} kB)")
    print(f"  Total unidades: {fmt_units_plain(total_units)}")
    print(f"  Valor total:    {fmt_brl_plain(total_value)}")



# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description="GE Beauty B2B proposal generator")
    p.add_argument("--mode",            default="full", choices=["full", "lite"],
                   help="full=HTML+images, lite=PDF no images (default: full)")
    p.add_argument("--client-name",     default="Cliente",
                   help="Legal / full client name")
    p.add_argument("--client-display",  default="",
                   help="Short display name (defaults to --client-name)")
    p.add_argument("--payment",         default="A combinar",
                   help="Prazo de pagamento")
    p.add_argument("--frete",           default="CIF para São Paulo",
                   help="Frete condition")
    p.add_argument("--disponibilidade", default="Pronta entrega",
                   help="Disponibilidade")
    p.add_argument("--validade",        default="7 dias",
                   help="Validade da cotação")
    p.add_argument("--date",            default=today_ptbr(),
                   help="Date string shown on the proposal (pt-BR)")
    p.add_argument("--out",             default="",
                   help="Output file path. Derived from client name if omitted.")
    p.add_argument("--no-grand-total",  action="store_true",
                   help="Omit the grand-total strip; per-line Valor Total acts as line subtotal.")
    p.add_argument("--drive-folder",    default="",
                   help="If set and the folder exists, copy the output there after writing locally. "
                        "E.g. 'G:/Drives compartilhados/GEB_Comercial/Boxes/Uau Box/002_jul-26'")
    return p.parse_args()


def main():
    args = parse_args()
    if not args.client_display:
        args.client_display = args.client_name

    if not args.out:
        args.out = default_out(args.client_name, args.mode, args.date)

    print(f"Reading simulator data from Excel...")
    rows = read_excel_rows()
    if not rows:
        print("[!] No data rows found in simulator (rows 55–69, col B=SKU).")
        print("    Fill the PROPOSTA EM CONSTRUÇÃO area in the Dashboard sheet first.")
        sys.exit(1)

    print(f"  {len(rows)} product line(s) found")
    for r in rows:
        print(f"  {r['sku']}  {r['produto'][:30]:<30}  vol={r['volume']}  "
              f"preco={fmt_brl_plain(r['preco_unit'])}  retail={fmt_brl_plain(r['retail'])}")

    print(f"\nMode: {args.mode}")
    print(f"Client: {args.client_name}")
    print(f"Output: {args.out}")
    print()

    if args.mode == "full":
        run_full(rows, args)
    else:
        run_lite(rows, args)

    # Drive copy — format-based rule: PDF → Drive, HTML → local only
    if args.drive_folder and Path(args.out).suffix.lower() == ".pdf":
        import shutil
        drive_dir = Path(args.drive_folder)
        if drive_dir.exists():
            drive_out = drive_dir / Path(args.out).name
            shutil.copy2(args.out, str(drive_out))
            print(f"  Drive copy:     {drive_out}")
        else:
            print(f"  [!] --drive-folder not found, skipping: {drive_dir}")


if __name__ == "__main__":
    main()
