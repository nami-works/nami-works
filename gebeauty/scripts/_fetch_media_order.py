"""Fetch the current product image (media) sequence for core GE Beauty products,
in display order, with alt text + type. For the PDP image-assortment CRO audit.
Read-only. Output: _fetch_media_order.out.json"""
import json
import sys
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
ENV = HERE.parent / ".env"


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

Q = """
query($cursor: String) {
  products(first: 40, after: $cursor, sortKey: ID, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    nodes {
      title productType
      variants(first:1){ nodes { sku } }
      media(first: 25) {
        nodes {
          mediaContentType
          ... on MediaImage { image { width height } alt }
          ... on Video { alt }
        }
      }
    }
  }
}
"""


def gql(q, v=None):
    body = json.dumps({"query": q, "variables": v or {}}).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode("utf-8"))


CORE = {"GEB 001","GEB 002","GEB 003","GEB 008","GEB 019","GEB 020","GEB 021","GEB 022",
        "GEB 023","GEB 024","GEB 101","GEB 102","GEB 120","GEB 121"}


def main():
    rows, cursor = [], None
    while True:
        d = gql(Q, {"cursor": cursor})
        conn = d["data"]["products"]
        for n in conn["nodes"]:
            if (n.get("productType") or "").lower() != "product":
                continue
            sku = ((n["variants"]["nodes"] or [{}])[0].get("sku") or "").strip()
            if sku not in CORE:
                continue
            media = []
            for m in n["media"]["nodes"]:
                img = m.get("image") or {}
                media.append({"type": m["mediaContentType"],
                              "wh": f"{img.get('width')}x{img.get('height')}" if img else None,
                              "alt": m.get("alt")})
            rows.append({"sku": sku, "title": n["title"], "count": len(media), "media": media})
        if not conn["pageInfo"]["hasNextPage"]:
            break
        cursor = conn["pageInfo"]["endCursor"]
    rows.sort(key=lambda r: r["sku"])
    (HERE / "_fetch_media_order.out.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    for r in rows:
        print(f"\n{r['sku']} {r['title'][:34]} ({r['count']} media)")
        for i, m in enumerate(r["media"], 1):
            print(f"  {i:2}. {m['type']:10} {str(m['wh']):11} alt={m['alt']!r}")


if __name__ == "__main__":
    main()
