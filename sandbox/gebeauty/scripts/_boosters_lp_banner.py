"""Upload the boosters LP banner pair (desktop 2400x960 + mobile 1200x1500, brand-font
headline composed over a Magnific wide/portrait extend of the kit-boosters hero) to Shopify
Files, ensure the PAGE banner metafield definitions exist, and wire them on /pages/guia-boosters.
Idempotent (skips upload if a File with the same alt exists).
"""
import os, json, time, requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
D = os.environ["SHOPIFY_SHOP_DOMAIN"]; T = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]; V = os.environ.get("SHOPIFY_API_VERSION", "2024-10")
GQL = f"https://{D}/admin/api/{V}/graphql.json"; H = {"X-Shopify-Access-Token": T, "Content-Type": "application/json"}
SC = Path(r"C:/Users/LUCASG~1/AppData/Local/Temp/claude/c--Users-Lucas-Guimar-es-Desktop-nami-works/0823b26b-fda8-4dcd-b164-b799bf85aa82/scratchpad")
PAGE_GID = "gid://shopify/Page/164373692736"

def gql(q, v=None):
    r = requests.post(GQL, headers=H, json={"query": q, "variables": v or {}}).json()
    if "errors" in r: raise RuntimeError(json.dumps(r["errors"], ensure_ascii=False))
    return r["data"]

def existing_by_alt(alt):
    d = gql('query($q:String!){ files(first:5, query:$q){ nodes{ ... on MediaImage { id alt } } } }', {"q": f"alt:'{alt}'"})
    for n in d["files"]["nodes"]:
        if n and n.get("alt") == alt: return n["id"]
    return None

def upload(path, alt):
    hit = existing_by_alt(alt)
    if hit: print(f"  [skip] {alt} -> {hit}"); return hit
    data = path.read_bytes()
    su = gql('''mutation($i:[StagedUploadInput!]!){ stagedUploadsCreate(input:$i){ stagedTargets{ url resourceUrl parameters{ name value } } userErrors{ message } } }''',
             {"i": [{"filename": path.name, "mimeType": "image/png", "httpMethod": "POST", "resource": "FILE"}]})
    tgt = su["stagedUploadsCreate"]["stagedTargets"][0]
    form = [(p["name"], p["value"]) for p in tgt["parameters"]]
    requests.post(tgt["url"], data=form, files={"file": (path.name, data, "image/png")}).raise_for_status()
    fc = gql('''mutation($f:[FileCreateInput!]!){ fileCreate(files:$f){ files{ id } userErrors{ message } } }''',
             {"f": [{"originalSource": tgt["resourceUrl"], "contentType": "IMAGE", "alt": alt}]})
    if fc["fileCreate"]["userErrors"]: raise RuntimeError(json.dumps(fc["fileCreate"]["userErrors"]))
    fid = fc["fileCreate"]["files"][0]["id"]
    for _ in range(30):
        n = gql('query($id:ID!){ node(id:$id){ ... on MediaImage { fileStatus image{url} } } }', {"id": fid})["node"]
        if n["fileStatus"] == "READY": print(f"  [up] {alt} -> {fid}"); return fid
        time.sleep(2)
    raise RuntimeError("not ready")

def ensure_page_def(key):
    ex = gql('{ metafieldDefinitions(first:100, ownerType:PAGE, namespace:"custom"){ nodes{ key } } }')
    if key in {n["key"] for n in ex["metafieldDefinitions"]["nodes"]}:
        print(f"  [def] custom.{key} exists"); return
    r = gql('''mutation($k:String!,$n:String!){ metafieldDefinitionCreate(definition:{
        name:$n, namespace:"custom", key:$k, ownerType:PAGE, type:"file_reference"}){ userErrors{ message } } }''',
        {"k": key, "n": key.replace("_", " ").title()})
    if r["metafieldDefinitionCreate"]["userErrors"]: raise RuntimeError(json.dumps(r["metafieldDefinitionCreate"]["userErrors"]))
    print(f"  [def] created custom.{key}")

def main():
    dsk = upload(SC / "banner_desktop_final.png", "boosters lp banner desktop")
    mob = upload(SC / "banner_mobile_final.png", "boosters lp banner mobile")
    ensure_page_def("banner_desktop"); ensure_page_def("banner_mobile")
    r = gql('''mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ metafields{ key } userErrors{ message } } }''',
        {"m": [
            {"ownerId": PAGE_GID, "namespace": "custom", "key": "banner_desktop", "type": "file_reference", "value": dsk},
            {"ownerId": PAGE_GID, "namespace": "custom", "key": "banner_mobile", "type": "file_reference", "value": mob}]})
    if r["metafieldsSet"]["userErrors"]: raise RuntimeError(json.dumps(r["metafieldsSet"]["userErrors"]))
    print("  [wired] banner_desktop + banner_mobile on page 164373692736")

if __name__ == "__main__":
    main()
