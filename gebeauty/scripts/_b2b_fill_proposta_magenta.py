"""
Fill the Dashboard 'PROPOSTA EM CONSTRUÇÃO' section with the Magenta excess-stock
proposal from Raphael's Orçamentos Box.xlsx, then save a NEW file so the original
is never touched.

Usage:
  C:/Python314/python.exe gebeauty/scripts/_b2b_fill_proposta_magenta.py
"""
import sys, shutil
from pathlib import Path
from datetime import datetime
import openpyxl

sys.stdout.reconfigure(encoding="utf-8")

ROOT      = Path(__file__).resolve().parent
SAND      = ROOT.parent

# ── Proposal data from Orçamentos Box.xlsx (Raphael, 01/07/2026) ──────────────
# Columns: SKU | volume_sugestão | preco_sugestao (to Magenta)
PROPOSTA = [
    ("GEB 023", 3000,  24.65),  # Booster Antioxidante 15ml
    ("GEB 022", 2000,  22.70),  # Booster Antifrizz 15ml
    ("GEB 102", 4000,  31.00),  # Primer Liso Intacto
    ("GEB 024", 5000,  28.50),  # Melon Mood Body & Hair Splash 200ml
    ("GEB 029", 4000,  23.45),  # Melon Mood Body & Hair Splash 100ml *not in COGS*
    ("GEB 013", 3000,  11.00),  # Shampoo 60ml
    ("GEB 010", 3000,  11.00),  # Mascara Condicionadora 50ml
    ("GEB 011", 3000,  12.00),  # Finalizador Leave-in 50ml *not in COGS*
    ("GEB 008", 1000,  18.00),  # Shampoo a Seco 150ml
]

OPERATOR = "Magenta"

# ── Source file: prefer _new (latest Estoque run) else original ───────────────
SOURCE_NEW = SAND / "B2B_Box_Dashboard_new.xlsx"
SOURCE_OLD = SAND / "B2B_Box_Dashboard.xlsx"
SOURCE     = SOURCE_NEW if SOURCE_NEW.exists() else SOURCE_OLD

ts  = datetime.now().strftime("%Y%m%d")
OUT = SAND / f"B2B_Proposta_Magenta_{ts}.xlsx"


def find_proposta_rows(ws):
    """
    Locate the Dashboard proposta section dynamically.
    Returns (operator_row, operator_col, col_hdr_row, dat_start, dat_end).
    Strategy: find 'PROPOSTA EM CONSTRUÇÃO' title, then scan downward for the
    column header row (col B = 'SKU'), then data rows are immediately below.
    """
    prop_sec_row = None
    for row in ws.iter_rows(min_row=15):
        for cell in row:
            if cell.value and "PROPOSTA" in str(cell.value).upper():
                prop_sec_row = cell.row
                break
        if prop_sec_row:
            break

    if not prop_sec_row:
        raise ValueError("Could not find 'PROPOSTA EM CONSTRUÇÃO' section in Dashboard.")

    # Row after prop_sec is the operator input row (contains "Operador:")
    op_row = prop_sec_row + 1

    # Find column header row (col B has value "SKU")
    col_hdr_row = None
    for r in range(prop_sec_row + 1, prop_sec_row + 6):
        val = ws.cell(r, 2).value
        if val and str(val).strip().upper() == "SKU":
            col_hdr_row = r
            break

    if not col_hdr_row:
        raise ValueError(f"Could not find 'SKU' column header below row {prop_sec_row}.")

    dat_start = col_hdr_row + 1

    # Find dat_end by scanning for the TOTAL row (col B = "TOTAL")
    dat_end = dat_start + 14  # fallback: N_DATA_ROWS - 1
    for r in range(dat_start + 1, dat_start + 20):
        val = ws.cell(r, 2).value
        if val and str(val).strip().upper() == "TOTAL":
            dat_end = r - 1
            break

    return op_row, col_hdr_row, dat_start, dat_end


def find_operator_cell(ws, op_row):
    """
    The operator display cell is in the PROP_INP row, col C (value =D4 formula).
    The editable filter is at D4 (FLT_ROW=4, FLT_COL=4).
    """
    return (4, 4)  # row=4 col=4 = D4


def clear_row(ws, r, col_b, col_last):
    """Clear input cells (SKU=col_b, Volume=col_b+2, Preço=col_b+3) in a row."""
    for ci in [col_b, col_b + 2, col_b + 3]:
        ws.cell(r, ci).value = None


def main():
    if not SOURCE.exists():
        print(f"[!] Source file not found: {SOURCE}")
        return

    print(f"Source: {SOURCE.name}")
    print(f"Output: {OUT.name}")

    # Copy file — never touch the original
    shutil.copy2(str(SOURCE), str(OUT))

    wb = openpyxl.load_workbook(str(OUT))

    if "Dashboard" not in wb.sheetnames:
        print("[!] 'Dashboard' sheet not found in workbook.")
        return

    ws = wb["Dashboard"]

    # ── Locate proposta section ────────────────────────────────────────────────
    op_row, col_hdr_row, dat_start, dat_end = find_proposta_rows(ws)
    print(f"  Proposta col headers at row {col_hdr_row}, data rows {dat_start}–{dat_end}")

    # ── Set operator filter (D4) ───────────────────────────────────────────────
    ws.cell(4, 4).value = OPERATOR
    print(f"  Operador: {OPERATOR} → D4")

    # ── Fill proposta rows ─────────────────────────────────────────────────────
    # Columns: B=SKU(2), C=Produto(formula), D=Volume(4), E=Preço(5)
    # C, F, G, H, I, J, K, L, M, N, O, P are formula cells — don't touch.
    for i, (sku, vol, preco) in enumerate(PROPOSTA):
        r = dat_start + i
        if r > dat_end:
            print(f"  [!] Row {r} exceeds dat_end {dat_end} — proposta table too small.")
            break
        ws.cell(r, 2).value = sku
        ws.cell(r, 4).value = vol
        ws.cell(r, 5).value = preco
        flag = "(sem COGS)" if sku in ("GEB 029", "GEB 011") else ""
        print(f"  row {r}: {sku}  {vol:>5,} un  @  R${preco:>6.2f}  {flag}")

    # ── Clear remaining rows ───────────────────────────────────────────────────
    n_filled = len(PROPOSTA)
    for r in range(dat_start + n_filled, dat_end + 1):
        ws.cell(r, 2).value = None
        ws.cell(r, 4).value = None
        ws.cell(r, 5).value = None

    # ── Print preview table ───────────────────────────────────────────────────
    print()
    print(f"{'SKU':<10} {'Volume':>8} {'Preço':>8} {'Retail':>8}  {'Desc%':>6}  {'Total':>12}")
    print("-" * 60)
    # Retail prices from COGS dict (approximated for preview)
    RETAIL_APPROX = {
        "GEB023": 75.00, "GEB022": 79.00, "GEB102": 139.00,
        "GEB024": 129.00, "GEB029": 79.00,
        "GEB013": 40.00, "GEB010": 40.00, "GEB011": 47.00, "GEB008": 69.00,
    }
    COST_APPROX = {
        "GEB023": 18.65, "GEB022": 13.06, "GEB102": 23.63,
        "GEB024": 23.45, "GEB029": 19.44,
        "GEB013": 7.71, "GEB010": 6.29, "GEB011": 8.06, "GEB008": 15.89,
    }
    total_rev  = 0
    total_cost = 0
    for sku, vol, preco in PROPOSTA:
        norm   = sku.upper().replace(" ","").replace("-","")
        retail = RETAIL_APPROX.get(norm, 0)
        cost   = COST_APPROX.get(norm, 0)
        desc   = (retail - preco) / retail if retail else 0
        gm     = (preco - cost) / preco if preco else 0
        rev    = vol * preco
        total_rev  += rev
        total_cost += vol * cost
        flag   = " *" if sku in ("GEB 029", "GEB 011") else ""
        print(f"{sku:<10} {vol:>8,} {preco:>8.2f} {retail:>8.2f}  {desc:>5.0%}  R${rev:>10,.2f}{flag}")

    print("-" * 60)
    total_gm = (total_rev - total_cost) / total_rev if total_rev else 0
    print(f"{'TOTAL':<10} {'28,000':>8}                      R${total_rev:>10,.2f}")
    print(f"{'Custo GE':<10}                             R${total_cost:>10,.2f}")
    print(f"{'Margem':<10}                              {total_gm:>5.0%}")
    print()
    print("* = SKU sem COGS (GEB 029, GEB 011) — fórmulas de GM% incompletas no Dashboard")

    wb.save(str(OUT))
    print(f"\nSalvo: {OUT}")


if __name__ == "__main__":
    main()
