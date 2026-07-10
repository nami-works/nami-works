"""Align the 3 mist DRAFTS field-by-field to the Melon Mood pattern:
  1. Trim descriptionHtml to Melon shape (h3 + one scent line).
  2. Create a descricao_longa metaobject per scent (o_que_e, ingredientes,
     passo_a_passo, resultado) ACTIVE, and link via custom.descricao_longa_com_abas.
  3. Add custom.texture.
Products stay DRAFT. DRY-RUN by default; pass --execute.
"""
import json, sys, urllib.request, os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
URL = "https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json"
DRY = "--execute" not in sys.argv

INCI = {
 "rose": "Aqua, Alcohol, PEG-40 Hydrogenated Castor Oil, Parfum, Hexylene Glycol, Ceteareth-20, Glycerin, Castor Oil Propanediol Esters, Xylityl Sesquicaprylate, Caprylyl Glycol, Anadenanthera Colubrina Bark Extract, Disodium EDTA, Xylitol, Caprylic Acid, Citral, Citronellol, Geraniol, Hexyl Cinnamal, Hydroxycitronellal, Limonene, Linalool.",
 "pear": "Aqua, Alcohol, PEG-40 Hydrogenated Castor Oil, Parfum, Hexylene Glycol, Ceteareth-20, Glycerin, Castor Oil Propanediol Esters, Xylityl Sesquicaprylate, Caprylyl Glycol, Anadenanthera Colubrina Bark Extract, Disodium EDTA, Xylitol, Caprylic Acid, Benzyl Benzoate, Citral, Citronellol, Geraniol, Limonene, Linalool.",
 "santal": "Aqua, Alcohol, PEG-40 Hydrogenated Castor Oil, Parfum, Hexylene Glycol, Ceteareth-20, Glycerin, Castor Oil Propanediol Esters, Xylityl Sesquicaprylate, Caprylyl Glycol, Anadenanthera Colubrina Bark Extract, Disodium EDTA, Xylitol, Caprylic Acid, Cinnamal, Limonene.",
}
OQUEE = {
 "rose": "Um floral moderno, fresco e nada óbvio. O encontro delicado das rosas com notas cítricas e um fundo suave de musk e sândalo cria uma fragrância elegante, feminina e fácil de usar, agora em formato de bruma para cabelo e corpo. O Rose Ritual da GE Beauty é perfeito para usar depois do banho, antes de sair ou sempre que quiser adicionar um toque de cuidado ao seu ritual. Ideal para perfumar suavemente os fios e a pele: ajuda a selar as cutículas, realça o brilho do cabelo e mantém a pele hidratada e macia. Com fórmula limpa, leve e sem acúmulo de resíduo.",
 "pear": "A pêra fresca, as frutas verdes e o toque delicado da frésia se encontram em uma fragrância clean, vibrante e luminosa, bem do jeito GE Beauty: leve, mas com personalidade, agora em formato de bruma para cabelo e corpo. O Pear Fresh é perfeito para usar depois do banho, antes de sair ou sempre que quiser trazer leveza para o dia. Ideal para perfumar suavemente os fios e a pele: ajuda a selar as cutículas, realça o brilho do cabelo e mantém a pele hidratada e macia. Com fórmula limpa, leve e sem acúmulo de resíduo.",
 "santal": "O sândalo do jeito GE Beauty: leve, envolvente e nada pesado. O frescor do cardamomo e a profundidade do patchouli completam essa fragrância amadeirada, elegante e contemporânea, agora em formato de bruma para cabelo e corpo. O Santal Skin é perfeito para usar sozinho ou combinar com outras fragrâncias, criando o seu próprio ritual olfativo. Ideal para perfumar suavemente os fios e a pele: ajuda a selar as cutículas, realça o brilho do cabelo e mantém a pele hidratada e macia. Com fórmula limpa, leve e sem acúmulo de resíduo.",
}
DESCHTML = {
 "rose": "<h3><strong>perfume e brilho numa bruma de rosas para cabelo e corpo</strong></h3>\n<p>bruma perfumada de rosas, com um toque cítrico e um fundo suave de musk e sândalo, perfeita para usar depois do banho, antes de sair ou sempre que quiser.</p>",
 "pear": "<h3><strong>o frescor leve da pêra que perfuma e realça o brilho</strong></h3>\n<p>bruma perfumada de pêra e frutas verdes, com um coração delicado de frésia e lírio, perfeita para usar depois do banho, antes de sair ou sempre que quiser.</p>",
 "santal": "<h3><strong>amadeirado contemporâneo com sândalo para perfumar e realçar o brilho</strong></h3>\n<p>bruma perfumada de sândalo, com o frescor do cardamomo e a profundidade do patchouli, perfeita para usar sozinha ou combinada com outras brumas.</p>",
}
GID = {"rose": "gid://shopify/Product/10163564183872",
       "pear": "gid://shopify/Product/10163564216640",
       "santal": "gid://shopify/Product/10163564249408"}

PASSO = json.dumps({"type":"root","children":[{"listType":"ordered","type":"list","children":[
    {"type":"list-item","children":[{"type":"text","value":"Aplique diretamente sobre a pele e cabelo."}]},
    {"type":"list-item","children":[{"type":"text","value":"Reaplique sempre que desejar."}]}]}]}, ensure_ascii=False)
RESULTADO = json.dumps({"type":"root","children":[{"listType":"unordered","type":"list","children":[
    {"type":"list-item","children":[{"type":"text","value":"pele hidratada e macia"}]},
    {"type":"list-item","children":[{"type":"text","value":"cabelos perfumados e com brilho"}]}]}]}, ensure_ascii=False)


def gql(q, v=None):
    b = json.dumps({"query": q, "variables": v or {}}).encode()
    return json.loads(urllib.request.urlopen(urllib.request.Request(URL, data=b, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN}), timeout=60).read())


MO_CREATE = """
mutation($mo: MetaobjectCreateInput!) {
  metaobjectCreate(metaobject: $mo) {
    metaobject { id handle }
    userErrors { field message code }
  }
}
"""
PU = """mutation($input: ProductInput!){ productUpdate(input:$input){ product{id} userErrors{field message} } }"""
MF = """mutation($mf:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$mf){ userErrors{field message} } }"""

print(f"=== {'DRY-RUN' if DRY else 'EXECUTING'} field alignment ===\n")
for k in ["rose", "pear", "santal"]:
    print(f"{k}:")
    print(f"  descriptionHtml -> {len(DESCHTML[k])} ch (was ~970)")
    print(f"  metaobject descricao_longa: o_que_e={len(OQUEE[k])} ingredientes={len(INCI[k])} +passo_a_passo +resultado")
    print(f"  custom.texture -> 'Bruma leve e refrescante'")
    if DRY:
        continue
    # 1. create metaobject
    mo = {"type": "descricao_longa",
          "capabilities": {"publishable": {"status": "ACTIVE"}},
          "fields": [
              {"key": "o_que_e", "value": OQUEE[k]},
              {"key": "ingredientes", "value": INCI[k]},
              {"key": "passo_a_passo", "value": PASSO},
              {"key": "resultado", "value": RESULTADO},
          ]}
    rc = gql(MO_CREATE, {"mo": mo})
    d = rc["data"]["metaobjectCreate"]
    if d["userErrors"]:
        print(f"  metaobjectCreate ERR: {d['userErrors']}"); continue
    mo_gid = d["metaobject"]["id"]
    # 2. trim descriptionHtml
    r1 = gql(PU, {"input": {"id": GID[k], "descriptionHtml": DESCHTML[k]}})
    # 3. link metaobject + texture
    r3 = gql(MF, {"mf": [
        {"ownerId": GID[k], "namespace": "custom", "key": "descricao_longa_com_abas",
         "type": "metaobject_reference", "value": mo_gid},
        {"ownerId": GID[k], "namespace": "custom", "key": "texture",
         "type": "single_line_text_field", "value": "Bruma leve e refrescante"},
    ]})
    e1 = r1["data"]["productUpdate"]["userErrors"]
    e3 = r3["data"]["metafieldsSet"]["userErrors"]
    print(f"  -> metaobject {mo_gid.rsplit('/',1)[-1]} linked; descHtml {'OK' if not e1 else e1}; texture {'OK' if not e3 else e3}")

if DRY:
    print("\n(DRY-RUN - rerun with --execute.)")
