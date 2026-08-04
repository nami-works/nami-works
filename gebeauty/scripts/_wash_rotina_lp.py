"""Build the standalone wash-routine LP (UNPUBLISHED) on the live (main) theme.

Steps (idempotent, --apply to execute):
  1. Upload 3 plates to Shopify Files (stagedUploadsCreate + fileCreate) -> CDN URLs.
  2. Substitute image URLs + bundle variant IDs into lp-production.liquid.tmpl.
  3. Write theme assets (NEW keys only, no live section touched):
       layout/lp-wash-rotina.liquid          (minimal shell: content_for_header only, no header/footer)
       templates/page.lp-wash-rotina.liquid  (the LP; uses that layout)
  4. Create a DRAFT (isPublished:false) page with templateSuffix lp-wash-rotina.
Guardrails: never publish; no collections; new assets only. Token from .env.
"""
import json, os, sys, time, urllib.request
from pathlib import Path
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
load_dotenv(HERE.parent / ".env")
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
SHOP = "ge-beauty-cosmeticos.myshopify.com"
GQL = f"https://{SHOP}/admin/api/2026-01/graphql.json"
THEME_ID = 181379236160  # [Check] - Produção (role==main, verified this session)
APPLY = "--apply" in sys.argv

IMG_DIR = HERE.parent / "imagery" / "wash-routine-offer"
TMPL = IMG_DIR / "lp-production.liquid.tmpl"
IMAGES = {
    "__HERO_IMG__":  IMG_DIR / "expanded" / "16x9_hero-landscape.png",
    "__GIFT_A_IMG__": IMG_DIR / "hero_001-002-011.png",
    "__GIFT_B_IMG__": IMG_DIR / "hero_001-002-008.png",
}
VAR_A = "52863869157696"   # Bundle A · leave-in travel
VAR_B = "52863869190464"   # Bundle B · shampoo a seco
PAGE_HANDLE = "oferta-rotina-de-lavagem"
PAGE_TITLE = "Oferta Rotina de Lavagem"
TPL_SUFFIX = "lp-wash-rotina"

LAYOUT = """<!doctype html>
<html lang="pt-BR" class="no-js">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <link rel="canonical" href="{{ canonical_url }}">
  <title>{{ page_title }}</title>
  <style>
    @font-face{font-family:'Italian Plate No2 Expanded';src:url({{ "ItalianPlateNo2Expanded-Regular.woff2" | asset_url }}) format("woff2");font-weight:400;font-style:normal;font-display:swap;}
    @font-face{font-family:'Italian Plate No2 Expanded';src:url({{ "ItalianPlateNo2Expanded-Medium.woff2" | asset_url }}) format("woff2");font-weight:500;font-style:normal;font-display:swap;}
    @font-face{font-family:'Italian Plate No2 Expanded';src:url({{ "ItalianPlateNo2Expanded-Demibold.woff2" | asset_url }}) format("woff2");font-weight:600;font-style:normal;font-display:swap;}
    @font-face{font-family:'Italian Plate No2 Expanded';src:url({{ "ItalianPlateNo2Expanded-Bold.woff2" | asset_url }}) format("woff2");font-weight:700;font-style:normal;font-display:swap;}
  </style>
  {{ content_for_header }}
</head>
<body>
  {{ content_for_layout }}
</body>
</html>
"""


def gql(q, v=None):
    b = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    r = urllib.request.Request(GQL, data=b, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(r, timeout=90).read())


def rest(method, path, payload=None):
    url = f"https://{SHOP}/admin/api/2026-01/{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    with urllib.request.urlopen(r, timeout=90) as resp:
        return json.loads(resp.read().decode())


STAGE = """mutation($input:[StagedUploadInput!]!){ stagedUploadsCreate(input:$input){
  stagedTargets{ url resourceUrl parameters{ name value } } userErrors{ field message } } }"""
FILECREATE = """mutation($files:[FileCreateInput!]!){ fileCreate(files:$files){
  files{ id fileStatus alt ... on MediaImage { image { url } } } userErrors{ field message } } }"""
FILEPOLL = """query($id:ID!){ node(id:$id){ ... on MediaImage { fileStatus image { url } } } }"""


def post_multipart(url, params, filename, data):
    boundary = "----geb" + os.urandom(8).hex()
    nl = b"\r\n"
    buf = []
    for p in params:
        buf += [b"--" + boundary.encode() + nl,
                ('Content-Disposition: form-data; name="%s"' % p["name"]).encode() + nl + nl,
                str(p["value"]).encode() + nl]
    buf += [b"--" + boundary.encode() + nl,
            ('Content-Disposition: form-data; name="file"; filename="%s"' % filename).encode() + nl,
            b"Content-Type: image/png" + nl + nl, data + nl,
            b"--" + boundary.encode() + b"--" + nl]
    req = urllib.request.Request(url, data=b"".join(buf), method="POST",
                                 headers={"Content-Type": "multipart/form-data; boundary=" + boundary})
    return urllib.request.urlopen(req, timeout=120).status


def upload_image(path):
    fn = path.name
    st = gql(STAGE, {"input": [{"resource": "IMAGE", "filename": fn, "mimeType": "image/png",
                                "httpMethod": "POST", "fileSize": str(os.path.getsize(path))}]})
    tgt = st["data"]["stagedUploadsCreate"]["stagedTargets"][0]
    post_multipart(tgt["url"], tgt["parameters"], fn, path.read_bytes())
    cr = gql(FILECREATE, {"files": [{"originalSource": tgt["resourceUrl"],
                                     "contentType": "IMAGE", "alt": "wash-rotina " + path.stem}]})
    if cr["data"]["fileCreate"]["userErrors"]:
        raise SystemExit(f"fileCreate error: {cr['data']['fileCreate']['userErrors']}")
    fid = cr["data"]["fileCreate"]["files"][0]["id"]
    url = None
    for _ in range(30):
        n = gql(FILEPOLL, {"id": fid})["data"]["node"]
        if n and n.get("fileStatus") == "READY" and n.get("image"):
            url = n["image"]["url"]; break
        time.sleep(2)
    if not url:
        raise SystemExit(f"file not READY: {fid}")
    print(f"  [OK] uploaded {fn} -> {url}")
    return url


def asset_put(key, value):
    rest("PUT", f"themes/{THEME_ID}/assets.json", {"asset": {"key": key, "value": value}})
    print(f"  [OK] wrote asset {key}")


def main():
    print(f"=== WASH-ROTINA LP ({'APPLY' if APPLY else 'DRY-RUN'}) ===")
    body = TMPL.read_text(encoding="utf-8")

    if not APPLY:
        for tok, p in IMAGES.items():
            print(f"  [DRY] would upload {p.name} for {tok} (exists={p.exists()})")
        print(f"  [DRY] would substitute variants A={VAR_A} B={VAR_B}")
        print(f"  [DRY] would write layout/{TPL_SUFFIX}.liquid + templates/page.{TPL_SUFFIX}.liquid")
        print(f"  [DRY] would create DRAFT page '{PAGE_TITLE}' handle={PAGE_HANDLE} suffix={TPL_SUFFIX}")
        return

    # 1. images
    urls = {tok: upload_image(p) for tok, p in IMAGES.items()}
    for tok, url in urls.items():
        body = body.replace(tok, url)
    body = body.replace("__VAR_A__", VAR_A).replace("__VAR_B__", VAR_B)
    if "__" in body:
        raise SystemExit("unsubstituted token remains in template")

    # 2. theme assets (new keys only)
    asset_put(f"layout/{TPL_SUFFIX}.liquid", LAYOUT)
    asset_put(f"templates/page.{TPL_SUFFIX}.liquid", body)

    # 3. draft page (idempotent)
    FINDPAGE = """query($q:String!){ pages(first:5, query:$q){ nodes{ id title handle isPublished templateSuffix } } }"""
    found = gql(FINDPAGE, {"q": f"handle:{PAGE_HANDLE}"})["data"]["pages"]["nodes"]
    existing = next((p for p in found if p["handle"] == PAGE_HANDLE), None)
    if existing:
        print(f"  [SKIP] page exists: {existing['id']} handle={existing['handle']} "
              f"published={existing['isPublished']} suffix={existing['templateSuffix']}")
        page = existing
    else:
        CREATE = """mutation($page:PageCreateInput!){ pageCreate(page:$page){
          page{ id title handle isPublished templateSuffix } userErrors{ code field message } } }"""
        r = gql(CREATE, {"page": {
            "title": PAGE_TITLE, "handle": PAGE_HANDLE, "isPublished": False,
            "templateSuffix": TPL_SUFFIX,
            "body": "<!-- LP renders via templates/page.lp-wash-rotina.liquid. UNPUBLISHED draft. -->"}})
        pc = r["data"]["pageCreate"]
        if pc["userErrors"]:
            raise SystemExit(f"pageCreate error: {pc['userErrors']}")
        page = pc["page"]
        print(f"  [OK] created DRAFT page {page['id']} handle={page['handle']} "
              f"published={page['isPublished']} suffix={page['templateSuffix']}")

    preview = f"https://{SHOP}/pages/{page['handle']}"
    out = {"page": page, "preview_url_logged_in_staff": preview,
           "theme_id": THEME_ID, "images": urls, "variants": {"A": VAR_A, "B": VAR_B}}
    (HERE / "_wash_rotina_lp.out.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n  PAGE (unpublished): {page['id']}")
    print(f"  PREVIEW (visible to logged-in staff; 404 for public): {preview}")
    print(f"  template: templates/page.{TPL_SUFFIX}.liquid  layout: layout/{TPL_SUFFIX}.liquid")


if __name__ == "__main__":
    main()
