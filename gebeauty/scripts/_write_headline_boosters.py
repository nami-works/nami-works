"""Ad-hoc: create/link headlines_boosters metaobjects for the 5 boosters.

Idempotent: if a product already references a headline_booster metaobject,
update that entry in place; otherwise create a fresh one and link it via
the custom.headline_booster product metafield.
"""
import json, urllib.request
from pathlib import Path

TOKEN = None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding="utf-8"):
    if line.startswith("SHOPIFY_ADMIN_ACCESS_TOKEN="):
        TOKEN = line.strip().split("=", 1)[1]

URL = "https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json"


def gql(q, v=None):
    body = json.dumps({"query": q, **({"variables": v} if v else {})}).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode("utf-8"))


# handle -> (product_gid, o_que_faz, onde_usar)
BOOSTERS = {
    "booster-fortificante": (
        "gid://shopify/Product/8803150987584",
        "força extra para fios fracos: fortalece da raiz às pontas e reduz a quebra",
        "use com seu shampoo, máscara ou leave-in e potencialize cada etapa",
    ),
    "booster-hidratante": (
        "gid://shopify/Product/8803151315264",
        "hidratação profunda que devolve maciez, brilho e leveza aos fios ressecados",
        "use puro como finalizador ou use com seu shampoo, máscara ou leave-in",
    ),
    "booster-definicao": (
        "gid://shopify/Product/8803151708480",
        "cachos e ondas definidos por até 12 horas, com menos frizz e mais movimento",
        "use puro para retocar a definição ou use com o shampoo, máscara ou leave-in",
    ),
    "booster-antioxidante": (
        "gid://shopify/Product/8803151806784",
        "escudo contra sol, poluição e calor: preserva cor, vitalidade e brilho por mais tempo",
        "use com seu shampoo, máscara ou leave-in para uma camada extra de proteção",
    ),
    "booster-antifrizz": (
        "gid://shopify/Product/9758954291520",
        "adeus frizz: alinha os fios e reduz o volume, com brilho que dura mesmo nos dias úmidos",
        "use com a máscara ou o leave-in, ou use puro como finalizador no comprimento",
    ),
}

CREATE = """
mutation($input: MetaobjectCreateInput!){
  metaobjectCreate(metaobject:$input){
    metaobject{ id handle }
    userErrors{ field message }
  }
}"""

UPDATE = """
mutation($id: ID!, $input: MetaobjectUpdateInput!){
  metaobjectUpdate(id:$id, metaobject:$input){
    metaobject{ id handle }
    userErrors{ field message }
  }
}"""

SETMF = """
mutation($mf: [MetafieldsSetInput!]!){
  metafieldsSet(metafields:$mf){
    metafields{ id }
    userErrors{ field message }
  }
}"""

PROD_Q = """
query($id: ID!){
  product(id:$id){
    metafield(namespace:"custom", key:"headline_booster"){
      reference{ ... on Metaobject { id } }
    }
  }
}"""


def fields_for(o_que_faz, onde_usar):
    return [{"key": "o_que_faz", "value": o_que_faz},
            {"key": "onde_usar", "value": onde_usar}]


for handle, (pgid, faz, onde) in BOOSTERS.items():
    # check existing link
    pr = gql(PROD_Q, {"id": pgid})
    ref = pr["data"]["product"]["metafield"]
    existing = ref["reference"]["id"] if ref and ref.get("reference") else None

    if existing:
        r = gql(UPDATE, {"id": existing, "input": {
            "fields": fields_for(faz, onde),
            "capabilities": {"publishable": {"status": "ACTIVE"}},
        }})
        res = r["data"]["metaobjectUpdate"]
        errs = res["userErrors"]
        print(f"[{handle}] UPDATED {existing} errs={errs}")
    else:
        r = gql(CREATE, {"input": {
            "type": "headlines_boosters",
            "handle": "headline-" + handle,
            "fields": fields_for(faz, onde),
            "capabilities": {"publishable": {"status": "ACTIVE"}},
        }})
        res = r["data"]["metaobjectCreate"]
        errs = res["userErrors"]
        if errs:
            print(f"[{handle}] CREATE FAILED errs={errs}")
            continue
        mo_id = res["metaobject"]["id"]
        sr = gql(SETMF, {"mf": [{
            "ownerId": pgid,
            "namespace": "custom",
            "key": "headline_booster",
            "type": "metaobject_reference",
            "value": mo_id,
        }]})
        serrs = sr["data"]["metafieldsSet"]["userErrors"]
        print(f"[{handle}] CREATED {mo_id} + LINKED errs={serrs}")
