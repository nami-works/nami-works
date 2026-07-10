"""
Build client-facing Magenta proposal HTML (landscape A4) with:
  - GE Beauty logo embedded as base64
  - Product images resized to thumbnails
  - Retail prices + % discount vs retail
  - Sorted by volume desc

Run:
  C:/Python314/python.exe gebeauty/scripts/_b2b_build_proposta_html.py
"""
import json, sys, io, base64, urllib.request
from pathlib import Path
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")

ROOT     = Path(__file__).resolve().parent
ASSETS   = ROOT / "_b2b_magenta_assets.json"
OUT_HTML = Path.home() / "AppData/Local/Temp/claude/c--Users-Lucas-Guimar-es-Desktop-nami-works/a2c061e3-8713-4ea9-b77f-5ab2d67ebe63/scratchpad/proposta-magenta.html"

# ── Proposal data ─────────────────────────────────────────────────────────────
# (SKU, display_name, qty_units, proposal_price)  — sorted by qty desc, then total desc
PROPOSTA = [
    ("GEB024", "Melon Mood Body &amp; Hair Mist",   5000, 28.50),
    ("GEB102", "Primer Liso Intacto",               4000, 31.00),
    ("GEB029", "Melon Mood Body &amp; Hair Mist",   4000, 23.45),
    ("GEB023", "Booster Antioxidante",              3000, 24.65),
    ("GEB011", "Finalizador Leave-in",              3000, 12.00),
    ("GEB013", "Shampoo Sem Sulfato",               3000, 11.00),
    ("GEB010", "M&aacute;scara Condicionadora",     3000, 11.00),
    ("GEB022", "Booster Antifrizz",                 2000, 22.70),
    ("GEB008", "Shampoo a Seco",                    1000, 18.00),
]

# ── Product volumes (ml) — sourced from products.json ─────────────────────────
VOLS = {
    "GEB024": "200 ml",
    "GEB102": "150 ml",
    "GEB029": "100 ml",
    "GEB023": "15 ml",
    "GEB011": "50 ml",
    "GEB013": "60 ml",
    "GEB010": "50 ml",
    "GEB022": "15 ml",
    "GEB008": "150 ml",
}

# ── Logo URLs to try (SVG preferred — transparent bg works on colored header) ──
LOGO_URLS = [
    "https://cdn.shopify.com/s/files/1/0807/8344/2240/files/ge_beauty_logo-01_copia.svg?v=1696611815",
    "https://cdn.shopify.com/s/files/1/0807/8344/2240/files/ge_beauty_logo_horizontal.png?v=1777325446",
]

# ── Helpers ────────────────────────────────────────────────────────────────────
def fetch_b64_raw(url):
    """Download URL, return (data_bytes, mime_type)."""
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            ct = r.headers.get("Content-Type", "application/octet-stream").split(";")[0]
            return r.read(), ct
    except Exception as e:
        print(f"  [!] {url[:60]}: {e}")
        return None, None

def resize_and_b64(img_b64, size=(80, 80)):
    """Decode base64 image, resize to square, re-encode as WebP data URI."""
    try:
        raw = base64.b64decode(img_b64.split(",", 1)[1])
        img = Image.open(io.BytesIO(raw)).convert("RGBA")
        # Square crop from center
        w, h = img.size
        m     = min(w, h)
        img   = img.crop(((w - m) // 2, (h - m) // 2, (w + m) // 2, (h + m) // 2))
        img   = img.resize(size, Image.LANCZOS)
        buf   = io.BytesIO()
        img.save(buf, format="WebP", quality=72)
        b64   = base64.b64encode(buf.getvalue()).decode()
        return f"data:image/webp;base64,{b64}"
    except Exception as e:
        print(f"  [!] resize error: {e}")
        return None

def fmt_brl(v):
    """Format float as Brazilian R$ — e.g. 28.50 → 'R$&thinsp;28,50'"""
    s = f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$&thinsp;{s}"

def fmt_units(n):
    """1000 → '1.000 un'"""
    return f"{n:,.0f}".replace(",", ".") + "&nbsp;un"

def sellout_pct(proposal, retail):
    if not retail or not proposal: return "—"
    pct = (1 - proposal / retail) * 100
    return f"{pct:.0f}%"

# ── Load assets ────────────────────────────────────────────────────────────────
print("Loading assets JSON...")
assets = json.loads(ASSETS.read_text(encoding="utf-8"))
products = assets["products"]

# ── Logo ───────────────────────────────────────────────────────────────────────
print("Fetching logo...")
logo_b64 = None
logo_mime = None
for logo_url in LOGO_URLS:
    data, ct = fetch_b64_raw(logo_url)
    if data:
        logo_b64 = f"data:{ct};base64,{base64.b64encode(data).decode()}"
        logo_mime = ct
        print(f"  logo ok ({len(data)//1024}kB) {ct}")
        break

# ── Product thumbnails ─────────────────────────────────────────────────────────
print("Resizing product images...")
thumbs = {}
for sku_norm, _, _, _ in PROPOSTA:
    sku_key = sku_norm  # e.g. "GEB024"
    p = products.get(sku_key, {})
    img_b64 = p.get("image")
    if img_b64:
        thumb = resize_and_b64(img_b64, (60, 60))
        thumbs[sku_key] = thumb
        print(f"  {sku_key}: {'ok' if thumb else 'failed'}")
    else:
        thumbs[sku_key] = None
        print(f"  {sku_key}: no image")

# ── Build table rows ───────────────────────────────────────────────────────────
rows_html = ""
for sku_norm, display_name, qty, proposal_price in PROPOSTA:
    p      = products.get(sku_norm, {})
    retail = p.get("compareAtPrice") or p.get("price") or 0
    thumb  = thumbs.get(sku_norm)
    pct    = sellout_pct(proposal_price, retail)
    vol    = VOLS.get(sku_norm, "—")
    sku_display = sku_norm[:3] + " " + sku_norm[3:]  # "GEB024" → "GEB 024"

    img_tag = ""
    if thumb:
        img_tag = f'<img class="prod-img" src="{thumb}" alt="{display_name}" loading="lazy">'

    rows_html += f"""
        <tr>
          <td class="td-name">
            <div class="name-cell">
              {img_tag}
              <span class="name-text">{display_name}</span>
            </div>
          </td>
          <td class="td-vol">{vol}</td>
          <td class="td-ref">{sku_display}</td>
          <td class="td-num">{fmt_brl(retail) if retail else '—'}</td>
          <td class="td-num">{fmt_units(qty)}</td>
          <td class="td-num">{fmt_brl(proposal_price)}</td>
          <td class="td-sellout">{pct}</td>
        </tr>"""

# ── Logo element ───────────────────────────────────────────────────────────────
if logo_b64 and "svg" in (logo_mime or ""):
    # SVG: embed as <img>. The logo is likely white-on-transparent.
    logo_el = f'<img class="brand-logo" src="{logo_b64}" alt="GE Beauty">'
elif logo_b64:
    logo_el = f'<img class="brand-logo" src="{logo_b64}" alt="GE Beauty">'
else:
    # Fallback: styled text
    logo_el = '<span class="brand-name-txt">GE Beauty</span>'

# ── Full HTML ─────────────────────────────────────────────────────────────────
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

  .ph {{ color: #C0B5B3; font-weight: 400; font-style: italic; }}

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
      <div class="doc-date">01 de julho de 2026</div>
    </div>
  </div>

  <!-- Meta strip -->
  <div class="meta-strip">
    <div class="meta-cell">
      <div class="meta-eyebrow">Para</div>
      <div class="meta-primary">Magenta Com&eacute;rcio de Cosm&eacute;ticos Ltda.</div>
      <div class="meta-secondary">Cota&ccedil;&atilde;o para compra em atacado &nbsp;&middot;&nbsp; Validade: 7 dias</div>
    </div>
    <div class="meta-cell right">
      <div class="meta-eyebrow">Contato</div>
      <div class="meta-primary">Lucas Guimar&atilde;es</div>
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
      </colgroup>
      <thead>
        <tr>
          <th>Produto</th>
          <th class="c">Vol.</th>
          <th class="c">Ref.</th>
          <th class="c">Pre&ccedil;o<br>Varejo</th>
          <th class="c">Qtd.</th>
          <th class="c">Pre&ccedil;o<br>Atacado</th>
          <th class="c">Desc. s/<br>Tabela</th>
        </tr>
      </thead>
      <tbody>{rows_html}
      </tbody>
    </table>
  </div>

  <!-- Conditions -->
  <div class="conditions">
    <div class="cond-eyebrow">Condi&ccedil;&otilde;es Comerciais</div>
    <div class="cond-grid">
      <div>
        <div class="cond-key">Prazo de pagamento</div>
        <div class="cond-val">30 dias</div>
      </div>
      <div>
        <div class="cond-key">Frete</div>
        <div class="cond-val">CIF para S&atilde;o Paulo</div>
      </div>
      <div>
        <div class="cond-key">Disponibilidade</div>
        <div class="cond-val">Pronta entrega</div>
      </div>
      <div>
        <div class="cond-key">Validade da cota&ccedil;&atilde;o</div>
        <div class="cond-val">7 dias</div>
      </div>
    </div>
  </div>

  <!-- Footer -->
  <div class="doc-footer">
    <div class="footer-copy">
      GE COSM&Eacute;TICOS LTDA. &nbsp;&ndash;&nbsp; 34.987.157/0001-74<br>
      Proposta sujeita a confirma&ccedil;&atilde;o de estoque no momento de confirma&ccedil;&atilde;o da compra.
    </div>
  </div>

</div>
"""

# ── Write HTML ────────────────────────────────────────────────────────────────
OUT_HTML.parent.mkdir(parents=True, exist_ok=True)
OUT_HTML.write_text(html, encoding="utf-8")
size_kb = OUT_HTML.stat().st_size // 1024
print(f"\nHTML written: {OUT_HTML.name} ({size_kb} kB)")
