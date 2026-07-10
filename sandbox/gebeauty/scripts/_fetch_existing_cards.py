"""Fetch existing ingredientes_com_descri_o metaobjects (the ~2 already built,
incl. 'manteiga de murumuru') and resolve their imagem file -> URL, so we can
study the visual style before generating the rest. Read-only."""
import json
import sys
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ENV = Path(__file__).resolve().parent.parent / ".env"


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
query {
  metaobjects(type: "ingredientes_com_descri_o", first: 20) {
    nodes {
      handle
      fields {
        key value
        reference { ... on MediaImage { image { url width height } } }
      }
    }
  }
}
"""


def gql(query):
    body = json.dumps({"query": query}).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode("utf-8"))


def main():
    d = gql(Q)
    nodes = d.get("data", {}).get("metaobjects", {}).get("nodes", [])
    print(f"{len(nodes)} existing ingredientes_com_descri_o metaobjects:")
    for n in nodes:
        print(f"\n--- handle: {n['handle']} ---")
        for f in n["fields"]:
            if f["key"] == "imagem":
                ref = f.get("reference") or {}
                img = (ref.get("image") or {})
                print(f"  imagem URL: {img.get('url')} ({img.get('width')}x{img.get('height')})")
            else:
                print(f"  {f['key']}: {(f.get('value') or '')[:120]}")


if __name__ == "__main__":
    main()
