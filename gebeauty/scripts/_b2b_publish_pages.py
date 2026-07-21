"""Publish the two portfolio decks as LIVE, immersive, discreet Shopify pages.

Sources the deck HTML + hero/logo bytes from the git BRANCH (via `git show`) so a
concurrent session flipping the shared checkout can't corrupt the run.

- Uploads cover hero + logo to Shopify Files (canonical CDN).
- Wires product-card images to canonical featuredImage CDN URLs (live registry).
- Adds an additive, chrome-less page template (page.b2b.liquid, {% layout none %}
  + noindex) to the PUBLISHED theme only (role==main verified first).
- Upserts two pages (idempotent by handle), template_suffix=b2b, published, unlisted.

Pass "commit" to write; default DRY.
"""
import json, re, subprocess, sys, time, urllib.request, uuid
from pathlib import Path

DRY = "commit" not in sys.argv
BRANCH = "mockup/b2b-portfolio-audit"
HERE = Path(__file__).resolve()
GEB = HERE.parent.parent
ROOT = GEB.parent

cfg = {}
for line in (GEB / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        cfg[k.strip()] = v.strip().strip('"').strip("'")
DOMAIN = cfg.get("SHOPIFY_SHOP_DOMAIN", "ge-beauty-cosmeticos.myshopify.com")
VER = cfg.get("SHOPIFY_API_VERSION", "2026-01")
TOKEN = cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]
GQL = f"https://{DOMAIN}/admin/api/{VER}/graphql.json"

def gitshow(relpath):
    r = subprocess.run(["git", "-C", str(ROOT), "show", f"{BRANCH}:{relpath}"],
                       capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"git show {relpath}: {r.stderr.decode(errors='ignore')}")
    return r.stdout

def gql(q, v=None):
    body = json.dumps({"query": q, "variables": v or {}}).encode()
    req = urllib.request.Request(GQL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())

def rest(path, method="GET", payload=None):
    url = f"https://{DOMAIN}/admin/api/{VER}/{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())

FETCH = json.loads((GEB / "scripts" / "_b2b_portfolio_fetch.out.json").read_text(encoding="utf-8"))
IMG_BY_SKU = {r["sku"]: r.get("image") for r in FETCH if r.get("image")}

def multipart_post(url, params, file_bytes, filename, mime):
    boundary = "----geb" + uuid.uuid4().hex
    head = "".join(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{p['name']}\"\r\n\r\n{p['value']}\r\n" for p in params)
    filehdr = f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: {mime}\r\n\r\n"
    body = head.encode() + filehdr.encode() + file_bytes + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req) as r:
        return r.status

def upload_file(relpath):
    raw = gitshow(relpath)
    fn = Path(relpath).name
    st = gql("""mutation($input:[StagedUploadInput!]!){stagedUploadsCreate(input:$input){
        stagedTargets{url resourceUrl parameters{name value}} userErrors{message}}}""",
        {"input": [{"filename": fn, "mimeType": "image/webp", "httpMethod": "POST", "resource": "FILE"}]})
    tgt = st["data"]["stagedUploadsCreate"]["stagedTargets"][0]
    multipart_post(tgt["url"], tgt["parameters"], raw, fn, "image/webp")
    fc = gql("""mutation($files:[FileCreateInput!]!){fileCreate(files:$files){
        files{ ... on MediaImage{ id image{url} } } userErrors{message}}}""",
        {"files": [{"originalSource": tgt["resourceUrl"], "contentType": "IMAGE"}]})
    if fc["data"]["fileCreate"]["userErrors"]:
        raise RuntimeError(f"fileCreate {fn}: {fc['data']['fileCreate']['userErrors']}")
    fid = fc["data"]["fileCreate"]["files"][0]["id"]
    for _ in range(25):
        node = gql("query($id:ID!){node(id:$id){... on MediaImage{ image{url} }}}", {"id": fid})["data"]["node"]
        if node.get("image") and node["image"].get("url"):
            return node["image"]["url"]
        time.sleep(1.5)
    raise RuntimeError(f"{fn}: image url not ready")

def build_body(relpath, hero_url, logo_url):
    html = gitshow(relpath).decode("utf-8")
    style = re.search(r"<style>[\s\S]*?</style>", html).group(0)
    body_inner = re.search(r"<body>([\s\S]*?)</body>", html).group(1)
    out = style + "\n" + body_inner
    live = {sku: url for sku, url in IMG_BY_SKU.items()}
    out = out.replace("const CDN=", "const LIVEIMG=" + json.dumps(live, ensure_ascii=False) + ";\nconst CDN=", 1)
    out = out.replace(
        'src="assets/products/${p.sku.toLowerCase().replace(/\\s+/g,\'\')}.webp"',
        'src="${LIVEIMG[p.sku]||\'\'}"')
    out = out.replace("assets/portfolio_26-06-22_white-space-left.webp", hero_url)
    out = out.replace("assets/ge-beauty-logo.webp", logo_url)
    return out

PAGES = [
    {"rel": "inputs/mockups/gebeauty-b2b-portfolio-v3.html", "title": "GE Beauty · Portfólio B2B", "handle": "pf-comercial-k7m3qx9v"},
    {"rel": "inputs/mockups/gebeauty-portfolio-neutral-v1.html", "title": "GE Beauty · Portfólio de Produtos", "handle": "pf-marcas-p4w9zt6b"},
]
TEMPLATE_KEY = "templates/page.b2b.liquid"
TEMPLATE = ("{% layout none %}<!doctype html><html lang=\"pt-BR\"><head>"
            "<meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            "<meta name=\"robots\" content=\"noindex,nofollow\"><title>{{ page.title }}</title></head>"
            "<body>{{ page.content }}</body></html>")

def main():
    main_theme = next((t for t in rest("themes.json")["themes"] if t["role"] == "main"), None)
    print("published theme:", main_theme["name"], "id", main_theme["id"])
    print(f"DRY-RUN={DRY}\n")

    if DRY:
        for p in PAGES:
            b = build_body(p["rel"], "<HERO>", "<LOGO>")
            print(f"  [dry] {p['handle']}: body {len(b)} chars, card-wire={b.count('LIVEIMG[p.sku]')}, "
                  f"hero={'<HERO>' in b}, logo={'<LOGO>' in b}, leftover-local-assets={b.count('assets/products/')}")
        print("\nDRY complete. Re-run with 'commit' to write.")
        return

    print("uploading hero + logo to Files...")
    hero_url = upload_file("inputs/mockups/assets/portfolio_26-06-22_white-space-left.webp")
    logo_url = upload_file("inputs/mockups/assets/ge-beauty-logo.webp")
    print("  hero:", hero_url)
    print("  logo:", logo_url)

    print(f"writing {TEMPLATE_KEY} to theme {main_theme['id']}...")
    rest(f"themes/{main_theme['id']}/assets.json", "PUT", {"asset": {"key": TEMPLATE_KEY, "value": TEMPLATE}})

    existing = {pg["handle"]: pg for pg in rest("pages.json?limit=250")["pages"]}
    for p in PAGES:
        body = build_body(p["rel"], hero_url, logo_url)
        pg = {"title": p["title"], "handle": p["handle"], "body_html": body,
              "template_suffix": "b2b", "published": True}
        if p["handle"] in existing:
            pid = existing[p["handle"]]["id"]
            rest(f"pages/{pid}.json", "PUT", {"page": {**pg, "id": pid}})
            print(f"  updated /pages/{p['handle']} (id {pid})")
        else:
            r = rest("pages.json", "POST", {"page": pg})["page"]
            print(f"  created /pages/{p['handle']} (id {r['id']})")
        print(f"    https://www.gebeauty.com.br/pages/{p['handle']}")

if __name__ == "__main__":
    main()
