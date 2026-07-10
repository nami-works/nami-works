"""Apply brand-approved descriptionHtml + SEO to two GE Beauty smart collections,
then verify with a read-back. Content is pre-approved; applies directly (no dry-run).
Scope: write_products (collectionUpdate). Publication left untouched.
"""
import json, os, urllib.request
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
URL = "https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json"

COLLECTIONS = [
    {
        "id": "gid://shopify/Collection/515330376000",
        "handle": "body-hair-mist",
        "descriptionHtml": "<p>brumas perfumadas para cabelo e corpo que perfumam, realçam o brilho dos fios e deixam a pele macia. escolha entre as fragrâncias da linha, no tamanho full size ou na versão travel size para levar com você.</p>",
        "seo": {
            "title": "Body & Hair Mist GE Beauty, brumas para cabelo e corpo",
            "description": "Brumas perfumadas para cabelo e corpo. Perfumam, realçam o brilho dos fios e deixam a pele macia, na sua fragrância favorita. No seu tempo, do seu jeito.",
        },
    },
    {
        "id": "gid://shopify/Collection/515330572608",
        "handle": "body-hair-mist-full-size",
        "descriptionHtml": "<p>as brumas perfumadas para cabelo e corpo da GE Beauty no tamanho full size, 200ml. perfumam, realçam o brilho dos fios e deixam a pele macia. escolha a sua fragrância para perfumar depois do banho, antes de sair ou sempre que quiser.</p>",
        "seo": {
            "title": "Body & Hair Mist Full Size GE Beauty, brumas 200ml",
            "description": "Brumas perfumadas para cabelo e corpo no tamanho full size, 200ml. Perfumam, realçam o brilho dos fios e deixam a pele macia. No seu tempo, do seu jeito.",
        },
    },
]


def gql(query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN,
    })
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


MUTATION = """
mutation($input: CollectionInput!) {
  collectionUpdate(input: $input) {
    collection { id }
    userErrors { field message }
  }
}
"""

READBACK = """
query($id: ID!) {
  collection(id: $id) {
    id
    handle
    descriptionHtml
    seo { title description }
  }
}
"""

# --- apply ---
print("=== APPLYING collection copy ===\n")
results = {}
for c in COLLECTIONS:
    r = gql(MUTATION, {"input": {
        "id": c["id"],
        "descriptionHtml": c["descriptionHtml"],
        "seo": c["seo"],
    }})
    payload = r.get("data", {}).get("collectionUpdate")
    if payload is None:
        print(f"  {c['handle']:28} -> GRAPHQL ERROR: {json.dumps(r, ensure_ascii=False)}")
        results[c["handle"]] = {"applied": False, "errors": r}
        continue
    ue = payload["userErrors"]
    if ue:
        print(f"  {c['handle']:28} -> USER ERRORS: {json.dumps(ue, ensure_ascii=False)}")
        results[c["handle"]] = {"applied": False, "errors": ue}
    else:
        print(f"  {c['handle']:28} -> applied")
        results[c["handle"]] = {"applied": True, "errors": None}

# --- verify (read-back) ---
print("\n=== VERIFY (read-back) ===\n")
for c in COLLECTIONS:
    r = gql(READBACK, {"id": c["id"]})
    col = r.get("data", {}).get("collection")
    if col is None:
        print(f"  {c['handle']:28} -> READBACK ERROR: {json.dumps(r, ensure_ascii=False)}")
        results[c["handle"]]["verified"] = False
        continue
    got_html = col["descriptionHtml"] or ""
    got_title = (col["seo"] or {}).get("title") or ""
    got_desc = (col["seo"] or {}).get("description") or ""
    html_match = got_html == c["descriptionHtml"]
    title_match = got_title == c["seo"]["title"]
    desc_match = got_desc == c["seo"]["description"]
    ok = html_match and title_match and desc_match
    results[c["handle"]]["verified"] = ok
    status = "OK" if ok else "ERR"
    print(f"  {c['handle']:28} -> {status}")
    print(f"      descriptionHtml len={len(got_html)} (match={html_match})")
    print(f"      seo.title       len={len(got_title)} (match={title_match}) :: {got_title!r}")
    print(f"      seo.description len={len(got_desc)} (match={desc_match})")
    if not ok:
        if not html_match:
            print(f"      EXPECTED HTML: {c['descriptionHtml']!r}")
            print(f"      GOT HTML:      {got_html!r}")
        if not title_match:
            print(f"      EXPECTED TITLE: {c['seo']['title']!r}")
        if not desc_match:
            print(f"      EXPECTED DESC: {c['seo']['description']!r}")
            print(f"      GOT DESC:      {got_desc!r}")

print("\n=== SUMMARY ===")
for h, res in results.items():
    print(f"  {h:28} applied={res['applied']} verified={res.get('verified')}")
