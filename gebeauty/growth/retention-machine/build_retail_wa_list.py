"""
Interim WhatsApp outreach list for the retail team — customers with LIVE store credit expiring 17/07,
split into one tab per region (RioSul / Jardins / Recife / Sem regiao), ranked by credit value, each row
carrying a replenishment suggestion, a discovery suggestion, a wa.me link and a ready PT message.

Pass 1 (light): balance + address + phone for every SEND holder -> keep balance>0, bucket by region.
Pass 2 (heavy): last orders -> products, only for the top N per region.
Output: out/lista-whatsapp-credito-17jul.xlsx  (out/ is gitignored -> PII safe).
"""
import json, sys, time, re, urllib.request, unicodedata
from pathlib import Path
from collections import defaultdict, Counter
from urllib.parse import quote
from datetime import datetime
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

HERE = Path(__file__).resolve().parent; TEN = HERE.parent
SENDS = HERE / "learning" / "sends.jsonl"
OUT = HERE / "out"; OUT.mkdir(exist_ok=True)
sys.stdout.reconfigure(encoding="utf-8")
WAVES = {"2026-07-06-ge60d", "2026-07-07-ge45-59d-refill"}
CAP = 250  # per region

env = {}
for line in (TEN/".env").read_text(encoding="utf-8").splitlines():
    line=line.strip()
    if line and not line.startswith("#") and "=" in line:
        k,v=line.split("=",1); env[k.strip()]=v.strip()
URL=f"https://{env['SHOPIFY_SHOP_DOMAIN']}/admin/api/{env.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
def gql(q,v=None):
    b=json.dumps({"query":q,**({"variables":v} if v else {})}).encode()
    r=urllib.request.Request(URL,data=b,headers={"Content-Type":"application/json","X-Shopify-Access-Token":env["SHOPIFY_ADMIN_ACCESS_TOKEN"]})
    return json.loads(urllib.request.urlopen(r).read().decode())
def gql_retry(q,v=None,n=4):
    for a in range(n):
        try:
            d=gql(q,v)
            if "errors" in d and d["errors"]: raise RuntimeError(str(d["errors"])[:200])
            return d
        except Exception as e:
            if a==n-1: raise
            time.sleep(2*(a+1))

REGION = {
 "RioSul":{"PR","SC","RS","RJ","ES","MG"},
 "Shops Jardins":{"SP","MT","MS","GO","DF"},
 "Shopping Recife":{"AC","AP","AM","PA","RO","RR","TO","AL","BA","CE","MA","PB","PE","PI","RN","SE"},
}
def region_of(uf):
    for h,ufs in REGION.items():
        if uf in ufs: return h
    return "Sem região"
STORE_CITY={"RioSul":"rio de janeiro","Shops Jardins":"sao paulo","Shopping Recife":"recife"}
def norm_city(c):
    c=unicodedata.normalize("NFKD",(c or "")).encode("ascii","ignore").decode().lower().strip()
    return re.sub(r"\s+"," ",c)

def canon(title):
    t=(title or "").lower().strip()
    if t.startswith("travel size"): t=t.split("|",1)[1].strip() if "|" in t else t.replace("travel size","").strip()
    if "melon mood" in t: return "melon mood mist"
    if "mayday" in t: return "máscara mayday"
    if "condicionadora" in t or "condic" in t: return "máscara condicionadora"
    if "shampoo" in t and "seco" in t: return "shampoo a seco"
    if "shampoo" in t and "sulfato" in t: return "shampoo sem sulfato"
    if "pluma" in t: return "leave-in pluma"
    if ("leave" in t) or ("térmica" in t) or ("termica" in t) or ("proteção" in t) or ("protecao" in t): return "leave-in proteção térmica"
    if "primer" in t and "cachos" in t: return "primer cachos definidos"
    if "primer" in t and "liso" in t: return "primer liso intacto"
    if "antifrizz" in t: return "booster antifrizz"
    if "hidratante" in t: return "booster hidratante"
    if "fortificante" in t: return "booster fortificante"
    if "antioxidante" in t: return "booster antioxidante"
    if "definição" in t or "definicao" in t: return "booster definição"
    return None  # non-core (accessory/gift/kit) -> ignore
CADENCE={"melon mood mist":58,"máscara mayday":59,"booster antifrizz":94,"leave-in pluma":98,
 "shampoo sem sulfato":101,"máscara condicionadora":106,"primer cachos definidos":130,
 "leave-in proteção térmica":143,"booster hidratante":146,"booster fortificante":150,
 "primer liso intacto":155,"booster antioxidante":161,"booster definição":169,"shampoo a seco":177}
REC_PREF=["melon mood mist","leave-in pluma","booster antifrizz","máscara condicionadora"]

def brl(x): return ("R$ %.2f"%float(x)).replace(".",",")
def wa(phone, text=""):
    d=re.sub(r"\D","",phone or "")
    if not d: return ""
    if not d.startswith("55"): d="55"+d
    return "https://wa.me/"+d+("?text="+quote(text) if text else "")

# ---- collect SEND gids + fallback name/phone from sends.jsonl ----
seen=set(); gids=[]; fb={}
for line in SENDS.open(encoding="utf-8"):
    o=json.loads(line)
    if o.get("wave") in WAVES and o.get("arm")=="SEND":
        g=o["customer_gid"]
        if g not in seen:
            seen.add(g); gids.append(g); fb[g]={"first":o.get("first_name",""),"phone":o.get("phone","")}
print(f"SEND holders: {len(gids)}")

# ---- pass 1: balance + address + phone ----
Q1="""query($ids:[ID!]!){nodes(ids:$ids){... on Customer{id firstName lastName phone
  defaultAddress{city provinceCode} storeCreditAccounts(first:5){nodes{balance{amount}}}}}}"""
live={}
for i in range(0,len(gids),200):
    d=gql_retry(Q1,{"ids":gids[i:i+200]})
    for n in d["data"]["nodes"]:
        if not n: continue
        bal=round(sum(float(x["balance"]["amount"]) for x in n["storeCreditAccounts"]["nodes"]),2)
        if bal<=0: continue
        addr=n.get("defaultAddress") or {}
        live[n["id"]]={"first":n.get("firstName") or fb.get(n["id"],{}).get("first",""),
          "last":n.get("lastName") or "","phone":n.get("phone") or fb.get(n["id"],{}).get("phone",""),
          "city":addr.get("city") or "","uf":addr.get("provinceCode") or "","bal":bal,
          "ncity":norm_city(addr.get("city")),"region":region_of(addr.get("provinceCode") or "")}
    if (i//200)%10==0: print(f"  pass1 {min(i+200,len(gids))}/{len(gids)}  live={len(live)}");
    time.sleep(0.3)
print(f"live holders (>0): {len(live)}")

# ---- city counts (store cities) ----
cc=Counter(r["ncity"] for r in live.values())
print("\nCLIENTES POR CIDADE-LOJA (crédito vivo):")
for lab,key in [("São Paulo","sao paulo"),("Rio de Janeiro","rio de janeiro"),("Recife","recife")]:
    tot=sum(r["bal"] for r in live.values() if r["ncity"]==key)
    print(f"  {lab:16} {cc.get(key,0):5} clientes   R$ {tot:,.0f}".replace(",","."))
print("  top 12 cidades:", [(c or '(sem cidade)',n) for c,n in cc.most_common(12)])

# ---- pick top CAP per region ----
byreg=defaultdict(list)
for g,r in live.items(): byreg[r["region"]].append(g)
picked=[]
for reg,gg in byreg.items():
    sc=STORE_CITY.get(reg,"__none__")
    gg.sort(key=lambda g:(0 if live[g]["ncity"]==sc else 1, -live[g]["bal"]))  # store-city first, then value
    picked+=gg[:CAP]
print("per region (total live / picked):")
for reg in list(REGION)+["Sem região"]:
    print(f"  {reg:16} {len(byreg.get(reg,[])):5} / {min(len(byreg.get(reg,[])),CAP)}")

# ---- pass 2: last orders -> products (only picked) ----
Q2="""query($ids:[ID!]!){nodes(ids:$ids){... on Customer{id
  orders(first:6){nodes{createdAt lineItems(first:15){nodes{title}}}}}}}"""
for i in range(0,len(picked),50):
    d=gql_retry(Q2,{"ids":picked[i:i+50]})
    for n in d["data"]["nodes"]:
        if not n: continue
        ors=[o for o in n.get("orders",{}).get("nodes",[])]
        ors.sort(key=lambda o:o["createdAt"], reverse=True)
        owned=set(); last_prod=None; last_date=None
        for o in ors:
            for li in o["lineItems"]["nodes"]:
                c=canon(li["title"])
                if c: owned.add(c)
            if last_date is None:
                last_date=o["createdAt"][:10]
                for li in o["lineItems"]["nodes"]:
                    c=canon(li["title"])
                    if c and last_prod is None: last_prod=c
        rec=next((p for p in REC_PREF if p not in owned), None)
        live[n["id"]].update({"repor":last_prod,"descobrir":rec,"last_date":last_date,"owned":owned})
    time.sleep(0.4)
print("pass2 done")

# ---- build message ----
def msg(r):
    first=r["first"] or "tudo bem?"
    parts=[f"Oi, {first}! Aqui é da GE Beauty 💛 Vi que você tem {brl(r['bal'])} de crédito na sua conta, e ele vale só até sexta (17/07)."]
    parts.append("Dá pra usar em qualquer produto, sem valor mínimo.")
    rep=r.get("repor"); dec=r.get("descobrir")
    if rep and dec: parts.append(f"Quer que eu te ajude a escolher? Posso separar seu {rep} ou te mostrar o {dec} 😊")
    elif dec: parts.append(f"Quer que eu te ajude a escolher? Que tal conhecer o {dec}? 😊")
    else: parts.append("Quer que eu te ajude a escolher seus produtos? 😊")
    return " ".join(parts)

# ---- workbook ----
RED=PatternFill("solid",fgColor="DF3630"); GREY=PatternFill("solid",fgColor="F7F7F7")
YEL=PatternFill("solid",fgColor="FFF2CC")
HF=Font(name="Calibri",size=8,bold=True,color="FFFFFF"); BF=Font(name="Calibri",size=8)
BOLD=Font(name="Calibri",size=8,bold=True)
thin=Side(style="thin",color="D9D9D9"); BORDER=Border(thin,thin,thin,thin)
CEN=Alignment(horizontal="center",vertical="center"); LEFT=Alignment(horizontal="left",vertical="top",wrap_text=True)
COLS=[("#",5),("Nome",22),("Cidade/UF",18),("Crédito",11),("Última compra",13),
      ("Repor (produto)",22),("Descobrir",20),("WhatsApp",15),("Mensagem sugerida",70),("Status",13)]

wb=openpyxl.Workbook(); wb.remove(wb.active)
def sheet(name, gg):
    ws=wb.create_sheet(name[:31]); ws.sheet_view.showGridLines=False
    ws.append([c[0] for c in COLS])
    for j,(_,w) in enumerate(COLS,1):
        ws.column_dimensions[get_column_letter(j)].width=w
        cell=ws.cell(1,j); cell.font=HF; cell.fill=RED; cell.alignment=CEN; cell.border=BORDER
    ws.row_dimensions[1].height=24
    sc=STORE_CITY.get(name,"__none__")
    gg=sorted(gg,key=lambda g:(0 if live[g]["ncity"]==sc else 1, -live[g]["bal"]))
    for rank,g in enumerate(gg,1):
        r=live[g]
        name=(r["first"]+" "+r["last"]).strip() or "(sem nome)"
        cu=f"{r['city']}/{r['uf']}".strip("/")
        ld=""
        if r.get("last_date"):
            try: ld=datetime.strptime(r["last_date"],"%Y-%m-%d").strftime("%d/%m/%Y")
            except: ld=r["last_date"]
        m=msg(r); link=wa(r["phone"], m)
        row=[rank,name,cu,r["bal"],ld,r.get("repor") or "",r.get("descobrir") or "",
             "clique e envie" if link else "sem telefone", m,""]
        ws.append(row)
        i=ws.max_row
        for j in range(1,len(COLS)+1):
            c=ws.cell(i,j); c.font=BF; c.border=BORDER
            c.alignment=LEFT if j in (9,) else (CEN if j in (1,3,4,5,8) else Alignment(vertical="top",wrap_text=True))
        ws.cell(i,4).number_format='"R$" #,##0.00'; ws.cell(i,4).font=BOLD
        ws.cell(i,10).fill=YEL  # Status = editable
        if link:
            wc=ws.cell(i,8); wc.hyperlink=link; wc.font=Font(name="Calibri",size=8,color="0563C1",underline="single")
        ws.row_dimensions[i].height=54
    ws.freeze_panes="A2"; ws.auto_filter.ref=f"A1:{get_column_letter(len(COLS))}{ws.max_row}"
    return len(gg), sum(live[g]["bal"] for g in gg)

# resumo sheet first
rs=wb.create_sheet("Resumo"); rs.sheet_view.showGridLines=False
rs.column_dimensions["A"].width=26; rs.column_dimensions["B"].width=14; rs.column_dimensions["C"].width=16
rs.append(["Lista WhatsApp — crédito expira 17/07"]); rs.cell(1,1).font=Font(name="Calibri",size=11,bold=True,color="DF3630")
rs.append([]); rs.append(["Como usar:"]); rs.cell(3,1).font=BOLD
for t in ["1. Trabalhe de cima para baixo (maior crédito primeiro).",
          "2. Toque em 'abrir conversa' para chamar no WhatsApp.",
          "3. Ajuste a mensagem sugerida com seu jeito.",
          "4. Marque o Status: Contatado / Vendeu / Sem resposta.",
          "5. Prazo: o crédito expira sexta 17/07."]:
    rs.append([t]); rs.cell(rs.max_row,1).font=BF
rs.append([]); hdr=rs.max_row+1
rs.append(["Região","Clientes","Crédito total"])
for j in range(1,4): c=rs.cell(hdr,j); c.font=HF; c.fill=RED; c.alignment=CEN

order=["RioSul","Shops Jardins","Shopping Recife","Sem região"]
summary=[]
for reg in order:
    gg=byreg.get(reg,[])[:CAP]
    if not gg and reg=="Sem região": continue
    n,tot=sheet(reg,gg); summary.append((reg,n,tot))
for reg,n,tot in summary:
    rs.append([reg,n,tot]); rs.cell(rs.max_row,3).number_format='"R$" #,##0.00'
    for j in range(1,4): rs.cell(rs.max_row,j).font=BF
rs.append(["TOTAL",sum(n for _,n,_ in summary),sum(t for _,_,t in summary)])
for j in range(1,4): rs.cell(rs.max_row,j).font=BOLD
rs.cell(rs.max_row,3).number_format='"R$" #,##0.00'
_ord=["Resumo","RioSul","Shops Jardins","Shopping Recife","Sem região"]
wb._sheets.sort(key=lambda s:_ord.index(s.title) if s.title in _ord else 99)  # Resumo first

fn=OUT/"lista-whatsapp-credito-17jul.xlsx"; wb.save(fn)
print(f"\nsaved -> {fn}")
for reg,n,tot in summary: print(f"  {reg:16} {n:4} clientes  {brl(tot)}")
