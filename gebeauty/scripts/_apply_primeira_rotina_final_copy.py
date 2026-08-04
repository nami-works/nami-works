"""Apply FINAL approved copy + benefit icons to LIVE primeira-rotina LP.
Page 164913086784, bundles 10212940448064 / 10212940120384. SOLE writer.
Does NOT touch structural template (subtitle/volume pill/tab) or price/status/type."""
import json, urllib.request, sys
from pathlib import Path

def load_env():
    env = {}
    for line in (Path(__file__).resolve().parents[1] / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1); env[k.strip()] = v.strip()
    return env

ENV = load_env()
SHOP, TOKEN = ENV["SHOPIFY_SHOP_DOMAIN"], ENV["SHOPIFY_ADMIN_ACCESS_TOKEN"]
VER = ENV.get("SHOPIFY_API_VERSION", "2026-01")
URL = f"https://{SHOP}/admin/api/{VER}/graphql.json"

PAGE = "gid://shopify/Page/164913086784"
BUNDLE_A = "gid://shopify/Product/10212940448064"   # rotina com proteção térmica
BUNDLE_B = "gid://shopify/Product/10212940120384"   # rotina com frescor prolongado

def gql(q, v=None):
    body = json.dumps({"query": q, **({"variables": v} if v is not None else {})}).encode()
    req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    out = json.loads(urllib.request.urlopen(req).read().decode())
    if out.get("errors"): print("GQL-ERR", json.dumps(out["errors"])[:800])
    return out

def rt(t):
    return json.dumps({"type": "root", "children": [{"type": "paragraph", "children": [{"type": "text", "value": t}]}]})

DRY = "--dry" in sys.argv

# ---------- READ current state ----------
Q = """query($p:ID!,$a:ID!,$b:ID!){
  page(id:$p){ handle title
    intro_titulo: metafield(namespace:"custom",key:"intro_titulo"){value}
    colecao_titulo: metafield(namespace:"custom",key:"colecao_titulo"){value}
    p1: metafield(namespace:"custom",key:"intro_ponto_1"){value}
    p2: metafield(namespace:"custom",key:"intro_ponto_2"){value}
    p3: metafield(namespace:"custom",key:"intro_ponto_3"){value}
    p4: metafield(namespace:"custom",key:"intro_ponto_4"){value}
    cd: metafield(namespace:"custom",key:"colecao_descricao"){value}
  }
  a: product(id:$a){ title
    b1: metafield(namespace:"custom",key:"beneficio_em_destaque_1"){value}
    i1: metafield(namespace:"custom",key:"imagem_beneficio_em_destaque_1"){value}
  }
  b: product(id:$b){ title }
}"""
before = gql(Q, {"p": PAGE, "a": BUNDLE_A, "b": BUNDLE_B}).get("data", {})
print("=== BEFORE ===")
print(json.dumps(before, ensure_ascii=False, indent=1))

if DRY:
    print("DRY RUN — no writes."); sys.exit(0)

SET = """mutation m($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){metafields{key value type} userErrors{field message}}}"""
PUP = """mutation p($i:ProductUpdateInput!){productUpdate(product:$i){product{id title} userErrors{field message}}}"""

# ---------- 1) PAGE PILLS ----------
pills = [
    ("intro_ponto_1", "leve sua primeira rotina GE Beauty <strong>pagando apenas pelo shampoo</strong>"),
    ("intro_ponto_2", "máscara condicionadora + leave-in travel ou shampoo a seco + frete são <strong>por nossa conta</strong>"),
    ("intro_ponto_3", "<strong>oferta exclusiva para novos clientes</strong> que nunca compraram na marca"),
    ("intro_ponto_4", "<strong>fórmulas limpas de alta performance</strong>, sem sulfato, parabeno ou silicone"),
]
pill_m = [{"ownerId": PAGE, "namespace": "custom", "key": k, "type": "single_line_text_field", "value": v} for k, v in pills]
r = gql(SET, {"m": pill_m}).get("data", {}).get("metafieldsSet", {})
print("\n[1] pills set:", [x["key"] for x in r.get("metafields", [])], "| errors:", json.dumps(r.get("userErrors", [])))

# ---------- 4) COLLECTION DESCRIPTION (rich_text AST) ----------
col_m = [{"ownerId": PAGE, "namespace": "custom", "key": "colecao_descricao", "type": "rich_text_field",
          "value": rt("sua rotina não para aqui. leve os próximos aliados do seu ritual.")}]
r = gql(SET, {"m": col_m}).get("data", {}).get("metafieldsSet", {})
print("[4] colecao_descricao set:", [x["key"] for x in r.get("metafields", [])], "| errors:", json.dumps(r.get("userErrors", [])))

# ---------- 2) PRODUCT NAMES ----------
for gid, title in [(BUNDLE_A, "rotina com proteção térmica"), (BUNDLE_B, "rotina com frescor prolongado")]:
    r = gql(PUP, {"i": {"id": gid, "title": title}}).get("data", {}).get("productUpdate", {})
    print(f"[2] title -> {gid.split('/')[-1]}: {r.get('product',{}).get('title')!r} | errors:", json.dumps(r.get("userErrors", [])))

# ---------- 3) BENEFÍCIOS EM DESTAQUE (label + icon) ----------
benef = {
    BUNDLE_A: [
        ("protege do calor", "gid://shopify/MediaImage/41609342583104"),
        ("ritual completo",  "gid://shopify/MediaImage/44035754819904"),
        ("cabe na sua bolsa", "gid://shopify/MediaImage/44035754885440"),
    ],
    BUNDLE_B: [
        ("frescor que dura", "gid://shopify/MediaImage/44035754918208"),
        ("mais dias de raiz leve", "gid://shopify/MediaImage/44035754983744"),
        ("ritual completo", "gid://shopify/MediaImage/44035754819904"),
    ],
}
for gid, rows in benef.items():
    m = []
    for i, (label, media) in enumerate(rows, 1):
        m.append({"ownerId": gid, "namespace": "custom", "key": f"beneficio_em_destaque_{i}", "type": "single_line_text_field", "value": label})
        m.append({"ownerId": gid, "namespace": "custom", "key": f"imagem_beneficio_em_destaque_{i}", "type": "file_reference", "value": media})
    r = gql(SET, {"m": m}).get("data", {}).get("metafieldsSet", {})
    print(f"[3] benef {gid.split('/')[-1]} set:", [x["key"] for x in r.get("metafields", [])], "| errors:", json.dumps(r.get("userErrors", [])))

# ---------- VERIFY ----------
after = gql(Q, {"p": PAGE, "a": BUNDLE_A, "b": BUNDLE_B}).get("data", {})
print("\n=== AFTER ===")
print(json.dumps(after, ensure_ascii=False, indent=1))
print("\nPAGE_HANDLE:", after.get("page", {}).get("handle"))
