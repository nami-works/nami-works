"""Reconcile the two ingredient fields for GEB 001: resolve
custom.ingredientes_com_foto (list.metaobject_reference) and dump each referenced
metaobject's fields, so we know what THIS field holds vs descricao_longa.ingredientes."""
import json
import re
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


PROD = """
query {
  product(id: "gid://shopify/Product/8803151282496") {
    mf: metafield(namespace: "custom", key: "ingredientes_com_foto") { value type }
  }
}
"""
MO = "query($id: ID!) { metaobject(id: $id) { type handle fields { key type value } } }"


def main():
    v = gql(PROD)["data"]["product"]["mf"]
    print("custom.ingredientes_com_foto on GEB 001:", (v or {}).get("type"), "=>", (v or {}).get("value"))
    if not v or not v.get("value"):
        print("  (empty — this field is NOT populated on GEB 001)")
        return
    ids = re.findall(r"gid://shopify/Metaobject/\d+", v["value"])
    print(f"  references {len(ids)} metaobject(s)")
    for mid in ids:
        d = gql(MO, {"id": mid})
        mo = d.get("data", {}).get("metaobject")
        if not mo:
            print("   ", mid, "ERR", d.get("errors")); continue
        print(f"   --- {mo['type']} ({mo['handle']}) ---")
        for f in mo["fields"]:
            val = re.sub(r"\s+", " ", f.get("value") or "")[:120]
            print(f"      {f['key']} ({f['type']}): {val}")


if __name__ == "__main__":
    main()
