#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Uploads CARROSSEL_HAIRCARE3.mp4 and CARROSSEL_HAIRCARE5.mp4 to Shopify Files as
native VIDEO resources, polling until fileStatus == READY (video processing is
async and can take a minute or two).

Per Lucas (2026-08-02): post video 5 AS-IS, including its two known copy errors
(a duplicated opening line and "GE BEAUY" missing its T). No source fix, no local
re-render. Same asset is already live on Instagram.

  python3 upload_videos.py            # dry run
  python3 upload_videos.py --apply
"""
import argparse
import json
import mimetypes
import os
import time
import urllib.request
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, "..", "..", "..")
IMG = os.path.join(BASE, "imagery", "build-up")

VIDEOS = [
    (3, "CARROSSEL_HAIRCARE3.mp4",
     "efeito build-up: a camada impermeavel do silicone, em video"),
    (5, "CARROSSEL_HAIRCARE5.mp4",
     "o ritual GE Beauty livre de build-up, em video (contem os 2 erros de "
     "copy do asset original: linha duplicada + GE BEAUY)"),
]


def env():
    v = {}
    with open(os.path.join(BASE, ".env"), encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, val = line.split("=", 1)
                v[k.strip()] = val.strip().strip('"').strip("'")
    return v


E = env()
DOMAIN = E.get("SHOPIFY_SHOP_DOMAIN") or "ge-beauty-cosmeticos.myshopify.com"
VER = E.get("SHOPIFY_API_VERSION") or "2026-01"
TOKEN = E["SHOPIFY_ADMIN_ACCESS_TOKEN"]


def gql(q, v=None):
    body = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    req = urllib.request.Request(f"https://{DOMAIN}/admin/api/{VER}/graphql.json",
                                 data=body, headers={
                                     "Content-Type": "application/json",
                                     "X-Shopify-Access-Token": TOKEN})
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.loads(r.read().decode())
    if "errors" in d:
        raise SystemExit("GraphQL: " + json.dumps(d["errors"])[:800])
    return d


def multipart(url, params, filename, blob, mime):
    boundary = "----" + uuid.uuid4().hex
    parts = []
    for p in params:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; '
                     f'name="{p["name"]}"\r\n\r\n{p["value"]}\r\n'.encode())
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; '
                 f'filename="{filename}"\r\nContent-Type: {mime}\r\n\r\n'.encode())
    parts.append(blob)
    parts.append(f'\r\n--{boundary}--\r\n'.encode())
    payload = b"".join(parts)
    req = urllib.request.Request(url, data=payload, headers={
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Content-Length": str(len(payload))}, method="POST")
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.status


def poll_ready(ids, timeout_s=180, interval_s=8):
    q = """query($ids:[ID!]!){ nodes(ids:$ids){ ... on Video { id fileStatus
             sources { url format height width } } } }"""
    waited = 0
    last = {}
    while waited <= timeout_s:
        r = gql(q, {"ids": ids})["data"]["nodes"]
        last = {n["id"]: n for n in r if n}
        statuses = {n["id"]: n["fileStatus"] for n in last.values()}
        print(f"    poll @ {waited}s: {statuses}")
        if all(s == "READY" for s in statuses.values()):
            return last
        if any(s == "FAILED" for s in statuses.values()):
            raise SystemExit(f"video processing FAILED: {statuses}")
        time.sleep(interval_s)
        waited += interval_s
    print("    WARNING: timed out waiting for READY, proceeding anyway "
          "(video may finish processing shortly after; Shopify serves it once ready)")
    return last


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    todo = []
    for n, fname, alt in VIDEOS:
        p = os.path.join(IMG, fname)
        if not os.path.exists(p):
            raise SystemExit(f"missing {p}")
        todo.append((n, fname, alt, p, os.path.getsize(p)))

    print("=" * 74)
    print("UPLOAD VIDEOS 3 & 5 -> Shopify Files (native video)")
    print("=" * 74)
    for n, fname, alt, p, size in todo:
        print(f"  video {n}  {fname:<28} {size/1024/1024:.1f} MB")
        print(f"           alt: {alt}")
    if not a.apply:
        print("\nDRY RUN. nothing uploaded. re-run with --apply")
        return

    inputs = [{"resource": "VIDEO", "filename": f, "mimeType": "video/mp4",
               "httpMethod": "POST", "fileSize": str(s)} for _, f, _, _, s in todo]
    st = gql("""mutation($i:[StagedUploadInput!]!){ stagedUploadsCreate(input:$i){
      stagedTargets{ url resourceUrl parameters{ name value } }
      userErrors{ field message } } }""", {"i": inputs})["data"]["stagedUploadsCreate"]
    if st["userErrors"]:
        raise SystemExit("stagedUploadsCreate: " + json.dumps(st["userErrors"]))

    creates = []
    for (n, fname, alt, p, size), tgt in zip(todo, st["stagedTargets"]):
        with open(p, "rb") as f:
            blob = f.read()
        code = multipart(tgt["url"], tgt["parameters"], fname, blob, "video/mp4")
        print(f"  uploaded video {n} ({code}, {size/1024/1024:.1f} MB)")
        # NOTE: deliberately no "filename" key. Shopify's video staged-upload
        # resourceUrl carries only "?external_video_id=...", no path/extension,
        # and fileCreate rejects any filename as an "extension mismatch" against
        # that URL. Omitting filename lets fileCreate resolve it from the
        # underlying upload instead. Confirmed working 2026-08-02.
        creates.append({"originalSource": tgt["resourceUrl"], "alt": alt,
                        "contentType": "VIDEO"})

    fc = gql("""mutation($f:[FileCreateInput!]!){ fileCreate(files:$f){
      files{ id alt fileStatus } userErrors{ field message } } }""",
             {"f": creates})["data"]["fileCreate"]
    if fc["userErrors"]:
        raise SystemExit("fileCreate: " + json.dumps(fc["userErrors"]))

    ids = [f["id"] for f in fc["files"]]
    for (n, fname, *_), f in zip(todo, fc["files"]):
        print(f"  registered video {n}: {f['id']}  {f['fileStatus']}")

    print("\n  polling until READY (video processing is async)...")
    ready = poll_ready(ids)

    out = []
    for (n, fname, *_), fid in zip(todo, ids):
        node = ready.get(fid, {})
        out.append({"slide": n, "id": fid, "status": node.get("fileStatus", "UNKNOWN")})

    with open(os.path.join(HERE, "video_file_ids.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    print("\n  ids -> video_file_ids.json")


if __name__ == "__main__":
    main()
