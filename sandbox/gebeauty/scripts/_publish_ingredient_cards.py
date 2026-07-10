"""Set all ingredientes_com_descri_o metaobjects to publishable status ACTIVE so
they render on the storefront carousel. Reports before/after status."""
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


def gql(query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode("utf-8"))


LIST = """
query($cursor: String) {
  metaobjects(type: "ingredientes_com_descri_o", first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { id handle capabilities { publishable { status } } }
  }
}
"""
UPDATE = """
mutation($id: ID!, $mo: MetaobjectUpdateInput!) {
  metaobjectUpdate(id: $id, metaobject: $mo) {
    metaobject { handle capabilities { publishable { status } } }
    userErrors { field message code }
  }
}
"""


def main():
    nodes, cursor = [], None
    while True:
        d = gql(LIST, {"cursor": cursor})
        conn = d["data"]["metaobjects"]
        nodes.extend(conn["nodes"])
        if not conn["pageInfo"]["hasNextPage"]:
            break
        cursor = conn["pageInfo"]["endCursor"]

    to_fix = [n for n in nodes if (n["capabilities"]["publishable"]["status"] != "ACTIVE")]
    print(f"{len(nodes)} cards total; {len(to_fix)} not ACTIVE")
    for n in to_fix:
        d = gql(UPDATE, {"id": n["id"], "mo": {"capabilities": {"publishable": {"status": "ACTIVE"}}}})
        res = d.get("data", {}).get("metaobjectUpdate", {})
        errs = res.get("userErrors") or d.get("errors")
        if errs:
            print(f"  ERROR {n['handle']}: {errs}")
        else:
            print(f"  {n['handle']} -> {res['metaobject']['capabilities']['publishable']['status']}")
    print("done")


if __name__ == "__main__":
    main()
