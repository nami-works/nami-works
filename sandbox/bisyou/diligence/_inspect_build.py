# -*- coding: utf-8 -*-
import openpyxl
from openpyxl.utils import get_column_letter
PATH = r"G:\Drives compartilhados\GEB_Financeiro\Orçamento e Resultados\2026\GE Beauty_BP_v2026.xlsx"
wf = openpyxl.load_workbook(PATH, data_only=False)
mac = wf["Macro"]; eco = wf["E-comm"]
out=[]

# 1) Full untruncated template formula from a known consolidation cell
out.append("=== G48 full formula (template) ===")
out.append(str(mac["G48"].value))
out.append("\n=== G49 full formula ===")
out.append(str(mac["G49"].value))

# 2) Macro consolidation rows: any row with a cell referencing 'E-comm'!  -> capture row, B, D, E
out.append("\n=== MACRO consolidation rows (contain 'E-comm'!): row | B | D | E(lag) ===")
seen=set()
for r in range(1, mac.max_row+1):
    hit=False
    for c in range(1, min(mac.max_column,96)+1):
        v=mac.cell(row=r,column=c).value
        if isinstance(v,str) and "'E-comm'!" in v:
            hit=True; break
    if hit and r not in seen:
        seen.add(r)
        out.append(f"r{r}: B={mac.cell(row=r,column=2).value!r} D={mac.cell(row=r,column=4).value!r} E={mac.cell(row=r,column=5).value!r}")
out.append(f"TOTAL consolidation rows: {len(seen)}")

# 3) Month->column map: Macro row 5 and E-comm row 3 (2026 H2 + 2027)
def monthmap(ws, hdr_row, label):
    out.append(f"\n=== {label} month->col (row {hdr_row}) all 2026/2027 dated cols ===")
    for c in range(1, ws.max_column+1):
        v=ws.cell(row=hdr_row,column=c).value
        if hasattr(v,"year") and v.year in (2026,2027):
            out.append(f"  {get_column_letter(c)} = {v.year}-{v.month:02d}")
monthmap(mac,5,"MACRO")
monthmap(eco,3,"E-comm")

# 4) Macro flag area rows 1-4 (cols A-E)
out.append("\n=== MACRO flag area (rows 1-4, cols A-F) ===")
for r in range(1,5):
    cells=[f"{get_column_letter(c)}{r}={mac.cell(row=r,column=c).value!r}" for c in range(1,7) if mac.cell(row=r,column=c).value is not None]
    out.append("  ".join(cells))

open(r"c:\claude\sandbox\bisyou\diligence\_bp_build_spec.txt","w",encoding="utf-8").write("\n".join(out))
print("done; consolidation rows:", len(seen))
