"""Reorder PDP media to the canonical 7-slot sequence across core products.
Classifies each image by alt-text role, sorts to: hero > benefit > result >
ingredients > how-to > social > formula/detail > other > blank (blanks demoted,
never promoted into a prime slot). Reversible: saves original order to
_reorder_pdp_media.rollback.json.

No args = DRY RUN (prints computed reorder). 'apply' = execute + save rollback.
"""
import json
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
ENV = HERE.parent / ".env"
APPLY = len(sys.argv) > 1 and sys.argv[1] == "apply"

CORE = {"GEB 001","GEB 002","GEB 003","GEB 008","GEB 019","GEB 020","GEB 021","GEB 022",
        "GEB 023","GEB 024","GEB 101","GEB 102","GEB 120","GEB 121"}


def load_env(p):
    o = {}
    for l in p.read_text(encoding="utf-8").splitlines():
        l = l.strip()
        if l and not l.startswith("#") and "=" in l:
            k, v = l.split("=", 1)
            o[k.strip()] = v.strip().strip('"').strip("'")
    return o


cfg = load_env(ENV)
URL = f"https://{cfg['SHOPIFY_SHOP_DOMAIN']}/admin/api/{cfg.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
TOKEN = cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]


def gql(q, v=None):
    body = json.dumps({"query": q, "variables": v or {}}).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode("utf-8"))


FETCH = """
query($cursor: String) {
  products(first: 40, after: $cursor, sortKey: ID, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title productType
      variants(first:1){ nodes { sku } }
      media(first: 25) { nodes { id mediaContentType ... on MediaImage { alt } ... on Video { alt } } }
    }
  }
}
"""
REORDER = """
mutation($id: ID!, $moves: [MoveInput!]!) {
  productReorderMedia(id: $id, moves: $moves) {
    job { id } userErrors { field message }
  }
}
"""


def norm(s):
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn").lower()


def role_rank(alt):
    a = norm(alt)
    if a.strip() == "":
        return (90, "blank")
    if "hero" in a or re.fullmatch(r"[a-z0-9-]+", a.strip()):
        return (0, "hero")
    if "faz" in a or "benefic" in a:
        return (1, "benefit")
    if "resultado" in a or "mostrando" in a or "apos " in a or "result" in a:
        return (2, "result")
    if re.search(r"\btem\b", a) or "contem" in a or "tem:" in a or "tem?" in a:
        return (3, "ingredients")
    if "combinar" in a or "como usar" in a or "modo de uso" in a or "aplica" in a or "demonstra" in a or "antes da" in a:
        return (4, "how-to")
    if "influenciadora" in a or "atriz" in a or "camila" in a or "fiorella" in a:
        return (5, "social")
    if "formula" in a:
        return (6, "formula")
    if re.search(r"\d+\s*ml", a) or "ao fundo" in a or "composicao" in a or "criativa" in a:
        return (7, "detail")
    return (8, "other")


def main():
    prods, cursor = [], None
    while True:
        d = gql(FETCH, {"cursor": cursor})
        conn = d["data"]["products"]
        for n in conn["nodes"]:
            if (n.get("productType") or "").lower() != "product":
                continue
            sku = ((n["variants"]["nodes"] or [{}])[0].get("sku") or "").strip()
            if sku in CORE:
                prods.append(n)
        if not conn["pageInfo"]["hasNextPage"]:
            break
        cursor = conn["pageInfo"]["endCursor"]
    prods.sort(key=lambda n: ((n["variants"]["nodes"] or [{}])[0].get("sku") or ""))

    rollback = {}
    for n in prods:
        sku = ((n["variants"]["nodes"] or [{}])[0].get("sku") or "").strip()
        media = n["media"]["nodes"]
        cur = [(m["id"], role_rank(m.get("alt"))) for m in media]
        rollback[n["id"]] = [m["id"] for m in media]
        # stable sort by rank, preserving current order within a rank
        new = sorted(range(len(media)), key=lambda i: (cur[i][1][0], i))
        new_ids = [media[i]["id"] for i in new]
        changed = new_ids != [m["id"] for m in media]
        print(f"\n{sku} {n['title'][:30]} {'(REORDER)' if changed else '(already ordered)'}")
        for pos, i in enumerate(new, 1):
            role = cur[i][1][1]
            was = media.index(media[i]) + 1
            mark = "" if was == pos else f"  (was #{was})"
            print(f"  {pos}. [{role}]{mark}")
        if APPLY and changed:
            moves = [{"id": mid, "newPosition": str(idx)} for idx, mid in enumerate(new_ids)]
            r = gql(REORDER, {"id": n["id"], "moves": moves})
            errs = r.get("data", {}).get("productReorderMedia", {}).get("userErrors") or r.get("errors")
            print("   -> ERROR" if errs else "   -> reorder job queued", errs or "")

    if APPLY:
        (HERE / "_reorder_pdp_media.rollback.json").write_text(
            json.dumps(rollback, ensure_ascii=False, indent=2), encoding="utf-8")
        print("\nrollback saved -> _reorder_pdp_media.rollback.json")
    else:
        print("\n(dry run — rerun with 'apply')")


if __name__ == "__main__":
    main()
