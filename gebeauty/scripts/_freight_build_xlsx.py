"""Build the free-shipping threshold workbook (house conventions).

Reads freight_final.json; writes gebeauty/logistics/frete-unilog/
frete-freeship-thresholds.xlsx. Sheets: Recomendação, Premissas, Por Região,
Por UF, Sweep k_other. EN formula tokens; no merged cells; Calibri 8pt; red
headers; yellow editable inputs; live implied-k formulas so Lucas can play.
"""
import json
from pathlib import Path
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.formatting.rule import CellIsRule

HERE = Path(__file__).resolve().parent
D = json.load(open(HERE/"freight_final.json"))
OUT = HERE.parent / "logistics" / "frete-unilog" / "frete-freeship-thresholds.xlsx"
OUT.parent.mkdir(parents=True, exist_ok=True)

RED="DF3630"; WHITE="FFFFFF"; YEL="FFF2CC"; GREY="F7F7F7"
thin=Side(style="thin", color="D0D0D0")
BORDER=Border(left=thin,right=thin,top=thin,bottom=thin)
def F(b=False,c="000000",sz=8): return Font(name="Calibri",size=sz,bold=b,color=c)
HDR=PatternFill("solid",fgColor=RED); INP=PatternFill("solid",fgColor=YEL); OUTF=PatternFill("solid",fgColor=GREY)
CENTER=Alignment(horizontal="center"); LEFT=Alignment(horizontal="left"); RIGHT=Alignment(horizontal="right")
RS='"R$" #,##0'; PC='0.0%'; PC2='0.00%'; INT='#,##0'

REGS=["SE","CO","S","NE","N"]
SWEEP=[  # k_other, CO,S,NE,N thresholds, wavg_k, free%, hit%   (SE fixed 199)
 (0.07,399,449,599,699,0.101,0.27,0.044),(0.08,349,399,499,699,0.105,0.28,0.045),
 (0.09,319,349,449,699,0.108,0.29,0.047),(0.10,279,319,399,649,0.111,0.30,0.050),
 (0.11,269,299,379,599,0.113,0.31,0.052),(0.12,229,269,329,549,0.118,0.33,0.056),
 (0.13,219,249,319,499,0.121,0.34,0.058),(0.15,199,219,269,449,0.127,0.37,0.063)]

def style_hdr(ws,row,cols):
    for c in cols:
        cell=ws.cell(row=row,column=c); cell.fill=HDR; cell.font=F(True,WHITE); cell.alignment=CENTER; cell.border=BORDER

def sheet_setup(ws):
    ws.sheet_view.showGridLines=False; ws.sheet_format.defaultRowHeight=10.5
    ws.sheet_view.zoomScale=115

wb=openpyxl.Workbook()

# ---------------- Recomendação ----------------
ws=wb.active; ws.title="Recomendação"; sheet_setup(ws)
ws.column_dimensions["A"].width=3
for col,w in zip("BCDEFGH",[20,12,12,12,12,12,12]): ws.column_dimensions[col].width=w
ws["B2"]="GE Beauty — Frete grátis por região (tabela Unilog B2C)"; ws["B2"].font=F(True,RED,12)
ws["B3"]=f"Base: {D['meta']['orders']:,} pedidos Loja Online BR, {D['meta']['window']} · receita R$ {D['meta']['rev']:,.0f}".replace(",",".")
ws["B3"].font=F(False,"666666")
# KPI band
r=5
kpis=[("Política","SE fixo R$199 · k demais regiões 10%"),
      ("k médio ponderado", f"{D['national']['k_weighted']*100:.1f}%"),
      ("Pedidos com frete grátis", f"{D['national']['free_share']*100:.0f}%"),
      ("Impacto no lucro (frete absorvido + devoluções)", f"{D['national']['hit_pct']*100:.1f}% da receita"),
      ("Custo Unilog bruto (teto, se tudo grátis)", f"{D['meta']['gross_pct']*100:.1f}% da receita"),
      ("Hoje (frete grátis R$299 fixo, pass-through)", f"{D['baseline_flat299']['hit_pct']*100:.1f}% · {D['baseline_flat299']['free_share']*100:.0f}% grátis")]
for i,(k,v) in enumerate(kpis):
    ws.cell(r+i,2,k).font=F(True); ws.cell(r+i,2).fill=OUTF; ws.cell(r+i,2).border=BORDER
    c=ws.cell(r+i,3,v); c.font=F(False); c.fill=OUTF; c.border=BORDER; c.alignment=LEFT
    for cc in range(4,8): ws.cell(r+i,cc).fill=OUTF; ws.cell(r+i,cc).border=BORDER
# ladder table
r=13; ws.cell(r,2,"LADEIRA RECOMENDADA").font=F(True,RED)
r+=1; heads=["Região","Estados","Frete grátis ≥","k (frete/limiar)","% receita","AOV atual","Frete médio","% grátis","Impacto"]
for j,h in enumerate(heads): ws.cell(r,2+j,h)
style_hdr(ws,r,range(2,2+len(heads))); ws.row_dimensions[r].height=26
for reg in REGS:
    r+=1; d=D["per_region"][reg]
    vals=[f"{d['name']} ({reg})", ", ".join(d["ufs"]), d["threshold"], d["k_design"],
          d["rev_share"], d["aov"], d["avg_freight"], d["free_share"], d["hit_pct"]]
    for j,v in enumerate(vals):
        c=ws.cell(r,2+j,v); c.border=BORDER; c.font=F(False); c.fill=OUTF
        if j==2: c.number_format=RS; c.font=F(True)
        elif j in (3,4,7,8): c.number_format=PC
        elif j in (5,6): c.number_format=RS
        if j==1: c.font=F(False,"666666")

# ---------------- Premissas ----------------
ws=wb.create_sheet("Premissas"); sheet_setup(ws)
ws.column_dimensions["A"].width=3
for col,w in zip("BCDEF",[26,12,12,14,30]): ws.column_dimensions[col].width=w
ws["B2"]="Premissas — edite as células amarelas"; ws["B2"].font=F(True,RED,11)
inputs=[("Limiar SE (fixo)",199,RS,"Âncora de política (SE = 66% das vendas)"),
        ("k demais regiões",0.10,PC,"Frete / limiar aplicado a CO, S, NE, N"),
        ("Taxa de devolução",0.05,PC,"Devolução = 100% do frete de ida; linha separada"),
        ("Ad Valorem (tabela)",0.0067,PC2,"Sobre valor da NF (embutido no cálculo)")]
r=4
for k,v,fmt,note in inputs:
    ws.cell(r,2,k).font=F(True); ws.cell(r,2).border=BORDER
    c=ws.cell(r,3,v); c.fill=INP; c.border=BORDER; c.number_format=fmt; c.font=F(True)
    ws.cell(r,5,note).font=F(False,"666666"); r+=1
r+=1; ws.cell(r,2,"Frete médio por região (Unilog, R$)").font=F(True,RED); r+=1
heads=["Região","Frete médio","Limiar sugerido = frete/k","Limiar aplicado","k implícito"]
for j,h in enumerate(heads): ws.cell(r,2+j,h)
style_hdr(ws,r,range(2,2+len(heads))); ws.row_dimensions[r].height=26
k_cell="$C$5"
for reg in REGS:
    r+=1; d=D["per_region"][reg]
    ws.cell(r,2,f"{d['name']} ({reg})").border=BORDER; ws.cell(r,2).font=F(False)
    c=ws.cell(r,3,round(d["avg_freight"],2)); c.fill=INP; c.border=BORDER; c.number_format='"R$" #,##0.00'
    # suggested = freight / k_other  (SE uses its own frozen threshold instead)
    if reg=="SE":
        ws.cell(r,4,"—").border=BORDER; ws.cell(r,4).alignment=CENTER
        ap=ws.cell(r,5,199);
    else:
        f=ws.cell(r,4); f.value=f"=C{r}/{k_cell}"; f.number_format=RS; f.border=BORDER; f.fill=OUTF
        ap=ws.cell(r,5,d["threshold"])
    ap.fill=INP; ap.border=BORDER; ap.number_format=RS; ap.font=F(True)
    ik=ws.cell(r,6); ik.value=f"=C{r}/E{r}"; ik.number_format=PC; ik.border=BORDER; ik.fill=OUTF
ws.cell(r+2,2,"Obs.: % grátis e impacto no lucro são saídas do modelo na ladeira travada.").font=F(False,"666666")
ws.cell(r+3,2,"Para re-simular outros limiares no P&L, rode _freight_final.py com a nova ladeira.").font=F(False,"666666")

# ---------------- Por UF ----------------
ws=wb.create_sheet("Por UF"); sheet_setup(ws)
ws.column_dimensions["A"].width=3
for col,w in zip("BCDEFGHI",[8,14,12,10,10,10,10,10]): ws.column_dimensions[col].width=w
ws["B2"]="Aterrissagem por estado (na ladeira travada)"; ws["B2"].font=F(True,RED,11)
r=4; heads=["UF","Região","Frete grátis ≥","% receita","AOV","Frete médio","k realizado","% grátis"]
for j,h in enumerate(heads): ws.cell(r,2+j,h)
style_hdr(ws,r,range(2,2+len(heads))); ws.row_dimensions[r].height=26
uf=D["per_uf"]
for u in sorted(uf, key=lambda u:-uf[u]["rev_share"]):
    r+=1; d=uf[u]
    vals=[u,d["region"],d["threshold"],d["rev_share"],d["aov"],d["avg_freight"],d["k_realized"],d["free_share"]]
    for j,v in enumerate(vals):
        c=ws.cell(r,2+j,v); c.border=BORDER; c.font=F(False); c.fill=OUTF
        if j==2: c.number_format=RS
        elif j in (3,6,7): c.number_format=PC
        elif j in (4,5): c.number_format=RS

# ---------------- Sweep ----------------
ws=wb.create_sheet("Sweep k_other"); sheet_setup(ws)
ws.column_dimensions["A"].width=3
for col,w in zip("BCDEFGHIJ",[10,8,8,8,8,8,12,10,10]): ws.column_dimensions[col].width=w
ws["B2"]="Sweep k demais regiões (SE fixo R$199) — linha travada: 10%"; ws["B2"].font=F(True,RED,11)
r=4; heads=["k demais","SE","CO","S","NE","N","k médio pond.","% grátis","Impacto"]
for j,h in enumerate(heads): ws.cell(r,2+j,h)
style_hdr(ws,r,range(2,2+len(heads))); ws.row_dimensions[r].height=26
for row in SWEEP:
    r+=1; ko,co,s,ne,n,wk,fr,hit=row
    locked = abs(ko-0.10)<1e-9
    vals=[ko,199,co,s,ne,n,wk,fr,hit]
    for j,v in enumerate(vals):
        c=ws.cell(r,2+j,v); c.border=BORDER; c.font=F(locked); c.fill=(INP if locked else OUTF)
        if j==0 or j in (6,7,8): c.number_format=(PC if j!=0 else '0%')
        else: c.number_format=RS
        if j==0: c.number_format='0%'

wb.save(OUT)
print("wrote", OUT)
