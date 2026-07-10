"""
B2B Excel Dashboard Generator — GE Beauty v7
Changes from v6:
  · No merged cells — all spanning uses centerContinuous (Centralizar seleção)
  · Default row height 10.5; spacer rows never shrunk
  · Title/section bars: fill applied across all cells, text overflows from col B

Formula authoring rule (OOXML invariant):
  English tokens (SUMIF, IF, XLOOKUP…) + comma separators.
  pt-BR Excel renders them as SOMASE/SE/; automatically.
"""

import sys, json, time, urllib.request, urllib.error
from pathlib import Path
from datetime import datetime
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.styles.differential import DifferentialStyle
from openpyxl.chart import BarChart, Reference

ROOT      = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from box_deal_simulator import COGS, load_history, _norm_sku

OUT_LOCAL = ROOT.parent / "B2B_Box_Dashboard.xlsx"
OUT_DRIVE = Path(r"G:\Drives compartilhados\GEB_Comercial\Boxes\GEB_B2B_Box_Dashboard.xlsx")
OUT = OUT_DRIVE if OUT_DRIVE.parent.exists() else OUT_LOCAL

PROD_URL    = "https://app.omie.com.br/api/v1/geral/produtos/"
_OMIE_RETRY = ("requisi", "consumo", "soap-env:server", "redundante",
               "number of requests", "limite de req")

# ── Layout constants (padding applied) ────────────────────────────────────────
PCOL = 1    # one padding column (A) on every sheet
PROW = 1    # one padding row (row 1) on every sheet

# Histórico columns (B–O, with PCOL=1)
H_TIT = 2       # title bar row
H_HDR = 3       # column-header row
H_DAT = 4       # first data row
H_MAX = 503     # max range row for cross-sheet formulas (~500 deals)
HCL   = ["B","C","D","E","F","G","H","I","J","K","L","M","N","O"]
# B=Operador C=Data D=NF E=Status F=ID_Deal G=SKU H=Produto I=Volume
# J=Preco K=Retail_hist L=Desconto_pct M=GM_pct N=Mês O=Receita

# COGS columns (B–G, with PCOL=1)
C_TIT = 2
C_HDR = 3
C_DAT = 4
CCL   = ["B","C","D","E","F","G"]
# B=SKU C=Produto D=COGS_ES E=COGS_SP F=Retail G=Fonte

# Dashboard rows
D_TIT = 2   # title bar row

# Dashboard client filter cell
FILT = "$D$4"    # (was $C$3 before padding: +1 col, +1 row)
FLT_ROW = 4
FLT_COL = 4      # column D
FLT_COL_END = 7  # merged to column G

# Dashboard chart helper (visible, cols B–D, rows 13–25)
CH_HDR = 13
CH_DAT = 14
CH_END = 25           # CH_DAT + 11 (12 months)
CH_LBL_COL = 2        # col B: text label
CH_DTC_COL = 3        # col C: date value
CH_RVC_COL = 4        # col D: SUMIF revenue
CH_ANC     = "F8"     # chart anchor cell

# Dashboard ledger (starts at row 29, after chart data + buffer)
L_SEC = 29    # section bar
L_HDR = 30    # column headers
L_DAT = 31    # first data row

N_DATA_ROWS = 15   # proposta rows

PT_MONTHS = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"]

# ── Palette (matches GE Beauty BP reference) ───────────────────────────────────
C_RED    = "FFDF3630"   # GEB red — all header fills (replaces old black)
C_LGREY  = "FFF4F3F0"   # alternating data row
C_INPUT  = "FFFFF2CC"   # editable input cells (#FFF2CC from BP convention)
C_CALC   = "FFF7F7F7"   # formula/read-only cells
C_WHITE  = "FFFFFFFF"
C_OK     = "FF1F7A3E"
C_WARN   = "FFB83010"
C_ACCENT = "FF1E4FBE"
C_BLUE_L = "FFE8EFF8"   # KPI tile background

# ── Number formats (0 decimals per Lucas's preference) ─────────────────────────
FMT_BRL = '"R$" #,##0'
FMT_PCT = '0%'
FMT_INT = '#,##0'
FMT_DAT = 'DD/MM/YYYY'
FMT_MES = 'MM/YYYY'

# ── Style helpers ──────────────────────────────────────────────────────────────
def font(size=8, bold=False, color="FF000000", italic=False):
    return Font(name="Calibri", size=size, bold=bold, color=color, italic=italic)

def fill(rgb):
    return PatternFill("solid", fgColor=rgb)

def align(h="left", v="center", wrap=False):
    return Alignment(horizontal=h, vertical=v, wrap_text=wrap)

_T = Side(style="thin",   color="FFD8D8D8")
_M = Side(style="medium", color="FFBFBFBF")

def border(bottom=None, top=None, left=None, right=None):
    return Border(bottom=bottom, top=top, left=left, right=right)

def pad_col(ws, width=2.5):
    ws.column_dimensions["A"].width = width
    ws.sheet_format.defaultRowHeight = 10.5
    ws.sheet_format.customHeight = True

# ── Product catalog (canonical SKU format) ─────────────────────────────────────
def _load_catalog():
    pj = ROOT.parent / "products.json"
    if not pj.exists():
        return {}, {}
    data = json.loads(pj.read_text(encoding="utf-8"))
    sku_map  = {p["sku"].upper().replace(" ","").replace("-",""):  p["sku"]       for p in data}
    name_map = {p["sku"].upper().replace(" ","").replace("-",""): (p.get("name_pt") or "") for p in data}
    return sku_map, name_map

def _canonical(norm_sku, sku_map):
    return sku_map.get(norm_sku, norm_sku)

# ── Shopify price fetch ────────────────────────────────────────────────────────
def _fetch_shopify_prices():
    env_path = ROOT.parent / ".env"
    token = shop = None
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                v = v.strip('"').strip("'")
                if k.strip() == "SHOPIFY_ADMIN_ACCESS_TOKEN": token = v
                elif k.strip() == "SHOPIFY_SHOP_DOMAIN":      shop  = v
    if not token or not shop:
        print("  [!] .env missing — usando preços do dict COGS"); return {}

    query = """{
      products(first:250,query:"product_type:product OR product_type:acessorio"){
        edges{node{variants(first:5){edges{node{sku price}}}}}}}"""
    url  = f"https://{shop}/admin/api/2026-01/graphql.json"
    body = json.dumps({"query": query}).encode("utf-8")
    req  = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": token})
    prices = {}
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read())
        for pe in data["data"]["products"]["edges"]:
            for ve in pe["node"]["variants"]["edges"]:
                v = ve["node"]
                sku = v.get("sku","").upper().replace(" ","").replace("-","")
                if sku and v.get("price"):
                    prices[sku] = float(v["price"])
        print(f"  Shopify: {len(prices)} preços obtidos")
    except Exception as exc:
        print(f"  [!] Shopify falhou ({exc}) — usando dict COGS")
    return prices

# ── Omie stock fetch ───────────────────────────────────────────────────────────
def _omie_call(url, ak, as_, method, param, retries=3):
    body = json.dumps({"app_key": ak, "app_secret": as_,
                       "call": method, "param": [param]}).encode()
    last = None
    for attempt in range(retries):
        time.sleep(1.2)
        try:
            req = urllib.request.Request(
                url, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            txt = e.read().decode("utf-8", "replace"); last = {"_error": txt}
            if any(m in txt.lower() for m in _OMIE_RETRY):
                time.sleep(10 * (attempt + 1)); continue
            return last
        except Exception as e:
            last = {"_error": str(e)}
    return last or {"_error": "exhausted"}


def _load_omie_connections():
    env_path = ROOT.parent / ".env"
    if not env_path.exists():
        return []
    conns, label, pending = [], None, {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if s.startswith("##"):
            if label and pending.get("app_key") and pending.get("app_secret"):
                conns.append({"label": label, **pending})
            label, pending = s.lstrip("#").strip(), {}
            continue
        if s.startswith("#") or "=" not in s:
            continue
        k, v = (x.strip() for x in s.split("=", 1))
        if "OMIE_APP_KEY" in k:    pending["app_key"]    = v
        if "OMIE_APP_SECRET" in k: pending["app_secret"] = v
    if label and pending.get("app_key") and pending.get("app_secret"):
        conns.append({"label": label, **pending})
    return conns


def _fetch_company_stock(ak, as_, label):
    """Returns {norm_sku: qty} for GEB* products in one Omie company."""
    stock = {}
    page  = 1
    while True:
        res = _omie_call(PROD_URL, ak, as_, "ListarProdutos", {
            "pagina": page, "registros_por_pagina": 50,
            "apenas_importado_api": "N", "filtrar_apenas_omiepdv": "N",
        })
        if "_error" in res:
            print(f"  [estoque {label}] p{page}: {res['_error'][:80]}")
            break
        for p in res.get("produto_servico_cadastro") or []:
            raw = (p.get("codigo") or "").upper()
            norm = raw.replace(" ", "").replace("-", "")
            if not norm.startswith("GEB"):
                continue
            qty = float(p.get("quantidade_estoque") or 0)
            stock[norm] = stock.get(norm, 0) + qty
        total_pages = res.get("total_de_paginas") or 1
        if page >= total_pages:
            break
        page += 1
    return stock


def _fetch_omie_stock():
    """
    Returns {norm_sku: {"cd": qty, "lojas": qty}}.
    CD    = EXTREMA (distribution center)
    Lojas = POS companies (SHOPPING RECIFE, SHOPS JARDINS, RIO SUL, RIO MAR RECIFE)
    MATRIZ is skipped — billing entity, not a physical stock location.
    """
    _CD_KEYS   = {"EXTREMA"}
    _SKIP_KEYS = {"MATRIZ"}
    result     = {}

    for conn in _load_omie_connections():
        lbl_up = conn["label"].upper()
        if any(k in lbl_up for k in _SKIP_KEYS):
            continue
        bucket  = "cd" if any(k in lbl_up for k in _CD_KEYS) else "lojas"
        print(f"  [estoque] {conn['label']} -> {bucket}")
        for norm, qty in _fetch_company_stock(conn["app_key"], conn["app_secret"], conn["label"]).items():
            if norm not in result:
                result[norm] = {"cd": 0.0, "lojas": 0.0}
            result[norm][bucket] += qty
    return result


# ── Data preparation ────────────────────────────────────────────────────────────
def _cogs_rows(shopify_prices, sku_map, name_map):
    rows = []
    for norm, p in COGS.items():
        live   = shopify_prices.get(norm)
        retail = live if live is not None else p.get("retail")
        src    = "Shopify" if live is not None else p.get("src", "?")
        disp_sku  = _canonical(norm, sku_map)
        disp_name = name_map.get(norm) or p["name"]
        rows.append([disp_sku, disp_name, p.get("cogs_es"), p.get("cogs_sp"), retail, src])
    return rows

def _expand_history(history, sku_map, name_map):
    rows = []
    for deal in history:
        deal_id  = deal.get("id", f"{deal['operator']}-{deal['date']}")
        date_val = datetime.strptime(deal["date"], "%Y-%m-%d")
        for line in deal.get("lines", []):
            norm      = _norm_sku(line["sku"])
            disp_sku  = _canonical(norm, sku_map)
            disp_name = name_map.get(norm) or COGS.get(norm, {}).get("name", "?")
            rows.append([deal["operator"], date_val, deal.get("nf"),
                         deal.get("status","completed"), deal_id,
                         disp_sku, disp_name, line["volume"], line["price"],
                         line.get("retail_at_time")])
    return rows

# ── Entry point ─────────────────────────────────────────────────────────────────
def build():
    sku_map, name_map = _load_catalog()
    history           = load_history()
    shopify_prices    = _fetch_shopify_prices()
    history_lines     = _expand_history(history, sku_map, name_map)
    cogs_rows         = _cogs_rows(shopify_prices, sku_map, name_map)
    operators         = sorted(set(r[0] for r in history_lines))

    print("  Buscando estoque Omie...")
    stock_by_sku = _fetch_omie_stock()
    updated_at   = datetime.now()

    if OUT.exists():
        # Load existing file — Dashboard (manual edits + chart) is preserved.
        # COGS, Histórico, and Estoque are always regenerated.
        wb = openpyxl.load_workbook(str(OUT))
        for name in ["COGS", "Histórico", "Estoque"]:
            if name in wb.sheetnames:
                del wb[name]
        ws_cogs = wb.create_sheet("COGS")
        ws_hist = wb.create_sheet("Histórico")
        ws_est  = wb.create_sheet("Estoque")
    else:
        wb = openpyxl.Workbook()
        wb.remove(wb.active)
        ws_dash = wb.create_sheet("Dashboard")
        ws_cogs = wb.create_sheet("COGS")
        ws_hist = wb.create_sheet("Histórico")
        ws_est  = wb.create_sheet("Estoque")
        ws_dash.sheet_properties.tabColor = "DF3630"
        _build_dashboard(ws_dash, len(cogs_rows), history_lines, operators)

    ws_cogs.sheet_properties.tabColor = "595959"
    ws_hist.sheet_properties.tabColor = "595959"
    ws_est.sheet_properties.tabColor  = "595959"

    _build_cogs(ws_cogs, cogs_rows)
    _build_historico(ws_hist, history_lines, len(cogs_rows))
    _build_estoque(ws_est, stock_by_sku, sku_map, name_map, updated_at)

    if "Dashboard" in wb.sheetnames:
        wb.active = wb["Dashboard"]

    def _save(wb, path):
        try:
            wb.save(str(path))
            print(f"Salvo: {path}")
        except PermissionError:
            alt = path.parent / (path.stem + "_new" + path.suffix)
            wb.save(str(alt))
            print(f"[!] {path.name} bloqueado (feche o Excel). Salvo como: {alt.name}")

    _save(wb, OUT)
    if OUT != OUT_LOCAL:
        _save(wb, OUT_LOCAL)

# ── COGS sheet ─────────────────────────────────────────────────────────────────
def _build_cogs(ws, rows):
    pad_col(ws)
    widths = [10, 34, 12, 12, 12, 10]
    for i, w in enumerate(widths, 1 + PCOL):
        ws.column_dimensions[get_column_letter(i)].width = w

    ws.row_dimensions[C_TIT].height = 18
    ws.row_dimensions[C_HDR].height = 26
    _title_bar(ws, C_TIT, "GE Beauty — B2B · Base COGS", ncols=6)

    for ci, h in enumerate(["SKU","Produto","COGS ES","COGS SP","Retail","Fonte"], 2):
        cell = ws.cell(C_HDR, ci, value=h)
        cell.font      = font(8, bold=True, color=C_WHITE)
        cell.fill      = fill(C_RED)
        cell.alignment = align("center","center",wrap=True)

    cogs_last = C_DAT + len(rows) - 1
    for r, row_data in enumerate(rows, C_DAT):
        bg = C_LGREY if r % 2 == 0 else C_WHITE
        for ci, val in enumerate(row_data, 2):
            cell = ws.cell(r, ci, value=val)
            cell.font      = font(8)
            cell.fill      = fill(bg)
            cell.alignment = align("left" if ci <= 3 else "right","center")
            if ci in (4,5,6) and val is not None:
                cell.number_format = FMT_BRL
            cell.border = border(bottom=_T)

    ws.freeze_panes = f"B{C_DAT}"
    ws.sheet_view.showGridLines = False
    # no Table — plain interval B3:G{cogs_last}

# ── Histórico sheet ────────────────────────────────────────────────────────────
def _build_historico(ws, rows, n_cogs):
    pad_col(ws)
    widths = [14,12,10,12,16,10,30,10,12,12,12,10,12,14,12]
    for i, w in enumerate(widths, 1 + PCOL):
        ws.column_dimensions[get_column_letter(i)].width = w

    ws.row_dimensions[H_TIT].height = 18
    ws.row_dimensions[H_HDR].height = 26
    _title_bar(ws, H_TIT, "GE Beauty — B2B · Histórico de Deals", ncols=15)

    headers = ["Operador","Data","NF","Status","ID_Deal","SKU","Produto","Volume",
               "Preco","Retail_hist","Desconto_pct","GM_pct","Mês","Receita","Último preço"]
    for ci, h in enumerate(headers, 2):
        cell = ws.cell(H_HDR, ci, value=h)
        cell.font      = font(8, bold=True, color=C_WHITE)
        cell.fill      = fill(C_RED)
        cell.alignment = align("center","center",wrap=True)

    cogs_last = C_DAT + n_cogs - 1
    # Build COGS range strings for XLOOKUP in this sheet
    cog_sku = f"COGS!${CCL[0]}${C_DAT}:${CCL[0]}${cogs_last}"
    cog_ces = f"COGS!${CCL[2]}${C_DAT}:${CCL[2]}${cogs_last}"

    for r, row_data in enumerate(rows, H_DAT):
        bg = C_LGREY if r % 2 == 0 else C_WHITE
        op,dt,nf,st,did,sku,nm,vol,prc,ret = row_data
        col_map = {
            2:(op,None,"left"),  3:(dt,FMT_DAT,"center"), 4:(nf,None,"center"),
            5:(st,None,"center"),6:(did,None,"left"),      7:(sku,None,"left"),
            8:(nm,None,"left"),  9:(vol,FMT_INT,"right"),  10:(prc,FMT_BRL,"right"),
            11:(ret,FMT_BRL,"right"),
        }
        for ci,(val,fmt,h) in col_map.items():
            c = ws.cell(r, ci)
            if val is not None: c.value = val
            c.font = font(8); c.fill = fill(bg)
            c.alignment = align(h,"center")
            if fmt: c.number_format = fmt
            c.border = border(bottom=_T)

        # L: Desconto_pct = (Retail-Preco)/Retail
        _fml(ws,r,12, f'=IFERROR(IF(K{r}=0,"",((K{r}-J{r})/K{r})),"")', FMT_PCT,bg,"right")
        # M: GM_pct via INDEX+MATCH to COGS
        _fml(ws,r,13, f'=IFERROR((J{r}-INDEX({cog_ces},MATCH($G{r},{cog_sku},0)))/J{r},"")', FMT_PCT,bg,"right")
        # N: Mês = first day of deal month (for SUMIF in chart)
        _fml(ws,r,14, f'=EOMONTH(C{r},-1)+1', FMT_MES,bg,"center")
        # O: Receita = Preco × Volume
        _fml(ws,r,15, f'=J{r}*I{r}', FMT_BRL,bg,"right")
        # P: Último preço = last price this same client paid for this SKU
        _fml(ws,r,16,
             f'=IFERROR(INDEX($J${H_DAT}:$J${H_MAX},'
             f'MATCH(MAXIFS($C${H_DAT}:$C${H_MAX},$G${H_DAT}:$G${H_MAX},$G{r},$B${H_DAT}:$B${H_MAX},$B{r}),'
             f'$C${H_DAT}:$C${H_MAX},0)),"—")',
             FMT_BRL,bg,"right")

    ws.freeze_panes = f"B{H_DAT}"
    ws.sheet_view.showGridLines = False

# ── Estoque sheet ─────────────────────────────────────────────────────────────
def _build_estoque(ws, stock_by_sku, sku_map, name_map, updated_at):
    E_DAT  = 4
    NCols  = 5

    pad_col(ws)
    for i, w in enumerate([10, 34, 14, 14, 14], 1 + PCOL):
        ws.column_dimensions[get_column_letter(i)].width = w

    ws.row_dimensions[2].height = 18
    ws.row_dimensions[3].height = 26

    ts = updated_at.strftime("%d/%m/%Y %H:%M")
    _title_bar(ws, 2, f"GE Beauty — Estoque Omie  ·  {ts}", ncols=NCols)

    for ci, h in enumerate(["SKU", "Produto", "CD (un.)", "Lojas (un.)", "Total (un.)"], 2):
        cell = ws.cell(3, ci, value=h)
        cell.font      = font(8, bold=True, color=C_WHITE)
        cell.fill      = fill(C_RED)
        cell.alignment = align("center", "center", wrap=True)

    for r_idx, (norm, canon) in enumerate(sorted(sku_map.items())):
        r     = E_DAT + r_idx
        bg    = C_LGREY if r_idx % 2 == 0 else C_WHITE
        nome  = name_map.get(norm, "")
        s     = stock_by_sku.get(norm, {"cd": 0.0, "lojas": 0.0})
        cd    = int(s["cd"])
        lojas = int(s["lojas"])

        for ci, (val, halign) in enumerate(
            [(canon, "left"), (nome, "left"),
             (cd, "right"), (lojas, "right"), (cd + lojas, "right")], 2
        ):
            c = ws.cell(r, ci, value=val)
            c.font = font(8); c.fill = fill(bg)
            c.alignment = align(halign, "center")
            if ci >= 4:
                c.number_format = FMT_INT
            c.border = border(bottom=_T)

    ws.freeze_panes = f"B{E_DAT}"
    ws.sheet_view.showGridLines = False


# ── Dashboard sheet ────────────────────────────────────────────────────────────
def _build_dashboard(ws, n_cogs, history_lines, operators):
    pad_col(ws)

    # Set column widths (PCOL shift: what was col 1 is now col 2, etc.)
    prop_widths = [8,28,10,12,10,10,9,9,14,14,14,14,13,13,24]
    for i, w in enumerate(prop_widths, 1 + PCOL):
        ws.column_dimensions[get_column_letter(i)].width = w

    seen_skus = {}
    for r in history_lines:
        seen_skus.setdefault(r[5], r[6])
    hist_skus = list(seen_skus.keys())

    # Build cross-sheet range strings (Histórico has PCOL shift: cols B-P)
    HR = {
        "Op":  f"'Histórico'!$B${H_DAT}:$B${H_MAX}",
        "Dat": f"'Histórico'!$C${H_DAT}:$C${H_MAX}",
        "ID":  f"'Histórico'!$F${H_DAT}:$F${H_MAX}",
        "SKU": f"'Histórico'!$G${H_DAT}:$G${H_MAX}",
        "Vol": f"'Histórico'!$I${H_DAT}:$I${H_MAX}",
        "Prc": f"'Histórico'!$J${H_DAT}:$J${H_MAX}",
        "Dsc": f"'Histórico'!$L${H_DAT}:$L${H_MAX}",
        "GM":  f"'Histórico'!$M${H_DAT}:$M${H_MAX}",
        "Mes": f"'Histórico'!$N${H_DAT}:$N${H_MAX}",
        "Rec": f"'Histórico'!$O${H_DAT}:$O${H_MAX}",
    }
    cogs_last = C_DAT + n_cogs - 1
    CR = {
        "SKU": f"COGS!$B${C_DAT}:$B${cogs_last}",
        "Prd": f"COGS!$C${C_DAT}:$C${cogs_last}",
        "CES": f"COGS!$D${C_DAT}:$D${cogs_last}",
        "Ret": f"COGS!$F${C_DAT}:$F${cogs_last}",
    }

    # Proposta column letters (with PCOL=1, all shift A→B, B→C, …)
    PC = ["B","C","D","E","F","G","H","I","J","K","L","M","N","O","P"]
    # PC[0]=B=SKU  PC[1]=C=Produto  PC[2]=D=Vol  PC[3]=E=Prc
    # PC[4]=F=CES  PC[5]=G=Ret      PC[6]=H=Dsc  PC[7]=I=GM   PC[8]=J=Rec
    # PC[9]=K=Mar  PC[10]=L=MnC     PC[11]=M=MxC PC[12]=N=MnG PC[13]=O=MxG
    # PC[14]=P=Flg

    # ── Title ──────────────────────────────────────────────────────────
    ws.row_dimensions[D_TIT].height = 18
    _title_bar(ws, D_TIT, "GE Beauty — B2B Box · Dashboard", ncols=15)

    # ── Row 4: Filter ──────────────────────────────────────────────────
    ws.row_dimensions[FLT_ROW].height = 20
    lbl = ws.cell(FLT_ROW, 2, value="Lista de clientes:")  # col B
    lbl.font = font(8, bold=True, color="FF595959"); lbl.alignment = align("right","center")

    # centerContinuous across D4:G4 — no merge
    for ci in range(FLT_COL, FLT_COL_END + 1):
        c = ws.cell(FLT_ROW, ci)
        c.fill = fill(C_INPUT)
        c.alignment = Alignment(horizontal="centerContinuous", vertical="center")
        c.border = Border(bottom=Side(style="medium", color="FFDF3630"))
    c3 = ws.cell(FLT_ROW, FLT_COL, value="Todos")
    c3.font = font(8, bold=True)

    dv_ops = DataValidation(
        type="list",
        formula1='"' + ",".join(["Todos"] + list(operators)) + '"',
        allow_blank=False, showDropDown=False)
    dv_ops.sqref = f"{get_column_letter(FLT_COL)}{FLT_ROW}"
    ws.add_data_validation(dv_ops)

    hint = ws.cell(FLT_ROW, 9, value="← selecione o cliente para filtrar todo o dashboard")
    hint.font = font(8, italic=True, color="FF9B9B9B"); hint.alignment = align("left","center")

    # ── Rows 6-11: KPIs ────────────────────────────────────────────────

    def kpi_lbl(row, col, text):
        c = ws.cell(row, col, value=text)
        c.font = font(8, bold=True, color="FF595959"); c.alignment = align("left","center")

    def kpi_val(row, col, formula, fmt, span=None):
        # centerContinuous across span — no merge
        end = span if span else col
        for ci in range(col, end + 1):
            c = ws.cell(row, ci)
            c.fill = fill(C_BLUE_L)
            c.alignment = Alignment(horizontal="centerContinuous", vertical="center")
            c.border = border(bottom=_T)
        c = ws.cell(row, col, value=formula)
        c.font = font(8, bold=True); c.number_format = fmt
        return c

    kpi_lbl(6, 2, "RECEITA TOTAL (R$)")
    kpi_val(7, 2,
            f'=IF({FILT}="Todos",SUM({HR["Rec"]}),SUMIF({HR["Op"]},{FILT},{HR["Rec"]}))',
            FMT_BRL, span=5)

    kpi_lbl(8, 2, "Pedidos fechados")
    kpi_val(8, 3,
            f'=IFERROR(IF({FILT}="Todos",'
            f'SUMPRODUCT(IFERROR(({HR["ID"]}<>"")/COUNTIFS({HR["ID"]},{HR["ID"]}),0)),'
            f'SUMPRODUCT(IFERROR(({HR["ID"]}<>"")/COUNTIFS({HR["ID"]},{HR["ID"]},{HR["Op"]},{FILT}),0))),'
            f'0)',
            FMT_INT)
    kpi_lbl(8, 5, "Margem gerada (R$)")
    kpi_val(8, 6,
            f'=SUMPRODUCT(IF({FILT}="Todos",1,1*({HR["Op"]}={FILT}))*IF(ISNUMBER({HR["GM"]}),{HR["GM"]},0)*{HR["Rec"]})',
            FMT_BRL)

    kpi_lbl(9, 2, "SKUs distintos")
    kpi_val(9, 3,
            f'=IFERROR(IF({FILT}="Todos",'
            f'SUMPRODUCT(IFERROR(({HR["SKU"]}<>"")/COUNTIFS({HR["SKU"]},{HR["SKU"]}),0)),'
            f'SUMPRODUCT(IFERROR(({HR["SKU"]}<>"")/COUNTIFS({HR["SKU"]},{HR["SKU"]},{HR["Op"]},{FILT}),0))),'
            f'0)',
            FMT_INT)
    kpi_lbl(9, 5, "Volume total (un.)")
    kpi_val(9, 6,
            f'=IF({FILT}="Todos",SUM({HR["Vol"]}),SUMIF({HR["Op"]},{FILT},{HR["Vol"]}))',
            FMT_INT)

    kpi_lbl(10, 2, "Desc% médio pond.")
    kpi_val(10, 3,
            f'=IFERROR(IF({FILT}="Todos",'
            f'SUMPRODUCT(IF(ISNUMBER({HR["Dsc"]}),{HR["Dsc"]},0)*{HR["Rec"]})/SUM({HR["Rec"]}),'
            f'SUMPRODUCT(({HR["Op"]}={FILT})*IF(ISNUMBER({HR["Dsc"]}),{HR["Dsc"]},0)*{HR["Rec"]})/SUMIF({HR["Op"]},{FILT},{HR["Rec"]})),'
            f'"")',
            FMT_PCT)

    # ── Rows 13–25: Chart helper data (visible, cols B–D) ──────────────
    for ci, h in enumerate(["Mês","Data","Receita (R$)"], CH_LBL_COL):
        c = ws.cell(CH_HDR, ci, value=h)
        c.font = font(8, bold=True, color=C_WHITE); c.fill = fill(C_RED)
        c.alignment = align("center","center")

    for i in range(12):
        r        = CH_DAT + i
        month_dt = datetime(2026, i + 1, 1)
        label    = f"{PT_MONTHS[i]}/26"

        lc = ws.cell(r, CH_LBL_COL, value=label)
        lc.font = font(8); lc.fill = fill(C_LGREY if i % 2 == 0 else C_WHITE)
        lc.alignment = align("center","center")
        lc.border = border(bottom=_T)

        dc = ws.cell(r, CH_DTC_COL, value=month_dt)
        dc.number_format = "MMM/YY"; dc.font = font(8)
        dc.fill = fill(C_LGREY if i % 2 == 0 else C_WHITE)
        dc.alignment = align("center","center"); dc.border = border(bottom=_T)

        # Revenue SUMIF: filter by month (Mês col) and optionally by client
        rc = ws.cell(r, CH_RVC_COL)
        rc.value = (
            f'=IF({FILT}="Todos",'
            f'SUMIF({HR["Mes"]},$C{r},{HR["Rec"]}),'
            f'SUMIFS({HR["Rec"]},{HR["Mes"]},$C{r},{HR["Op"]},{FILT}))'
        )
        rc.number_format = FMT_BRL; rc.font = font(8)
        rc.fill = fill(C_LGREY if i % 2 == 0 else C_WHITE)
        rc.alignment = align("right","center"); rc.border = border(bottom=_T)

    # ── Bar chart (anchored at F8) ──────────────────────────────────────
    chart = BarChart()
    chart.type = "col"; chart.grouping = "clustered"
    chart.style = 2; chart.title = None; chart.legend = None
    chart.width = 17; chart.height = 10

    data_ref = Reference(ws, min_col=CH_RVC_COL, max_col=CH_RVC_COL,
                         min_row=CH_HDR, max_row=CH_END)
    cats_ref = Reference(ws, min_col=CH_LBL_COL, max_col=CH_LBL_COL,
                         min_row=CH_DAT, max_row=CH_END)
    chart.add_data(data_ref, titles_from_data=True)
    chart.set_categories(cats_ref)
    try:
        chart.series[0].graphicalProperties.solidFill = "DF3630"
    except Exception:
        pass
    ws.add_chart(chart, CH_ANC)

    # ── Ledger (rows 29+) ────────────────────────────────────────────────
    ws.row_dimensions[L_SEC].height = 18
    ws.row_dimensions[L_HDR].height = 26
    _section_bar(ws, L_SEC, "LEDGER — HISTÓRICO", ncols=8)

    for ci, h in enumerate(["SKU","Produto","Qtd (geral)","Min% (geral)","Max% (geral)",
                             "Qtd (cliente)","Min% (cliente)","Max% (cliente)"], 2):
        cell = ws.cell(L_HDR, ci, value=h)
        cell.font = font(8, bold=True, color=C_WHITE); cell.fill = fill(C_RED)
        cell.alignment = align("center","center",wrap=True)
        cell.border = border(bottom=_M)

    for i, sku in enumerate(hist_skus):
        r  = L_DAT + i
        bg = C_LGREY if i % 2 == 0 else C_WHITE
        _static(ws,r,2, sku, None, bg, "left")
        _fml(ws,r,3, f'=IFERROR(INDEX({CR["Prd"]},MATCH($B{r},{CR["SKU"]},0)),"?")', None,bg,"left")
        _fml(ws,r,4, f'=COUNTIFS({HR["SKU"]},$B{r})', FMT_INT,bg,"right")
        _fml(ws,r,5, f'=IFERROR(IF(D{r}=0,"—",MINIFS({HR["Dsc"]},{HR["SKU"]},$B{r})),"—")', FMT_PCT,bg,"right")
        _fml(ws,r,6, f'=IFERROR(IF(D{r}=0,"—",MAXIFS({HR["Dsc"]},{HR["SKU"]},$B{r})),"—")', FMT_PCT,bg,"right")
        _fml(ws,r,7, f'=COUNTIFS({HR["SKU"]},$B{r},{HR["Op"]},{FILT})', FMT_INT,bg,"right")
        _fml(ws,r,8, f'=IFERROR(IF(G{r}=0,"—",MINIFS({HR["Dsc"]},{HR["SKU"]},$B{r},{HR["Op"]},{FILT})),"—")', FMT_PCT,bg,"right")
        _fml(ws,r,9, f'=IFERROR(IF(G{r}=0,"—",MAXIFS({HR["Dsc"]},{HR["SKU"]},$B{r},{HR["Op"]},{FILT})),"—")', FMT_PCT,bg,"right")

    # ── Proposta section ────────────────────────────────────────────────
    LED_END    = L_DAT + len(hist_skus) - 1
    PROP_SEC   = LED_END + 3
    PROP_INP   = PROP_SEC + 1
    COL_HDR_R  = PROP_INP + 2
    DAT_START  = COL_HDR_R + 1
    DAT_END    = DAT_START + N_DATA_ROWS - 1
    TOT_ROW    = DAT_END + 1
    SUM_ROW    = TOT_ROW + 2

    ws.row_dimensions[PROP_SEC].height  = 18
    ws.row_dimensions[PROP_INP].height  = 18
    ws.row_dimensions[COL_HDR_R].height = 28
    _section_bar(ws, PROP_SEC, "PROPOSTA EM CONSTRUÇÃO", ncols=15)

    # Input row (centerContinuous spans — no merge)
    pi_lbl = ws.cell(PROP_INP, 2, value="Operador:")
    pi_lbl.font = font(8, bold=True, color="FF595959"); pi_lbl.alignment = align("right","center")
    for ci in range(3, 6):
        c = ws.cell(PROP_INP, ci)
        c.fill = fill(C_CALC)
        c.alignment = Alignment(horizontal="centerContinuous", vertical="center")
        c.border = Border(bottom=Side(style="medium", color="FFDF3630"))
    op_c = ws.cell(PROP_INP, 3, value=f"={FILT}")
    op_c.font = font(8, bold=True)

    def _pi(col, lbl, span_end=None):
        lc = ws.cell(PROP_INP, col - 1, value=lbl)
        lc.font = font(8, bold=True, color="FF595959"); lc.alignment = align("right","center")
        end = span_end if span_end else col
        for ci in range(col, end + 1):
            c = ws.cell(PROP_INP, ci)
            c.fill = fill(C_INPUT)
            c.alignment = Alignment(horizontal="centerContinuous", vertical="center")
            c.border = Border(bottom=Side(style="medium", color="FFDF3630"))
        ic = ws.cell(PROP_INP, col)
        ic.font = font(8)
        return ic

    _pi(7, "Data proposta:", span_end=8).number_format = "DD/MM/YYYY"
    _pi(10, "Prazo:")
    ws.cell(PROP_INP, 11, value="dias").font = font(8, color="FF595959")

    # Column headers
    col_labels = ["SKU","Produto","Volume","Preço unit.",
                  "COGS ES","Retail","Desc%","GM%","Receita","Margem",
                  "Hist. min%\n(cliente)","Hist. max%\n(cliente)",
                  "Hist. min%\n(geral)","Hist. max%\n(geral)","Flag"]
    for ci, h in enumerate(col_labels, 2):
        cell = ws.cell(COL_HDR_R, ci, value=h)
        cell.font = font(8, bold=True, color=C_WHITE); cell.fill = fill(C_RED)
        cell.alignment = align("center","center",wrap=True)
        cell.border = border(bottom=_M)

    # SKU dropdown from COGS sheet (interval, no table)
    dv = DataValidation(type="list",
                        formula1=f"COGS!${CCL[0]}${C_DAT}:${CCL[0]}${cogs_last}",
                        allow_blank=True, showDropDown=False)
    dv.error = "Selecione um SKU da lista COGS."; dv.errorTitle = "SKU inválido"
    ws.add_data_validation(dv)

    for row in range(DAT_START, DAT_END + 1):
        bg = C_LGREY if row % 2 == 0 else C_WHITE
        R  = row
        # B  SKU input
        _inp(ws,R,2,  None,   None,    "left");  dv.add(ws.cell(R,2))
        # C  Produto  (INDEX+MATCH on COGS)
        _fml(ws,R,3,  f'=IFERROR(INDEX({CR["Prd"]},MATCH(${PC[0]}{R},{CR["SKU"]},0)),"")', None,bg,"left")
        # D  Volume input
        _inp(ws,R,4,  None,   FMT_INT, "right")
        # E  Preço input
        _inp(ws,R,5,  None,   FMT_BRL, "right")
        # F  COGS ES  (INDEX+MATCH on COGS)
        _fml(ws,R,6,  f'=IFERROR(INDEX({CR["CES"]},MATCH(${PC[0]}{R},{CR["SKU"]},0)),"")', FMT_BRL,bg,"right")
        # G  Retail   (INDEX+MATCH on COGS)
        _fml(ws,R,7,  f'=IFERROR(INDEX({CR["Ret"]},MATCH(${PC[0]}{R},{CR["SKU"]},0)),"")', FMT_BRL,bg,"right")
        # H  Desc%    (Retail−Preço)/Retail
        _fml(ws,R,8,  f'=IF(OR(${PC[0]}{R}="",${PC[3]}{R}="",${PC[5]}{R}=""),"",({PC[5]}{R}-{PC[3]}{R})/{PC[5]}{R})', FMT_PCT,bg,"right")
        # I  GM%      (Preço−COGS)/Preço
        _fml(ws,R,9,  f'=IF(OR(${PC[0]}{R}="",${PC[3]}{R}="",${PC[4]}{R}=""),"",({PC[3]}{R}-{PC[4]}{R})/{PC[3]}{R})', FMT_PCT,bg,"right")
        # J  Receita  Volume×Preço
        _fml(ws,R,10, f'=IF(OR(${PC[0]}{R}="",${PC[2]}{R}="",${PC[3]}{R}=""),"",{PC[2]}{R}*{PC[3]}{R})', FMT_BRL,bg,"right")
        # K  Margem   Volume×(Preço−COGS)
        _fml(ws,R,11, f'=IF(OR(${PC[0]}{R}="",${PC[2]}{R}="",${PC[3]}{R}="",${PC[4]}{R}=""),"",{PC[2]}{R}*({PC[3]}{R}-{PC[4]}{R}))', FMT_BRL,bg,"right")
        # L  Hist_min_cli
        _fml(ws,R,12,
             f'=IFERROR(IF(COUNTIFS({HR["SKU"]},${PC[0]}{R},{HR["Op"]},{FILT})=0,"—",'
             f'MINIFS({HR["Dsc"]},{HR["SKU"]},${PC[0]}{R},{HR["Op"]},{FILT})),"—")',
             FMT_PCT,bg,"right")
        # M  Hist_max_cli
        _fml(ws,R,13,
             f'=IFERROR(IF(COUNTIFS({HR["SKU"]},${PC[0]}{R},{HR["Op"]},{FILT})=0,"—",'
             f'MAXIFS({HR["Dsc"]},{HR["SKU"]},${PC[0]}{R},{HR["Op"]},{FILT})),"—")',
             FMT_PCT,bg,"right")
        # N  Hist_min_geral
        _fml(ws,R,14,
             f'=IFERROR(IF(COUNTIFS({HR["SKU"]},${PC[0]}{R})=0,"—",'
             f'MINIFS({HR["Dsc"]},{HR["SKU"]},${PC[0]}{R})),"—")',
             FMT_PCT,bg,"right")
        # O  Hist_max_geral
        _fml(ws,R,15,
             f'=IFERROR(IF(COUNTIFS({HR["SKU"]},${PC[0]}{R})=0,"—",'
             f'MAXIFS({HR["Dsc"]},{HR["SKU"]},${PC[0]}{R})),"—")',
             FMT_PCT,bg,"right")
        # P  Flag
        _fml(ws,R,16,
             f'=IF(${PC[0]}{R}="","",IF(${PC[6]}{R}="","",IF(${PC[10]}{R}="—","novo para cliente",'
             f'IF(${PC[6]}{R}<${PC[10]}{R},"+ melhor que o histórico",'
             f'IF(${PC[6]}{R}>${PC[11]}{R},"! acima do max histórico","~ no range histórico")))))',
             None,bg,"left")

    # ── Totals row ──────────────────────────────────────────────────────
    rng_rec = f"J{DAT_START}:J{DAT_END}"   # J = Receita (col 10)
    rng_mar = f"K{DAT_START}:K{DAT_END}"   # K = Margem  (col 11)

    ws.cell(TOT_ROW, 2, value="TOTAL").font = font(8, bold=True)
    ws.cell(TOT_ROW, 2).fill = fill("FFE8E8E8")
    ws.cell(TOT_ROW, 2).alignment = align("left","center")
    ws.cell(TOT_ROW, 2).border = border(top=_M, bottom=_M)

    ws.cell(TOT_ROW, 4).value = f'=SUMPRODUCT(($B{DAT_START}:$B{DAT_END}<>"")*D{DAT_START}:D{DAT_END})'
    ws.cell(TOT_ROW, 4).font = font(8, bold=True)
    ws.cell(TOT_ROW, 4).fill = fill("FFE8E8E8")
    ws.cell(TOT_ROW, 4).number_format = FMT_INT
    ws.cell(TOT_ROW, 4).alignment = align("right","center")
    ws.cell(TOT_ROW, 4).border = border(top=_M, bottom=_M)

    def _tot(col, fml, fmt):
        c = ws.cell(TOT_ROW, col, value=fml)
        c.font = font(8,bold=True); c.fill = fill("FFE8E8E8")
        c.alignment = align("right","center"); c.number_format = fmt
        c.border = border(top=_M, bottom=_M)

    _tot(8,  f'=IFERROR(SUMPRODUCT((J{DAT_START}:J{DAT_END}<>"")*H{DAT_START}:H{DAT_END}*J{DAT_START}:J{DAT_END})/SUM(IF(ISNUMBER({rng_rec}),{rng_rec},0)),"")', FMT_PCT)
    _tot(9,  f'=IFERROR(SUM({rng_mar})/SUM(IF(ISNUMBER({rng_rec}),{rng_rec},0)),"")', FMT_PCT)
    _tot(10, f'=IFERROR(SUM({rng_rec}),"")', FMT_BRL)
    _tot(11, f'=IFERROR(SUM({rng_mar}),"")', FMT_BRL)

    for c in [3,5,6,7,12,13,14,15,16]:
        ws.cell(TOT_ROW, c).fill = fill("FFE8E8E8")
        ws.cell(TOT_ROW, c).border = border(top=_M, bottom=_M)

    # ── Summary strip ───────────────────────────────────────────────────
    for i, (lbl_text, ref, fmt) in enumerate([
        ("Receita total",     f"=J{TOT_ROW}", FMT_BRL),
        ("Margem total",      f"=K{TOT_ROW}", FMT_BRL),
        ("GM% médio",         f"=I{TOT_ROW}", FMT_PCT),
        ("Desc% médio pond.", f"=H{TOT_ROW}", FMT_PCT),
    ]):
        lc = ws.cell(SUM_ROW, 2 + i * 3, value=lbl_text)
        lc.font = font(8, bold=True, color="FF595959"); lc.alignment = align("right","center")
        vc = ws.cell(SUM_ROW, 3 + i * 3, value=ref)
        vc.font = font(8, bold=True); vc.fill = fill(C_INPUT)
        vc.alignment = align("left","center"); vc.number_format = fmt

    # ── Conditional formatting ──────────────────────────────────────────
    _cf(ws, f"H{DAT_START}:H{DAT_END}", f'AND(ISNUMBER(H{DAT_START}),H{DAT_START}>0.85)', C_WARN)
    _cf(ws, f"I{DAT_START}:I{DAT_END}", f'AND(ISNUMBER(I{DAT_START}),I{DAT_START}<0.1)',   C_WARN)
    _cf(ws, f"I{DAT_START}:I{DAT_END}", f'AND(ISNUMBER(I{DAT_START}),I{DAT_START}>0.25)',  C_OK)
    _cf(ws, f"P{DAT_START}:P{DAT_END}", f'ISNUMBER(FIND("+",P{DAT_START}))',    C_OK)
    _cf(ws, f"P{DAT_START}:P{DAT_END}", f'ISNUMBER(FIND("!",P{DAT_START}))',    C_WARN)
    _cf(ws, f"P{DAT_START}:P{DAT_END}", f'ISNUMBER(FIND("novo",P{DAT_START}))', C_ACCENT)

    ws.freeze_panes = f"B{FLT_ROW + 1}"
    ws.sheet_view.showGridLines = False


# ── Shared helpers ─────────────────────────────────────────────────────────────
def _title_bar(ws, row, text, ncols):
    end_col = ncols + PCOL
    for ci in range(1 + PCOL, end_col + 1):
        c = ws.cell(row, ci)
        c.fill = fill(C_RED)
        c.alignment = align("left", "center")
    c = ws.cell(row, 1 + PCOL, value=text)
    c.font = font(8, bold=True, color=C_WHITE)

def _section_bar(ws, row, text, ncols):
    end_col = ncols + PCOL
    for ci in range(1 + PCOL, end_col + 1):
        c = ws.cell(row, ci)
        c.fill = fill(C_RED)
        c.alignment = align("left", "center")
    c = ws.cell(row, 1 + PCOL, value=text)
    c.font = font(8, bold=True, color=C_WHITE)

def _static(ws, row, col, value, fmt, bg, halign):
    c = ws.cell(row, col, value=value)
    c.font = font(8); c.fill = fill(bg); c.alignment = align(halign,"center")
    if fmt: c.number_format = fmt
    c.border = border(bottom=_T); return c

def _inp(ws, row, col, value, fmt, halign):
    c = ws.cell(row, col)
    if value is not None: c.value = value
    c.font = font(8); c.fill = fill(C_INPUT); c.alignment = align(halign,"center")
    if fmt: c.number_format = fmt
    c.border = border(bottom=_T); return c

def _fml(ws, row, col, formula, fmt, bg, halign):
    c = ws.cell(row, col, value=formula)
    c.font = font(8); c.fill = fill(bg); c.alignment = align(halign,"center")
    if fmt: c.number_format = fmt
    c.border = border(bottom=_T); return c

def _cf(ws, cell_range, formula, font_color):
    from openpyxl.formatting.rule import Rule
    ds   = DifferentialStyle(font=Font(name="Calibri", size=8, color=font_color, bold=True))
    rule = Rule(type="expression", formula=[formula], dxf=ds)
    ws.conditional_formatting.add(cell_range, rule)

if __name__ == "__main__":
    build()
