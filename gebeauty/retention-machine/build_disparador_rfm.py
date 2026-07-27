"""
Disparador (colunas cruas) — credito vivo (expira 17/07) nas 3 cidades-loja, com rfm_group nativo do Shopify
e mensagem por classe RFM (aprovadas por Lucas). Uma aba por loja. Colunas: rfm | First Name | Phone | Mensagem RFM | Credito(ref).
Saida: out/disparador-credito-17jul-colunas.xlsx (out/ gitignored -> PII safe).
"""
import json, sys, time, re, urllib.request, unicodedata
from pathlib import Path
from collections import defaultdict, Counter
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter
HERE=Path(__file__).resolve().parent; TEN=HERE.parent
OUT=HERE/"out"; OUT.mkdir(exist_ok=True)
SENDS=HERE/"learning"/"sends.jsonl"
sys.stdout.reconfigure(encoding="utf-8")
WAVES={"2026-07-06-ge60d","2026-07-07-ge45-59d-refill"}
env={}
for l in (TEN/".env").read_text(encoding="utf-8").splitlines():
    l=l.strip()
    if l and not l.startswith("#") and "=" in l: k,v=l.split("=",1); env[k.strip()]=v.strip()
URL=f"https://{env['SHOPIFY_SHOP_DOMAIN']}/admin/api/{env.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
def gql(q,v=None):
    b=json.dumps({"query":q,**({"variables":v} if v else {})}).encode()
    r=urllib.request.Request(URL,data=b,headers={"Content-Type":"application/json","X-Shopify-Access-Token":env["SHOPIFY_ADMIN_ACCESS_TOKEN"]})
    return json.loads(urllib.request.urlopen(r).read().decode())
def gqlr(q,v=None,n=5):
    for a in range(n):
        try:
            d=gql(q,v)
            if d.get("errors"): raise RuntimeError(str(d["errors"])[:150])
            return d
        except Exception as e:
            if a==n-1: raise
            time.sleep(2*(a+1))

def ncity(c):
    c=unicodedata.normalize("NFKD",(c or "")).encode("ascii","ignore").decode().lower().strip()
    return re.sub(r"\s+"," ",c)
STORE={"sao paulo":"São Paulo","rio de janeiro":"Rio de Janeiro","recife":"Recife"}
def brl(x): return ("%.2f"%float(x)).replace(".",",")
def firstname(s):
    t=(s or "").strip().split()
    return t[0].capitalize() if t else ""
def phonefmt(p):
    d=re.sub(r"\D","",p or "")
    if not d: return ""
    if not d.startswith("55"): d="55"+d
    return d
def valid_mobile(d):
    # celular BR com DDI: 55 + DDD(2) + 9 + 8 dígitos. O 5º dígito precisa ser 9 (exclui fixos/malformados).
    return len(d)==13 and d.startswith("55") and d[4]=="9"

MSG={
"A":"💛 *Seu crédito de R$ {valor} expira sexta (17/07)!*¶¶{nome}, que tal renovar seus queridinhos? Dá pra usar sem valor mínimo, no que você quiser. Posso montar o pedido com você? ✨¶¶*Com carinho, {vendedor}* da GE Beauty {shopping}",
"B":"💛 *Seu crédito de R$ {valor} expira sexta (17/07)!*¶¶{nome}, é a chance perfeita de conhecer seus próximos favoritos, sem valor mínimo. Posso te ajudar a escolher? 🌿¶¶*Com carinho, {vendedor}* da GE Beauty {shopping}",
"C":"⏳ *Seu crédito de R$ {valor} expira sexta (17/07)!*¶¶{nome}, seu crédito está te esperando e vale em qualquer produto, sem valor mínimo. Posso te mostrar algumas opções? ✨¶¶*Com carinho, {vendedor}* da GE Beauty {shopping}",
"D":"💛 *Seu crédito de R$ {valor} expira sexta (17/07)!*¶¶{nome}, é o empurrãozinho perfeito pra retomar seu autocuidado, e dá pra usar sem valor mínimo, no que quiser. Posso te contar o que temos de novidades? 🌿¶¶*Com carinho, {vendedor}* da GE Beauty {shopping}",
}
VARMAP={"CHAMPIONS":"A","LOYAL":"A","ACTIVE":"A","POTENTIAL_LOYALIST":"A",
"NEW":"B","PROMISING":"B",
"NEEDS_ATTENTION":"C","ABOUT_TO_SLEEP":"C","AT_RISK":"C",
"PREVIOUSLY_LOYAL":"D","ALMOST_LOST":"D","DORMANT":"D","CANT_LOSE":"D","HIBERNATING":"D","LOST":"D"}
GROUPS=list(VARMAP.keys())+["PROSPECTS"]

# 1) SEND gids
seen=set(); gids=[]; fbphone={}
for line in SENDS.open(encoding="utf-8"):
    o=json.loads(line)
    if o.get("wave") in WAVES and o.get("arm")=="SEND":
        g=o["customer_gid"]
        if g not in seen: seen.add(g); gids.append(g)
        if o.get("phone"): fbphone.setdefault(g,o["phone"])
print("SEND holders:",len(gids)); sys.stdout.flush()

# 2) balance + city + name + phone ; keep balance>0 AND city in 3 stores
Q1="""query($ids:[ID!]!){nodes(ids:$ids){... on Customer{id firstName lastName phone
  defaultAddress{city phone} storeCreditAccounts(first:5){nodes{balance{amount}}}}}}"""
live={}
for i in range(0,len(gids),200):
    d=gqlr(Q1,{"ids":gids[i:i+200]})
    for n in d["data"]["nodes"]:
        if not n: continue
        bal=round(sum(float(x["balance"]["amount"]) for x in n["storeCreditAccounts"]["nodes"]),2)
        if bal<=0: continue
        addr=n.get("defaultAddress") or {}
        nc=ncity(addr.get("city"))
        if nc not in STORE: continue
        cands=[n.get("phone"),addr.get("phone"),fbphone.get(n["id"])]
        ph=next((phonefmt(c) for c in cands if valid_mobile(phonefmt(c))),"")
        if not ph: ph=next((phonefmt(c) for c in cands if phonefmt(c)),"")
        live[n["id"]]={"first":firstname(n.get("firstName")),"phone":ph,"bal":bal,"store":STORE[nc]}
    if (i//200)%10==0: print(f"  pass1 {min(i+200,len(gids))}/{len(gids)} store-city live={len(live)}"); sys.stdout.flush()
    time.sleep(0.3)
print("store-city live holders:",len(live)); sys.stdout.flush()

# 3) rfm_group per holder via customerSegmentMembers (whole base per group, keep holders)
QSM="""query($q:String!,$a:String){customerSegmentMembers(first:250,after:$a,query:$q){
  edges{node{id}} pageInfo{hasNextPage endCursor}}}"""
gid2grp={}
for g in GROUPS:
    after=None; got=0
    while True:
        try:
            d=gqlr(QSM,{"q":f"rfm_group = '{g}'","a":after})
        except Exception as e:
            print(f"  group {g}: skip ({repr(e)[:60]})"); break
        cs=d["data"]["customerSegmentMembers"]
        for e in cs["edges"]:
            cgid=e["node"]["id"].replace("CustomerSegmentMember","Customer")
            if cgid in live: gid2grp[cgid]=g; got+=1
        if cs["pageInfo"]["hasNextPage"]: after=cs["pageInfo"]["endCursor"]
        else: break
        time.sleep(0.15)
    print(f"  rfm {g}: {got} holders"); sys.stdout.flush()

# 4) assemble
tabs=defaultdict(list); grpcount=Counter(); unassigned=0; skip_bal=skip_ph=0
for gid,r in live.items():
    if r["bal"]<10: skip_bal+=1; continue
    if not valid_mobile(r["phone"]): skip_ph+=1; continue
    g=gid2grp.get(gid)
    if g is None: unassigned+=1; var="D"; g="(sem rfm)"
    elif g=="PROSPECTS": continue
    else: var=VARMAP.get(g,"D")
    grpcount[g]+=1
    msg=MSG[var].replace("{valor}",brl(r["bal"]))
    tabs[r["store"]].append({"rfm":g,"first":r["first"],"phone":r["phone"],"msg":msg,"bal":r["bal"]})

print("\nRFM distribution (incluidos apos filtros):")
for g,c in grpcount.most_common(): print(f"  {g:22} {c}")
if unassigned: print(f"  (sem rfm -> default D): {unassigned}")
print(f"filtrados: crédito<R$10={skip_bal} | telefone!=13díg={skip_ph}")

# 5) workbook
RED=PatternFill("solid",fgColor="DF3630"); HF=Font(name="Calibri",size=8,bold=True,color="FFFFFF")
BF=Font(name="Calibri",size=8); CEN=Alignment(horizontal="center",vertical="center")
LEFT=Alignment(horizontal="left",vertical="top",wrap_text=True)
COLS=[("rfm",22),("First Name",16),("Crédito (ref)",12),("Phone",16),("Mensagem RFM",90)]
wb=openpyxl.Workbook(); wb.remove(wb.active)
for store in ["São Paulo","Rio de Janeiro","Recife"]:
    ws=wb.create_sheet(store); ws.sheet_view.showGridLines=False
    ws.append([c[0] for c in COLS])
    for j,(_,w) in enumerate(COLS,1):
        ws.column_dimensions[get_column_letter(j)].width=w
        cc=ws.cell(1,j); cc.font=HF; cc.fill=RED; cc.alignment=CEN
    ws.freeze_panes="A2"
    for r in sorted(tabs.get(store,[]),key=lambda x:-x["bal"]):
        ws.append([r["rfm"],r["first"],r["bal"],r["phone"],r["msg"]])
        i=ws.max_row
        for j in range(1,6):
            c=ws.cell(i,j); c.font=BF
            c.alignment=LEFT if j==5 else (CEN if j in (3,4) else Alignment(vertical="top"))
        ws.cell(i,3).number_format='"R$" #,##0.00'
        ws.row_dimensions[i].height=42
    ws.auto_filter.ref=f"A1:E{ws.max_row}"
fn=OUT/"disparador-credito-17jul-colunas.xlsx"
try: wb.save(fn)
except PermissionError: fn=OUT/"disparador-credito-17jul-colunas-v2.xlsx"; wb.save(fn)
print("\nsaved ->",fn)
for store in ["São Paulo","Rio de Janeiro","Recife"]:
    rows=tabs.get(store,[]); print(f"  {store:16} {len(rows)} clientes  R$ {sum(x['bal'] for x in rows):,.0f}".replace(",","."))
