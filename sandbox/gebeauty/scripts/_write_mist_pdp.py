"""Write PDP descriptionHtml + SEO + parity metafields (incl INCI) to the 3 mist DRAFTS.
Products stay DRAFT. Persists artifacts to content-director/2026-06-22_mists/.
DRY-RUN by default; pass --execute.
"""
import json, sys, urllib.request, os
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
URL = "https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json"
DRY = "--execute" not in sys.argv
OUTDIR = ROOT / "content-director" / "2026-06-22_mists"

CARACT = [("perfuma suavemente", " cabelo e corpo"),
          ("sela as cutículas", " e realça o brilho dos fios"),
          ("hidrata a pele", " sem pesar"),
          ("fórmula leve", ", sem acúmulo de resíduo")]
BENEFITS_HTML = ("<ul><li>Perfuma suavemente cabelo e corpo</li>"
                 "<li>Ajuda a selar as cutículas e realça o brilho</li>"
                 "<li>Hidrata a pele sem pesar</li>"
                 "<li>Fórmula leve, sem acúmulo de resíduo</li></ul>")


def rich(items):
    root = {"type": "root", "children": [{"listType": "unordered", "type": "list", "children": [
        {"type": "list-item", "children": [
            {"type": "text", "value": b, "bold": True}, {"type": "text", "value": r}]}
        for b, r in items]}]}
    return json.dumps(root, ensure_ascii=False)


INCI = {
 "rose": "Aqua, Alcohol, Peg-40 Hydrogenated Castor Oil, Parfum, Hexylene Glycol, Ceteareth-20, Glycerin, Castor Oil Propanediol Esters, Xylityl Sesquicaprylate, Caprylyl Glycol, Anadenanthera Colubrina Bark Extract, Disodium Edta, Xylitol, Caprylic Acid, Citral, Citronellol, Geraniol, Hexyl Cinnamal, Hydroxycitronellal, Limonene, Linalool",
 "pear": "Aqua, Alcohol, Peg-40 Hydrogenated Castor Oil, Parfum, Hexylene Glycol, Ceteareth-20, Glycerin, Castor Oil Propanediol Esters, Xylityl Sesquicaprylate, Caprylyl Glycol, Anadenanthera Colubrina Bark Extract, Disodium Edta, Xylitol, Caprylic Acid, Benzyl Benzoate, Citral, Citronellol, Geraniol, Limonene, Linalool",
 "santal": "Aqua, Alcohol, Peg-40 Hydrogenated Castor Oil, Parfum, Hexylene Glycol, Ceteareth-20, Glycerin, Castor Oil Propanediol Esters, Xylityl Sesquicaprylate, Caprylyl Glycol, Anadenanthera Colubrina Bark Extract, Disodium Edta, Xylitol, Caprylic Acid, Cinnamal, Limonene",
}

PRODUCTS = [
 {"key": "rose", "gid": "gid://shopify/Product/10163564183872", "handle": "rose-ritual-body-hair-mist",
  "h3": "perfume e brilho numa bruma de rosas para cabelo e corpo",
  "scent": "bruma perfumada de rosas, com um toque cítrico e um fundo suave de musk e sândalo. um floral elegante e fácil de usar, para perfumar depois do banho, antes de sair ou sempre que quiser um toque de cuidado no seu ritual.",
  "combina": '<a href="/products/melon-mood-body-hair-mist">Melon Mood</a>, <a href="/products/pear-fresh-body-hair-mist">Pear Fresh</a> e <a href="/products/santal-skin-body-hair-mist">Santal Skin</a>',
  "seo_title": "Rose Ritual Body & Hair Mist, rosas e sândalo | GE Beauty",
  "seo_desc": "Bruma perfumada para cabelo e corpo com fragrância de rosas, musk e sândalo. Perfuma, realça o brilho e deixa a pele macia. No seu tempo, do seu jeito."},
 {"key": "pear", "gid": "gid://shopify/Product/10163564216640", "handle": "pear-fresh-body-hair-mist",
  "h3": "o frescor leve da pêra que perfuma e realça o brilho",
  "scent": "bruma perfumada de pêra e frutas verdes, com um coração delicado de frésia e lírio. uma fragrância clean, vibrante e leve, perfeita para perfumar depois do banho, antes de sair ou sempre que quiser trazer leveza para o dia.",
  "combina": '<a href="/products/melon-mood-body-hair-mist">Melon Mood</a>, <a href="/products/rose-ritual-body-hair-mist">Rose Ritual</a> e <a href="/products/santal-skin-body-hair-mist">Santal Skin</a>',
  "seo_title": "Pear Fresh Body & Hair Mist, pêra e frésia | GE Beauty",
  "seo_desc": "Bruma perfumada para cabelo e corpo com fragrância de pêra, frésia e lírio. Perfuma, realça o brilho e deixa a pele macia. No seu tempo, do seu jeito."},
 {"key": "santal", "gid": "gid://shopify/Product/10163564249408", "handle": "santal-skin-body-hair-mist",
  "h3": "amadeirado contemporâneo com sândalo para perfumar e realçar o brilho",
  "scent": "bruma perfumada de sândalo, com o frescor do cardamomo e a profundidade do patchouli. uma fragrância amadeirada, leve e envolvente, perfeita para usar sozinha ou combinar com outras brumas e criar o seu próprio ritual olfativo.",
  "combina": '<a href="/products/melon-mood-body-hair-mist">Melon Mood</a>, <a href="/products/rose-ritual-body-hair-mist">Rose Ritual</a> e <a href="/products/pear-fresh-body-hair-mist">Pear Fresh</a>',
  "seo_title": "Santal Skin Body & Hair Mist, sândalo e patchouli | GE Beauty",
  "seo_desc": "Bruma amadeirada para cabelo e corpo com sândalo, cardamomo e patchouli. Perfuma, realça o brilho e deixa a pele macia. No seu tempo, do seu jeito."},
]

BENEFIT_P = ("perfuma suavemente os fios e a pele, ajuda a selar as cutículas e realça o brilho do cabelo. "
             "fórmula leve, que hidrata sem pesar e sem deixar resíduo.")


def body_html(p):
    return (f"<h3><strong>{p['h3']}</strong></h3>\n"
            f"<p>{p['scent']}</p>\n"
            f"<p>{BENEFIT_P}</p>\n"
            f"<h3><strong>como usar</strong></h3>\n"
            f"<p>aplique diretamente sobre a pele e o cabelo e reaplique sempre que quiser.</p>\n"
            f"<h3><strong>combina com</strong></h3>\n"
            f"<p>finalize o ritual com o <a href=\"/products/leave-in-pluma\">Leave-in Pluma</a> "
            f"e descubra a coleção de brumas: {p['combina']}.</p>\n"
            f"<p>no seu tempo, do seu jeito.</p>")


def gql(q, v=None):
    b = json.dumps({"query": q, "variables": v or {}}).encode()
    r = urllib.request.Request(URL, data=b, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(r, timeout=60).read())


PU = """mutation($input: ProductInput!){ productUpdate(input:$input){ product{ id title } userErrors{ field message } } }"""
MF = """mutation($mf:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$mf){ userErrors{ field message } } }"""

# QA: em dash + splash + seo ranges
print(f"=== {'DRY-RUN' if DRY else 'EXECUTING'} mist PDP write ===\n")
fail = False
OUTDIR.mkdir(parents=True, exist_ok=True)
for p in PRODUCTS:
    html = body_html(p)
    blob = html + p["seo_title"] + p["seo_desc"]
    if "—" in blob or "–" in blob:
        print(f"  QA FAIL {p['key']}: dash"); fail = True
    if "splash" in blob.lower():
        print(f"  QA FAIL {p['key']}: splash"); fail = True
    lt, ld = len(p["seo_title"]), len(p["seo_desc"])
    flag_t = "" if 45 <= lt <= 70 else "  <-- OUT OF RANGE"
    flag_d = "" if 140 <= ld <= 160 else "  <-- OUT OF RANGE"
    print(f"{p['key']:7} seo_title={lt}{flag_t}  seo_desc={ld}{flag_d}")
    if flag_t or flag_d:
        fail = True
    (OUTDIR / f"{p['handle']}.html").write_text(html, encoding="utf-8")

if fail:
    print("\nQA gate failed - not writing. Fix and rerun.")
    sys.exit(1)
print("\nQA gate: PASS (no dashes, no 'splash', SEO in range). Artifacts written to", OUTDIR.name)

if DRY:
    print("\n(DRY-RUN - rerun with --execute to write to the store.)")
    sys.exit(0)

for p in PRODUCTS:
    html = body_html(p)
    r1 = gql(PU, {"input": {"id": p["gid"], "descriptionHtml": html,
                            "seo": {"title": p["seo_title"], "description": p["seo_desc"]}}})
    ue1 = r1["data"]["productUpdate"]["userErrors"]
    mfs = [
        {"ownerId": p["gid"], "namespace": "custom", "key": "dosagem", "type": "single_line_text_field", "value": "200ml"},
        {"ownerId": p["gid"], "namespace": "custom", "key": "finalidade", "type": "single_line_text_field", "value": "cabelo e pele macios e perfumados"},
        {"ownerId": p["gid"], "namespace": "custom", "key": "benefits", "type": "multi_line_text_field", "value": BENEFITS_HTML},
        {"ownerId": p["gid"], "namespace": "custom", "key": "caracteristicas", "type": "rich_text_field", "value": rich(CARACT)},
        {"ownerId": p["gid"], "namespace": "custom", "key": "ingredients", "type": "single_line_text_field", "value": INCI[p["key"]]},
    ]
    r2 = gql(MF, {"mf": mfs})
    ue2 = r2["data"]["metafieldsSet"]["userErrors"]
    status = "OK" if not ue1 and not ue2 else f"ERR product={ue1} mf={ue2}"
    print(f"  {p['key']:7} -> {status}")
