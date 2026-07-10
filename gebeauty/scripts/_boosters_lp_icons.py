"""Boosters LP: normalize + upload the 3 generated transparent icons to Shopify Files,
create a PRODUCT metafield definition custom.icone_lp, and wire each of the 5 boosters
to its transparent icon MediaImage.

- 2 icons kept from existing Files (already transparent): hidratante, definicao.
- 3 icons generated via Magnific + bg-removed (this run): antifrizz, fortificante, antioxidante.

Idempotent: skips upload if a File with the same alt already exists; skips definition
creation if it already exists; metafieldsSet is naturally idempotent.
Run from anywhere; resolves .env from gebeauty/.env.
"""
import os, io, json, time, requests
from pathlib import Path
from dotenv import load_dotenv
from PIL import Image

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
D = os.environ["SHOPIFY_SHOP_DOMAIN"]; T = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]; V = os.environ.get("SHOPIFY_API_VERSION", "2024-10")
GQL = f"https://{D}/admin/api/{V}/graphql.json"; H = {"X-Shopify-Access-Token": T, "Content-Type": "application/json"}
SCRATCH = Path(r"C:/Users/LUCASG~1/AppData/Local/Temp/claude/c--claude/0823b26b-fda8-4dcd-b164-b799bf85aa82/scratchpad")

def gql(q, v=None):
    r = requests.post(GQL, headers=H, json={"query": q, "variables": v or {}})
    d = r.json()
    if "errors" in d: raise RuntimeError(json.dumps(d["errors"], ensure_ascii=False))
    return d["data"]

# --- generated transparent cutouts (Magnific render.png, tokened URLs valid now) ---
GEN = {
    "antifrizz":    "https://pikaso.cdnpk.net/private/production/4783907991/render.png?token=exp=1783555200~hmac=ea119029f352e4ae8ebe15c58e93c7c7ead157c316119066403c1e944d2a7999",
    "fortificante": "https://pikaso.cdnpk.net/private/production/4783908275/render.png?token=exp=1783555200~hmac=150ae1052658f2d601da56b2730af06a9770762895c976d1653f7bf6db11b432",
    "antioxidante": "https://pikaso.cdnpk.net/private/production/4783908616/render.png?token=exp=1783555200~hmac=e9fb46a53c36b72134642f18714598b87377e9e11ea023f224b672892569996a",
}

def normalize(png_bytes, out_size=420, margin_frac=0.08):
    im = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    alpha = im.split()[3]
    bbox = alpha.getbbox()
    if bbox: im = im.crop(bbox)
    # verify transparency present
    amin, amax = im.split()[3].getextrema()
    transparent = amin == 0
    # pad to square with margin
    side = max(im.size)
    pad = int(side * margin_frac)
    canvas = Image.new("RGBA", (side + 2 * pad, side + 2 * pad), (0, 0, 0, 0))
    canvas.paste(im, ((canvas.width - im.width) // 2, (canvas.height - im.height) // 2), im)
    canvas = canvas.resize((out_size, out_size), Image.LANCZOS)
    buf = io.BytesIO(); canvas.save(buf, "PNG"); return buf.getvalue(), transparent

def existing_file_by_alt(alt):
    d = gql('query($q:String!){ files(first:5, query:$q){ nodes{ ... on MediaImage { id alt } } } }', {"q": f"alt:'{alt}'"})
    for n in d["files"]["nodes"]:
        if n and n.get("alt") == alt: return n["id"]
    return None

def staged_upload_and_create(filename, data, alt):
    hit = existing_file_by_alt(alt)
    if hit:
        print(f"  [skip upload] {alt} already in Files -> {hit}")
        return hit
    su = gql('''mutation($input:[StagedUploadInput!]!){ stagedUploadsCreate(input:$input){
        stagedTargets{ url resourceUrl parameters{ name value } } userErrors{ field message } } }''',
        {"input": [{"filename": filename, "mimeType": "image/png", "httpMethod": "POST", "resource": "FILE"}]})
    tgt = su["stagedUploadsCreate"]["stagedTargets"][0]
    form = [(p["name"], p["value"]) for p in tgt["parameters"]]
    resp = requests.post(tgt["url"], data=form, files={"file": (filename, data, "image/png")})
    resp.raise_for_status()
    fc = gql('''mutation($files:[FileCreateInput!]!){ fileCreate(files:$files){
        files{ id fileStatus alt } userErrors{ field message } } }''',
        {"files": [{"originalSource": tgt["resourceUrl"], "contentType": "IMAGE", "alt": alt}]})
    errs = fc["fileCreate"]["userErrors"]
    if errs: raise RuntimeError(json.dumps(errs))
    fid = fc["fileCreate"]["files"][0]["id"]
    # poll READY
    for _ in range(30):
        n = gql('query($id:ID!){ node(id:$id){ ... on MediaImage { id fileStatus image{url} } } }', {"id": fid})["node"]
        if n["fileStatus"] == "READY":
            print(f"  [uploaded] {alt} -> {fid}  {n['image']['url']}")
            return fid
        time.sleep(2)
    raise RuntimeError(f"file {fid} not READY")

def main():
    # 1. process + upload the 3 generated icons
    icon_ids = {
        "booster-hidratante": "gid://shopify/MediaImage/41609321775424",  # icon-150-hidratacao (existing, transparent)
        "booster-definicao":  "gid://shopify/MediaImage/41610642358592",  # icon-150-cachos-definidos (existing, transparent)
    }
    gen_alt = {"antifrizz": "booster antifrizz icone lp", "fortificante": "booster fortificante icone lp", "antioxidante": "booster antioxidante icone lp"}
    gen_handle = {"antifrizz": "booster-antifrizz", "fortificante": "booster-fortificante", "antioxidante": "booster-antioxidante"}
    for key, url in GEN.items():
        raw = requests.get(url).content
        data, transp = normalize(raw)
        (SCRATCH / f"icon_final_{key}.png").write_bytes(data)
        print(f"{key}: normalized {len(data)}B transparent={transp}")
        if not transp: raise RuntimeError(f"{key} icon not transparent after processing")
        fid = staged_upload_and_create(f"booster-{key}-icone-lp.png", data, gen_alt[key])
        icon_ids[gen_handle[key]] = fid

    # 2. ensure PRODUCT metafield definition custom.icone_lp (file_reference)
    existing = gql('''{ metafieldDefinitions(first:50, ownerType:PRODUCT, namespace:"custom"){ nodes{ key } } }''')
    keys = {n["key"] for n in existing["metafieldDefinitions"]["nodes"]}
    if "icone_lp" not in keys:
        r = gql('''mutation{ metafieldDefinitionCreate(definition:{
            name:"Icone LP", namespace:"custom", key:"icone_lp", ownerType:PRODUCT,
            type:"file_reference", description:"Icone transparente do booster para a landing page"
        }){ createdDefinition{ id } userErrors{ field message } } }''')
        errs = r["metafieldDefinitionCreate"]["userErrors"]
        if errs: raise RuntimeError(json.dumps(errs))
        print("  [def] created custom.icone_lp (PRODUCT, file_reference)")
    else:
        print("  [def] custom.icone_lp already exists")

    # 3. resolve product gids + set metafield
    handle_gid = {}
    for h in icon_ids:
        d = gql('query($h:String!){ productByHandle(handle:$h){ id } }', {"h": h})
        handle_gid[h] = d["productByHandle"]["id"]
    sets = [{"ownerId": handle_gid[h], "namespace": "custom", "key": "icone_lp", "type": "file_reference", "value": icon_ids[h]} for h in icon_ids]
    r = gql('''mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ metafields{ key ownerType } userErrors{ field message } } }''', {"m": sets})
    errs = r["metafieldsSet"]["userErrors"]
    if errs: raise RuntimeError(json.dumps(errs))
    print(f"  [wired] custom.icone_lp set on {len(sets)} boosters")
    Path(SCRATCH / "icon_wire_result.json").write_text(json.dumps({"icon_ids": icon_ids, "product_gids": handle_gid}, ensure_ascii=False, indent=1), encoding="utf-8")
    print("DONE")

if __name__ == "__main__":
    main()
