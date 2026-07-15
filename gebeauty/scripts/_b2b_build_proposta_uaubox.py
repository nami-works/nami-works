"""
Build UAU Box B2B proposal HTML (same format as _b2b_build_proposta_canonical.py).
Fetches product images live from Shopify, then writes a self-contained HTML.
Open in browser → Ctrl+P → Save as PDF (landscape A4, margins: minimum).

Run:
  C:/Python314/python.exe gebeauty/scripts/_b2b_build_proposta_uaubox.py
"""
import json, sys, io, base64, urllib.request
from pathlib import Path
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")

ROOT    = Path(__file__).resolve().parent
ENV     = ROOT.parent / ".env"
OUT_HTML = ROOT.parent / "B2B_Proposta_UAUBox_20260701.html"

# ── Credentials ───────────────────────────────────────────────────────────────
env = {}
for line in ENV.read_text(encoding="utf-8").splitlines():
    if "=" in line and not line.startswith("#"):
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip()
TOKEN = env["SHOPIFY_ADMIN_ACCESS_TOKEN"]
GQL_URL = "https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json"

# ── Proposal data ─────────────────────────────────────────────────────────────
# (sku_norm, display_name, vol_label, retail, qty, preco_atacado)
PROPOSTA = [
    ("GEB024", "Melon Mood Body &amp; Hair Mist", "200 ml", 129.00, 20000, 45.15),
    ("GEB001", "Shampoo Sem Sulfato",             "250 ml",  95.00, 20000, 33.25),
    ("GEB002", "M&aacute;scara Condicionadora",   "200 ml",  95.00, 20000, 33.25),
    ("GEB121", "M&aacute;scara Reconstrutora Mayday", "200 g", 139.00, 20000, 48.65),
    ("GEB003", "Leave-in com Prote&ccedil;&atilde;o T&eacute;rmica", "150 ml", 99.00, 20000, 34.65),
]

# ── Shopify handles (canonical ACTIVE product, not assinatura) ────────────────
HANDLES = {
    "GEB024": "melon-mood-body-hair-mist",
    "GEB001": "shampoo-sem-sulfato",
    "GEB002": "mascara-condicionadora",
    "GEB121": "mascara-mayday",
    "GEB003": "leave-in-com-protecao-termica",
}

# ── Logo URLs ─────────────────────────────────────────────────────────────────
LOGO_URLS = [
    "https://cdn.shopify.com/s/files/1/0807/8344/2240/files/ge_beauty_logo-01_copia.svg?v=1696611815",
    "https://cdn.shopify.com/s/files/1/0807/8344/2240/files/ge_beauty_logo_horizontal.png?v=1777325446",
]

# ── Helpers ───────────────────────────────────────────────────────────────────
def fetch_bytes(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            ct = r.headers.get("Content-Type", "image/jpeg").split(";")[0]
            return r.read(), ct
    except Exception as e:
        print(f"  [!] {url[:70]}: {e}")
        return None, None

def gql(query):
    body = json.dumps({"query": query}).encode()
    req  = urllib.request.Request(GQL_URL, data=body, headers={
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN,
    })
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def thumb_b64(raw_bytes, size=(60, 60)):
    try:
        img = Image.open(io.BytesIO(raw_bytes)).convert("RGBA")
        w, h = img.size
        m     = min(w, h)
        img   = img.crop(((w-m)//2, (h-m)//2, (w+m)//2, (h+m)//2))
        img   = img.resize(size, Image.LANCZOS)
        buf   = io.BytesIO()
        img.save(buf, format="WebP", quality=72)
        return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception as e:
        print(f"  [!] thumb error: {e}")
        return None

def fmt_brl(v):
    s = f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$&thinsp;{s}"

def fmt_units(n):
    return f"{n:,.0f}".replace(",", ".") + "&nbsp;un"

def desc_pct(varejo, atacado):
    return f"{round((varejo - atacado) / varejo * 100):.0f}%"

# ── Fetch logo ────────────────────────────────────────────────────────────────
print("Fetching logo...")
logo_b64 = logo_mime = None
for url in LOGO_URLS:
    data, ct = fetch_bytes(url)
    if data:
        logo_b64 = f"data:{ct};base64,{base64.b64encode(data).decode()}"
        logo_mime = ct
        print(f"  ok ({len(data)//1024}kB) {ct}")
        break

# ── Fetch product images from Shopify ─────────────────────────────────────────
print("Fetching product images from Shopify...")
thumbs = {}
for sku_norm, _, _, _, _, _ in PROPOSTA:
    handle = HANDLES[sku_norm]
    q = f'{{ productByHandle(handle: "{handle}") {{ featuredImage {{ url }} }} }}'
    resp = gql(q)
    p    = resp["data"]["productByHandle"]
    if p and p.get("featuredImage"):
        img_url = p["featuredImage"]["url"]
        raw, _  = fetch_bytes(img_url)
        if raw:
            thumbs[sku_norm] = thumb_b64(raw)
            print(f"  {sku_norm}: ok")
        else:
            thumbs[sku_norm] = None
            print(f"  {sku_norm}: image fetch failed")
    else:
        thumbs[sku_norm] = None
        print(f"  {sku_norm}: no image")

# ── Build table rows ──────────────────────────────────────────────────────────
rows_html  = ""
total_units = 0
total_value = 0.0
for sku_norm, display_name, vol, retail, qty, atacado in PROPOSTA:
    thumb = thumbs.get(sku_norm)
    pct   = desc_pct(retail, atacado)
    line_total = qty * atacado
    total_units += qty
    total_value += line_total
    sku_display = sku_norm[:3] + " " + sku_norm[3:]

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
          <td class="td-num">{fmt_brl(retail)}</td>
          <td class="td-num">{fmt_units(qty)}</td>
          <td class="td-num">{fmt_brl(atacado)}</td>
          <td class="td-sellout">{pct}</td>
          <td class="td-total">{fmt_brl(line_total)}</td>
        </tr>"""

# ── Logo element ──────────────────────────────────────────────────────────────
if logo_b64:
    logo_el = f'<img class="brand-logo" src="{logo_b64}" alt="GE Beauty">'
else:
    logo_el = '<span class="brand-name-txt">GE Beauty</span>'

# ── Full HTML (same template as canonical) ────────────────────────────────────
html = f"""<title>Cota&ccedil;&atilde;o UAU Box &mdash; GE Beauty</title>
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

  .doc-header {{
    background: #DF3630;
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

  thead tr {{ border-bottom: 2px solid #DF3630; }}

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
    color: #DF3630;
  }}

  .conditions {{
    margin: 12px 48px 0;
    padding: 10px 16px;
    background: #FAF8F7;
    border-left: 3px solid #DF3630;
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

  @media print {{
    html {{ zoom: 0.95; }}
    body {{ background: white; padding: 0; }}
    .document {{ box-shadow: none; width: 100%; }}
    @page {{ size: A4 landscape; margin: 3mm 6mm; }}
  }}
</style>

<div class="document">

  <div class="doc-header">
    <div class="brand-block">
      {logo_el}
    </div>
    <div class="doc-meta-right">
      <div class="doc-date">01 de julho de 2026</div>
    </div>
  </div>

  <div class="meta-strip">
    <div class="meta-cell">
      <div class="meta-eyebrow">Para</div>
      <div class="meta-primary">UAUBOX S.A.</div>
      <div class="meta-secondary">Cota&ccedil;&atilde;o para compra em atacado &nbsp;&middot;&nbsp; Validade: 7 dias</div>
    </div>
    <div class="meta-cell right">
      <div class="meta-eyebrow">Contato</div>
      <div class="meta-primary">Lucas Guimar&atilde;es</div>
      <div class="meta-secondary">lucas@gebeauty.com.br &nbsp;&middot;&nbsp; (11) 97277-6427</div>
    </div>
  </div>

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
          <th class="c">Pre&ccedil;o<br>Varejo</th>
          <th class="c">Qtd.</th>
          <th class="c">Pre&ccedil;o<br>Atacado</th>
          <th class="c">Desc. s/<br>Tabela</th>
          <th class="c">Valor<br>Total</th>
        </tr>
      </thead>
      <tbody>{rows_html}
      </tbody>
    </table>
  </div>

  <div class="totals">
    <div class="total-item">
      <div class="total-label">Total de Unidades</div>
      <div class="total-val">{fmt_units(total_units)}</div>
    </div>
    <div class="total-item">
      <div class="total-label">Valor Total da Proposta</div>
      <div class="total-val accent">{fmt_brl(total_value)}</div>
    </div>
  </div>

  <div class="conditions">
    <div class="cond-eyebrow">Condi&ccedil;&otilde;es Comerciais</div>
    <div class="cond-grid">
      <div>
        <div class="cond-key">Prazo de pagamento</div>
        <div class="cond-val">A combinar</div>
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

  <div class="doc-footer">
    <div class="footer-copy">
      GE COSM&Eacute;TICOS LTDA. &nbsp;&ndash;&nbsp; 34.987.157/0001-74<br>
      Proposta sujeita a confirma&ccedil;&atilde;o de estoque no momento de confirma&ccedil;&atilde;o da compra.
    </div>
  </div>

</div>
"""

OUT_HTML.write_text(html, encoding="utf-8")
size_kb = OUT_HTML.stat().st_size // 1024
print(f"\nHTML: {OUT_HTML}  ({size_kb} kB)")
print(f"  {len(PROPOSTA)} SKUs | {fmt_units(total_units)} | {fmt_brl(total_value)}")
print(f"\nAbrir no browser -> Ctrl+P -> Salvar como PDF (A4 paisagem, margens minimas)")
