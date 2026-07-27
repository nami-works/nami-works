#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Transiently host local image files on GE Beauty's Shopify Files so a public
cdn.shopify.com URL exists (the only URL Canva's `upload-asset-from-url` can fetch;
Magnific/pikaso signed URLs and local files fail). Per docs/creative-ad-image-pipeline.md §4.

Flow per file: stagedUploadsCreate -> POST bytes to the staged target ->
fileCreate(originalSource=resourceUrl) -> poll node(id) until READY -> image.url.

Usage:
    python shopify_files_upload.py <file1> [file2 ...]        # upload, print JSON
    python shopify_files_upload.py --delete <gid1> [gid2 ...] # fileDelete by id

Prints JSON to stdout: [{"path","id","url"}]. Keep the ids to delete after ingestion.
Requires SHOPIFY_ADMIN_ACCESS_TOKEN (+ write_files) from gebeauty/.env.
"""
import json, mimetypes, os, sys, time, uuid, urllib.request
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
DOMAIN = os.environ.get("SHOPIFY_SHOP_DOMAIN", "ge-beauty-cosmeticos.myshopify.com")
VER = os.environ.get("SHOPIFY_API_VERSION", "2026-01")
URL = f"https://{DOMAIN}/admin/api/{VER}/graphql.json"


def graphql(query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    with urllib.request.urlopen(req) as r:
        out = json.loads(r.read().decode())
    if out.get("errors"):
        raise RuntimeError(json.dumps(out["errors"]))
    return out["data"]


def _multipart_post(url, params, file_bytes, filename, mime):
    boundary = "----geb" + uuid.uuid4().hex
    pre = b""
    for p in params:  # staged params MUST come before the file field
        pre += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{p['name']}\"\r\n\r\n{p['value']}\r\n").encode()
    pre += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
            f"Content-Type: {mime}\r\n\r\n").encode()
    body = pre + file_bytes + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req) as r:
        return r.status


STAGE = """mutation($input:[StagedUploadInput!]!){stagedUploadsCreate(input:$input){
  stagedTargets{url resourceUrl parameters{name value}} userErrors{field message}}}"""
CREATE = """mutation($files:[FileCreateInput!]!){fileCreate(files:$files){
  files{id fileStatus} userErrors{field message}}}"""
NODE = """query($id:ID!){node(id:$id){... on MediaImage{id fileStatus image{url}
  preview{image{url}}}}}"""
DELETE = """mutation($ids:[ID!]!){fileDelete(fileIds:$ids){deletedFileIds userErrors{field message}}}"""


def upload(path):
    p = Path(path)
    data = p.read_bytes()
    mime = mimetypes.guess_type(p.name)[0] or "image/png"
    tgt = graphql(STAGE, {"input": [{"filename": p.name, "mimeType": mime,
                                     "resource": "IMAGE", "httpMethod": "POST"}]})
    t = tgt["stagedUploadsCreate"]["stagedTargets"][0]
    _multipart_post(t["url"], t["parameters"], data, p.name, mime)
    fc = graphql(CREATE, {"files": [{"contentType": "IMAGE", "originalSource": t["resourceUrl"]}]})
    fid = fc["fileCreate"]["files"][0]["id"]
    url = None
    for _ in range(30):
        n = graphql(NODE, {"id": fid})["node"]
        if n and n.get("fileStatus") == "READY":
            url = (n.get("image") or {}).get("url") or (n.get("preview") or {}).get("image", {}).get("url")
            if url:
                break
        time.sleep(2)
    if not url:
        raise RuntimeError(f"file not READY: {fid}")
    return {"path": str(p), "id": fid, "url": url}


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--delete":
        print(json.dumps(graphql(DELETE, {"ids": args[1:]})["fileDelete"]))
    else:
        print(json.dumps([upload(a) for a in args], ensure_ascii=False, indent=2))
