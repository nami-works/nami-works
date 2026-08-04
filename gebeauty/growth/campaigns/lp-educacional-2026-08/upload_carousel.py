#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Uploads the 6 build-up carousel slides to Shopify Files with ALT TEXT carrying each
slide's copy.

Why alt text matters here beyond accessibility: the slide copy is baked into the image,
so it is invisible to crawlers and to the LLM shopping-agent layer. Per the digested
finding (knowledge.md, "a landing page now serves two readers"), that is a real cost on
an indexable page. Alt text keeps the argument machine-extractable while the human sees
the original Instagram slide.

Uses stagedUploadsCreate -> multipart POST -> fileCreate (local files have no public URL).

  python3 upload_carousel.py            # dry run
  python3 upload_carousel.py --apply
"""
import argparse
import json
import mimetypes
import os
import urllib.request
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, "..", "..", "..")
IMG = os.path.join(BASE, "imagery", "build-up", "web")

# Alt text = the slide's own argument, written clean. Source assets carry two copy errors
# (a duplicated line and "GE BEAUY") which are NOT reproduced here.
SLIDES = [
    (1, "build-up-slide-1.jpg",
     "Seu cabelo acostumou com o hair care de todo dia? E agora?"),
    (2, "build-up-slide-2.jpg",
     "Muitos produtos de hair care têm silicone na composição, um ativo sintético "
     "derivado do petróleo que serve para dar brilho e condicionar o cabelo."),
    (3, "build-up-slide-3.jpg",
     "O problema é que o silicone cria uma camada impermeável ao redor do fio. Com o uso "
     "contínuo essa camada vai se espessando, bloqueando a absorção de nutrientes e "
     "deixando o cabelo opaco e sem vida. Esse efeito tem nome e sobrenome: efeito build-up."),
    (4, "build-up-slide-4.jpg",
     "Como saber se o seu cabelo está com build-up: o fio fica pesado, opaco, difícil de "
     "pentear e com aspecto de sujo mesmo recém-lavado."),
    (5, "build-up-slide-5.jpg",
     "Para ter brilho, volume e maciez não é preciso sufocar o cabelo. Ao contrário: é "
     "preciso retirar o excesso de resíduos para que ele responda com leveza e movimento. "
     "Por isso o ritual GE Beauty usa óleos naturais e ativos biodegradáveis em "
     "substituição ao silicone. Eles penetram na fibra, tratam o fio e garantem "
     "permeabilidade e zero acúmulo de resíduos."),
    (6, "build-up-slide-6.jpg",
     "Preparada para o seu novo hair care com fórmulas limpas e livres de crueldade "
     "animal? Monte o seu ritual livre de build-up."),
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
    for p in params:                       # Shopify's params MUST precede the file part
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
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.status


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()

    todo = []
    for n, fname, alt in SLIDES:
        p = os.path.join(IMG, fname)
        if not os.path.exists(p):
            raise SystemExit(f"missing {p}")
        todo.append((n, fname, alt, p, os.path.getsize(p)))

    print("=" * 74)
    print("BUILD-UP CAROUSEL -> Shopify Files")
    print("=" * 74)
    for n, fname, alt, p, size in todo:
        print(f"  slide {n}  {fname:<24} {size//1024:>4} KB")
        print(f"           alt: {alt[:96]}{'...' if len(alt) > 96 else ''}")
    if not a.apply:
        print("\nDRY RUN. nothing uploaded. re-run with --apply")
        return

    # 1. staged targets
    inputs = [{"resource": "FILE", "filename": f, "mimeType": mimetypes.guess_type(f)[0],
               "httpMethod": "POST", "fileSize": str(s)} for _, f, _, _, s in todo]
    st = gql("""mutation($i:[StagedUploadInput!]!){ stagedUploadsCreate(input:$i){
      stagedTargets{ url resourceUrl parameters{ name value } }
      userErrors{ field message } } }""", {"i": inputs})["data"]["stagedUploadsCreate"]
    if st["userErrors"]:
        raise SystemExit("stagedUploadsCreate: " + json.dumps(st["userErrors"]))

    # 2. push bytes
    creates = []
    for (n, fname, alt, p, size), tgt in zip(todo, st["stagedTargets"]):
        with open(p, "rb") as f:
            blob = f.read()
        code = multipart(tgt["url"], tgt["parameters"], fname, blob,
                         mimetypes.guess_type(fname)[0])
        print(f"  uploaded slide {n} ({code})")
        creates.append({"originalSource": tgt["resourceUrl"], "alt": alt,
                        "contentType": "IMAGE", "filename": fname})

    # 3. register as Files
    fc = gql("""mutation($f:[FileCreateInput!]!){ fileCreate(files:$f){
      files{ id alt fileStatus ... on MediaImage { image { url width height } } }
      userErrors{ field message } } }""", {"f": creates})["data"]["fileCreate"]
    if fc["userErrors"]:
        raise SystemExit("fileCreate: " + json.dumps(fc["userErrors"]))

    out = []
    for i, f in enumerate(fc["files"], 1):
        out.append({"slide": i, "id": f["id"], "status": f["fileStatus"]})
        print(f"  registered slide {i}: {f['id']}  {f['fileStatus']}")

    with open(os.path.join(HERE, "carousel_file_ids.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    print("\n  ids -> carousel_file_ids.json  (poll READY before binding)")


if __name__ == "__main__":
    main()
