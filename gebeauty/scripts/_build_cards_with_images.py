"""Full build of the redesign PDP ingredient carousel:
1. Upload each of the 22 ingredient images (ingredient-cards/*.png) to Shopify Files.
2. Upsert each ingredient-card metaobject (ingredientes_com_descri_o) with
   nome_do_ingrediente + descri_o + imagem (the uploaded MediaImage).
3. Link each product's custom.ingredientes_com_foto to its ordered list of cards.

Idempotent on cards (metaobjectUpsert by handle) + product links. Files are
re-uploaded each run (Shopify dedupes by content only loosely) — run once.

No args = DRY RUN (validates files + mapping + product ids, no writes).
'apply' = execute.
"""
import json
import mimetypes
import sys
import time
import urllib.request
import uuid
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
ENV = ROOT / ".env"
IMG_DIR = ROOT / "ingredient-cards"
APPLY = len(sys.argv) > 1 and sys.argv[1] == "apply"
MO_TYPE = "ingredientes_com_descri_o"


def load_env(p):
    o = {}
    for l in p.read_text(encoding="utf-8").splitlines():
        l = l.strip()
        if l and not l.startswith("#") and "=" in l:
            k, v = l.split("=", 1)
            o[k.strip()] = v.strip().strip('"').strip("'")
    return o


cfg = load_env(ENV)
DOMAIN = cfg["SHOPIFY_SHOP_DOMAIN"]
TOKEN = cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]
VERSION = cfg.get("SHOPIFY_API_VERSION", "2026-01")
URL = f"https://{DOMAIN}/admin/api/{VERSION}/graphql.json"


def gql(query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode("utf-8"))


STAGED = """
mutation($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets { url resourceUrl parameters { name value } }
    userErrors { field message }
  }
}
"""
FILECREATE = """
mutation($files: [FileCreateInput!]!) {
  fileCreate(files: $files) {
    files { id fileStatus alt }
    userErrors { field message }
  }
}
"""
FILESTATUS = """
query($ids: [ID!]!) {
  nodes(ids: $ids) { ... on MediaImage { id fileStatus image { url } } }
}
"""
UPSERT = """
mutation($handle: MetaobjectHandleInput!, $mo: MetaobjectUpsertInput!) {
  metaobjectUpsert(handle: $handle, metaobject: $mo) {
    metaobject { id handle }
    userErrors { field message code }
  }
}
"""
SET = ("mutation($mf:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$mf){ "
       "metafields{ ownerType } userErrors{ field message } } }")


def multipart_post(url, params, file_bytes, filename):
    boundary = "----geb" + uuid.uuid4().hex
    pre = b""
    for p in params:
        pre += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{p['name']}\"\r\n\r\n{p['value']}\r\n").encode()
    ctype = mimetypes.guess_type(filename)[0] or "image/png"
    pre += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
            f"Content-Type: {ctype}\r\n\r\n").encode()
    body = pre + file_bytes + (f"\r\n--{boundary}--\r\n").encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req) as r:
        return r.status


def upload(path: Path):
    st = gql(STAGED, {"input": [{"resource": "FILE", "filename": path.name,
                                 "mimeType": "image/png", "httpMethod": "POST"}]})
    tgt = st["data"]["stagedUploadsCreate"]["stagedTargets"][0]
    multipart_post(tgt["url"], tgt["parameters"], path.read_bytes(), path.name)
    fc = gql(FILECREATE, {"files": [{"originalSource": tgt["resourceUrl"],
                                     "contentType": "IMAGE", "alt": path.stem}]})
    errs = fc["data"]["fileCreate"]["userErrors"]
    if errs:
        raise SystemExit(f"fileCreate error {path.name}: {errs}")
    return fc["data"]["fileCreate"]["files"][0]["id"]


def resolve_product_ids():
    dump = json.loads((HERE / "_catalog_shopify_dump.out.json").read_text(encoding="utf-8"))
    ids = {}
    for n in dump:
        if (n.get("productType") or "").lower() != "product" or n["status"] != "ACTIVE":
            continue
        t = n["title"].lower()
        if t.startswith("[") or "assinatura" in t:
            continue
        sku = ((n["variants"]["nodes"] or [{}])[0].get("sku") or "").strip()
        if sku and sku not in ids:
            ids[sku] = n["id"]
    return ids


def main():
    matrix = json.loads((ROOT / "catalog-ingredient-cards-matrix.json").read_text(encoding="utf-8"))
    ing = matrix["ingredients"]
    prods = matrix["products"]
    needed = sorted({k for keys in prods.values() for k in keys})
    pids = resolve_product_ids()

    # validate
    missing_img = [k for k in needed if not (IMG_DIR / f"{k}.png").exists()]
    missing_pid = [s for s in prods if s not in pids]
    print(f"{'DRY RUN' if not APPLY else 'APPLY'} — {len(needed)} cards, {len(prods)} products")
    if missing_img:
        print("!! missing images:", missing_img)
    if missing_pid:
        print("!! unresolved products:", missing_pid)
    if missing_img or missing_pid:
        return
    print("all 22 images present; all products resolved.")
    if not APPLY:
        for s, keys in prods.items():
            print(f"  {s:9} -> {', '.join(keys)}")
        print("\n(dry run — rerun with 'apply')")
        return

    # 1) upload images
    gid_by_ing = {}
    for k in needed:
        gid_by_ing[k] = upload(IMG_DIR / f"{k}.png")
        print(f"  uploaded {k} -> {gid_by_ing[k].split('/')[-1]}")

    # 2) wait until all files READY
    print("waiting for files to process...")
    for _ in range(30):
        nodes = gql(FILESTATUS, {"ids": list(gid_by_ing.values())})["data"]["nodes"]
        statuses = [n["fileStatus"] for n in nodes if n]
        if all(s == "READY" for s in statuses):
            print("  all files READY"); break
        time.sleep(3)

    # 3) upsert cards with imagem
    card_gid = {}
    for k in needed:
        d = gql(UPSERT, {"handle": {"type": MO_TYPE, "handle": k},
                         "mo": {"fields": [
                             {"key": "nome_do_ingrediente", "value": ing[k]["nome"]},
                             {"key": "descri_o", "value": ing[k]["descri"]},
                             {"key": "imagem", "value": gid_by_ing[k]},
                         ]}})
        errs = d.get("data", {}).get("metaobjectUpsert", {}).get("userErrors") or d.get("errors")
        if errs:
            print("CARD ERROR", k, json.dumps(errs, ensure_ascii=False)); return
        card_gid[k] = d["data"]["metaobjectUpsert"]["metaobject"]["id"]
    print(f"upserted {len(card_gid)} cards with images")

    # 4) link products
    mf = [{"ownerId": pids[s], "namespace": "custom", "key": "ingredientes_com_foto",
           "type": "list.metaobject_reference",
           "value": json.dumps([card_gid[k] for k in keys])} for s, keys in prods.items()]
    for i in range(0, len(mf), 25):
        d = gql(SET, {"mf": mf[i:i+25]})
        if d.get("data", {}).get("metafieldsSet", {}).get("userErrors") or "errors" in d:
            print("LINK ERROR", json.dumps(d, ensure_ascii=False)[:400]); return
    print(f"linked custom.ingredientes_com_foto on {len(mf)} products — carousel populated")


if __name__ == "__main__":
    main()
