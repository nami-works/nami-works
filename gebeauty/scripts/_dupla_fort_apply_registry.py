"""Enrich DRAFT bundle 'dupla shampoo + booster fortificante' (GID 10217099297088)
to full siblings-parity. Copy sourced from approved GEB 001 + GEB 019 content.
Run from c:\\claude\\gebeauty: C:/Python314/python.exe scripts/_dupla_fort_apply_registry.py [--live]
Without --live it prints the plan and resolves the variant id but writes nothing."""
import json, sys, urllib.request
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
LIVE = "--live" in sys.argv
ENV = Path(__file__).resolve().parent.parent / ".env"
cfg = {}
for l in ENV.read_text(encoding="utf-8").splitlines():
    l = l.strip()
    if l.startswith("SHOPIFY") and "=" in l:
        k, v = l.split("=", 1); cfg[k.strip()] = v.strip().strip('"').strip("'")
URL = f"https://{cfg['SHOPIFY_SHOP_DOMAIN']}/admin/api/{cfg.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
def gql(q, v=None):
    b = json.dumps({"query": q, "variables": v or {}}).encode()
    r = urllib.request.Request(URL, data=b, headers={"Content-Type": "application/json", "X-Shopify-Access-Token": cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]})
    return json.loads(urllib.request.urlopen(r).read().decode())

PID   = "gid://shopify/Product/10217099297088"
SHAMP = "gid://shopify/Product/8803151282496"   # GEB 001
BOOST = "gid://shopify/Product/8803150987584"   # GEB 019
BADGE = "gid://shopify/Metaobject/177092624704" # r10-off (shared)

# ---- composed copy (all from approved component content) ----
DESC_HTML = ("<h3><strong>força e limpeza que equilibram o couro cabeludo</strong></h3>\n"
             "<p>o shampoo sem sulfato limpa sem ressecar e o booster fortificante, com biotina e "
             "algas vermelhas, fortalece os fios e controla a queda</p>")
SEO_TITLE = "Dupla Shampoo Sem Sulfato + Booster Fortificante | GE Beauty"
SEO_DESC  = ("Força e leveza para o seu cabelo. O Shampoo Sem Sulfato GE Beauty limpa sem ressecar e "
             "equilibra a oleosidade, enquanto o Booster Fortificante com biotina, complexo vitamínico, "
             "algas vermelhas e alcaçuz fortalece os fios e revitaliza o couro cabeludo.")
TAGS = ["bundle","dupla","dupla_shampoo+booster","full-size","kit-ate-300","kit-com-booster",
        "kit-full-size","kits","contem-shampoo","antiqueda","forca-e-nutricao","couro-cabeludo","queda-quebra"]
FINALIDADE = "limpa, fortalece e controla a queda"

def rt_list(items, ordered=False):
    return json.dumps({"type":"root","children":[{"type":"list","listType":"ordered" if ordered else "unordered",
        "children":[{"type":"list-item","children":c} for c in items]}]}, ensure_ascii=False)
def txt(v, bold=False):
    d={"type":"text","value":v}
    if bold: d["bold"]=True
    return d

CARACT = rt_list([
    [txt("limpeza sem sulfato",True), txt(" que não resseca nem pesa")],
    [txt("fios mais fortes",True),     txt(" e menos quebra")],
    [txt("controle da oleosidade",True), txt(" e do couro cabeludo")],
    [txt("rotina completa",True),      txt(" de força, do banho ao pós")],
])
PASSO = rt_list([
    [txt("Aplique o Shampoo sem Sulfato nos cabelos úmidos, massageie o couro cabeludo e enxágue bem.")],
    [txt("Para potencializar, misture de 3 a 7 gotas do Booster Fortificante na porção de shampoo antes de aplicar, ou adicione à sua máscara.")],
    [txt("Repita a aplicação do shampoo se necessário e siga com o restante da sua rotina.")],
], ordered=True)
RESULT = rt_list([
    [txt("Couro cabeludo limpo e equilibrado, sem irritar")],
    [txt("Fios mais fortes e resistentes, com menos quebra")],
    [txt("Cabelo leve, com brilho saudável e sem pesar")],
])
O_QUE_E = ("A dupla que limpa, fortalece e controla a queda numa rotina só.\n\n"
    "O Shampoo sem Sulfato GE Beauty limpa profundamente sem ressecar, com manteiga de murumuru que repõe a "
    "nutrição e pantenol que hidrata sem pesar, mantendo o couro cabeludo equilibrado.\n\n"
    "O Booster Fortificante entra em qualquer etapa da rotina com biotina que fortalece a fibra capilar, "
    "algas vermelhas que aumentam a resistência dos fios e alcaçuz que acalma e protege o couro cabeludo.\n\n"
    "Juntos, deixam o cabelo mais forte, leve e cheio de vida, da raiz às pontas.")
INGRED = ("Shampoo sem Sulfato\n"
    "• Pantenol (pró-vitamina B5): hidrata, revitaliza e reduz a formação de pontas duplas.\n"
    "• Manteiga de murumuru: semente amazônica de ação super hidratante e nutritiva.\n\n"
    "Booster Fortificante\n"
    "• Biotina: fortalece a fibra capilar e atua na prevenção da queda.\n"
    "• Algas vermelhas: preservam e fortalecem a integridade do fio.\n"
    "• Pantenol: vitamina B5 de alta capacidade hidratante, nutre e condiciona.\n"
    "• Alcaçuz: adstringente e calmante para o couro cabeludo.")

# resolve variant id
vq = gql('query($id:ID!){product(id:$id){variants(first:1){nodes{id price compareAtPrice}}}}', {"id":PID})
VAR = vq["data"]["product"]["variants"]["nodes"][0]
print("variant:", VAR["id"], "price", VAR["price"], "compareAt", VAR["compareAtPrice"])
print("LIVE =", LIVE)

if not LIVE:
    print("\n--- plan (no writes) ---")
    print("productType=kit | tags:", TAGS)
    print("price -> 160.00 | compareAtPrice -> 170.00")
    print("metaobject descricao_longa: o_que_e/passo_a_passo/resultado/itens_do_kit/ingredientes")
    print("metafields: finalidade, caracteristicas, google cat x2, target-gender, etiquetas(r10-off), descricao_longa_com_abas")
    sys.exit(0)

# 1) create descricao_longa metaobject (ACTIVE) — idempotent by handle
HANDLE = "descricao-longa-dupla-shampoo-booster-fortificante"
existing = gql('query($h:MetaobjectHandleInput!){ metaobjectByHandle(handle:$h){ id } }',
               {"h":{"type":"descricao_longa","handle":HANDLE}})["data"]["metaobjectByHandle"]
if existing:
    MO_GID = existing["id"]; print("metaobject reused:", MO_GID)
else:
    MOC = """mutation($m:MetaobjectCreateInput!){ metaobjectCreate(metaobject:$m){
      metaobject{ id handle } userErrors{ field message } } }"""
    mo = gql(MOC, {"m":{
      "type":"descricao_longa","handle":HANDLE,
      "capabilities":{"publishable":{"status":"ACTIVE"}},
      "fields":[
        {"key":"o_que_e","value":O_QUE_E},
        {"key":"passo_a_passo","value":PASSO},
        {"key":"resultado","value":RESULT},
        {"key":"itens_do_kit","value":json.dumps([SHAMP,BOOST])},
        {"key":"ingredientes","value":INGRED},
      ]}})
    err = mo["data"]["metaobjectCreate"]["userErrors"]
    if err: print("METAOBJECT ERRORS:", err); sys.exit(1)
    MO_GID = mo["data"]["metaobjectCreate"]["metaobject"]["id"]
    print("metaobject created:", MO_GID)

# 2) productUpdate: type, tags, descriptionHtml, seo
PU = """mutation($p:ProductUpdateInput!){ productUpdate(product:$p){
  product{ id productType } userErrors{ field message } } }"""
pu = gql(PU, {"p":{"id":PID,"productType":"kit","tags":TAGS,"descriptionHtml":DESC_HTML,
  "seo":{"title":SEO_TITLE,"description":SEO_DESC}}})
err = pu["data"]["productUpdate"]["userErrors"]
if err: print("PRODUCT UPDATE ERRORS:", err); sys.exit(1)
print("product core updated (type/tags/desc/seo)")

# 3) variant price + compareAt
VB = """mutation($pid:ID!,$v:[ProductVariantsBulkInput!]!){ productVariantsBulkUpdate(productId:$pid,variants:$v){
  productVariants{ id price compareAtPrice } userErrors{ field message } } }"""
vb = gql(VB, {"pid":PID,"v":[{"id":VAR["id"],"price":"160.00","compareAtPrice":"170.00"}]})
err = vb["data"]["productVariantsBulkUpdate"]["userErrors"]
if err: print("VARIANT ERRORS:", err); sys.exit(1)
print("variant priced:", vb["data"]["productVariantsBulkUpdate"]["productVariants"])

# 4) metafields
MS = """mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){
  metafields{ namespace key } userErrors{ field message } } }"""
mfs = [
  {"ownerId":PID,"namespace":"custom","key":"finalidade","type":"single_line_text_field","value":FINALIDADE},
  {"ownerId":PID,"namespace":"custom","key":"caracteristicas","type":"rich_text_field","value":CARACT},
  {"ownerId":PID,"namespace":"custom","key":"etiquetas","type":"list.metaobject_reference","value":json.dumps([BADGE])},
  {"ownerId":PID,"namespace":"custom","key":"descricao_longa_com_abas","type":"metaobject_reference","value":MO_GID},
  {"ownerId":PID,"namespace":"mm-google-shopping","key":"google_product_category","type":"single_line_text_field","value":"543615"},
  {"ownerId":PID,"namespace":"mc-facebook","key":"google_product_category","type":"single_line_text_field","value":"543615"},
]
ms = gql(MS, {"m":mfs})
err = ms["data"]["metafieldsSet"]["userErrors"]
if err: print("METAFIELD ERRORS:", err)
print("metafields set:", [f"{m['namespace']}.{m['key']}" for m in ms["data"]["metafieldsSet"]["metafields"]])
print("\nDONE registry. Run _dupla_fort_apply_hero.py for the image.")
