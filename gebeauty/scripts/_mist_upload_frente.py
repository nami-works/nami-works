"""Upload the corrected 'frente' hero for the 3 new mist fragrances and remove the
old PNG hero, leaving the new frente as the sole PDP image. Run from c:\\claude\\gebeauty.
  (no args)=DRY RUN ; 'apply'=upload+swap."""
import json, sys, uuid, mimetypes, urllib.request
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
APPLY = "apply" in sys.argv[1:]
cfg = {}
for l in Path(".env").read_text(encoding="utf-8").splitlines():
    l = l.strip()
    if l.startswith("SHOPIFY") and "=" in l:
        k, v = l.split("=", 1); cfg[k.strip()] = v.strip().strip('"').strip("'")
URL = f"https://{cfg['SHOPIFY_SHOP_DOMAIN']}/admin/api/{cfg.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
TOKEN = cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]
def gql(q, v=None):
    b = json.dumps({"query": q, "variables": v or {}}).encode()
    r = urllib.request.Request(URL, data=b, headers={"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(r).read().decode())

def multipart_post(target_url, params, filepath, mime):
    boundary = "----ge" + uuid.uuid4().hex
    pre = b""
    for p in params:  # staged params MUST precede the file field
        pre += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{p['name']}\"\r\n\r\n{p['value']}\r\n").encode()
    fname = Path(filepath).name
    pre += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{fname}\"\r\n"
            f"Content-Type: {mime}\r\n\r\n").encode()
    body = pre + Path(filepath).read_bytes() + (f"\r\n--{boundary}--\r\n").encode()
    req = urllib.request.Request(target_url, data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}, method="POST")
    with urllib.request.urlopen(req) as resp:
        return resp.status

BASE = Path("imagery/body-hair-mist/_incoming-corrigidas/GE_body_splah_corrigidas")
PLAN = {
    "GEB 031": {"gid": "gid://shopify/Product/10163564249408", "file": BASE / "GE_santal_skin_frente.jpg",
                 "alt": "Santal Skin Body & Hair Mist GE Beauty, bruma amadeirada para corpo e cabelo, 200ml"},
    "GEB 032": {"gid": "gid://shopify/Product/10163564183872", "file": BASE / "GE_rose_ritual_frente.jpg",
                 "alt": "Rose Ritual Body & Hair Mist GE Beauty, bruma perfumada de rosas para corpo e cabelo, 200ml"},
    "GEB 033": {"gid": "gid://shopify/Product/10163564216640", "file": BASE / "GE_pear_fresh_frente.jpg",
                 "alt": "Pear Fresh Body & Hair Mist GE Beauty, bruma perfumada de pera para corpo e cabelo, 200ml"},
}
STAGE = "mutation($input:[StagedUploadInput!]!){stagedUploadsCreate(input:$input){stagedTargets{url resourceUrl parameters{name value}}userErrors{field message}}}"
CREATE = "mutation($pid:ID!,$media:[CreateMediaInput!]!){productCreateMedia(productId:$pid,media:$media){media{id status}mediaUserErrors{field message}}}"
CURMEDIA = "query($id:ID!){product(id:$id){media(first:20){nodes{id ... on MediaImage{image{url}}}}}}"
DELMEDIA = "mutation($pid:ID!,$ids:[ID!]!){productDeleteMedia(productId:$pid,mediaIds:$ids){deletedMediaIds mediaUserErrors{field message}}}"

for sku, d in PLAN.items():
    fp = d["file"]
    print(f"\n{sku}  {fp.name}  exists={fp.exists()}  size={fp.stat().st_size if fp.exists() else 0}")
    old = gql(CURMEDIA, {"id": d["gid"]})["data"]["product"]["media"]["nodes"]
    old_ids = [m["id"] for m in old]
    print(f"  current media (to remove after upload): {[m.get('image',{}).get('url','').split('/')[-1].split('?')[0] for m in old]}")
    print(f"  -> upload {fp.name} as new hero, alt='{d['alt'][:50]}...'")
    if not APPLY:
        continue
    mime = mimetypes.guess_type(str(fp))[0] or "image/jpeg"
    st = gql(STAGE, {"input": [{"resource": "IMAGE", "filename": fp.name, "mimeType": mime, "httpMethod": "POST"}]})
    tgt = st["data"]["stagedUploadsCreate"]["stagedTargets"][0]
    code = multipart_post(tgt["url"], tgt["parameters"], fp, mime)
    print(f"     staged upload HTTP {code}")
    cr = gql(CREATE, {"pid": d["gid"], "media": [{"originalSource": tgt["resourceUrl"], "alt": d["alt"], "mediaContentType": "IMAGE"}]})
    cres = cr.get("data", {}).get("productCreateMedia", {})
    if cres.get("mediaUserErrors") or cr.get("errors"):
        print("     CREATE ERR:", cres.get("mediaUserErrors") or cr.get("errors")); continue
    newid = cres["media"][0]["id"]
    print(f"     created media {newid} status={cres['media'][0]['status']}")
    dl = gql(DELMEDIA, {"pid": d["gid"], "ids": old_ids})
    dres = dl.get("data", {}).get("productDeleteMedia", {})
    print(f"     removed old hero: {'OK ' + str(len(dres.get('deletedMediaIds') or [])) if not dres.get('mediaUserErrors') else dres.get('mediaUserErrors')}")
print("\n" + ("APPLIED." if APPLY else "DRY RUN — rerun with 'apply'."))
