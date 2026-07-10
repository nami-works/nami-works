"""Restore custom.ingredients to pre-write state: delete on the 10 SKUs that were
empty, put the original raw-INCI value back on 024 and 121."""
import json
import sys
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ENV = Path(__file__).resolve().parent.parent / ".env"

DELETE_IDS = {  # were null -> remove the metafield
    "GEB 001": "8803151282496", "GEB 002": "8803151184192", "GEB 003": "8803151020352",
    "GEB 020": "8803151315264", "GEB 021": "8803151708480", "GEB 022": "9758954291520",
    "GEB 023": "8803151806784", "GEB 101": "9668674879808", "GEB 102": "9668673798464",
    "GEB 120": "9856328565056",
}
RESTORE = {  # had a value -> put original back
    "GEB 024": ("9946377617728", "Aqua, Alcohol, PEG-40 Hydrogenated Castor Oil, Parfum, Hexylene Glycol, Ceteareth-20, Glycerin, Castor Oil Propanediol Esters, Xylityl Sesquicaprylate, Caprylyl Glycol"),
    "GEB 121": ("9986379383104", "Aqua, Alcohol, PEG-40 Hydrogenated Castor Oil, Parfum, Hexylene Glycol, Ceteareth-20, Glycerin, Castor Oil Propanediol Esters, Xylityl Sesquicaprylate, Caprylyl Glycol"),
}


def load_env(p):
    o = {}
    for l in p.read_text(encoding="utf-8").splitlines():
        l = l.strip()
        if l and not l.startswith("#") and "=" in l:
            k, v = l.split("=", 1)
            o[k.strip()] = v.strip().strip('"').strip("'")
    return o


cfg = load_env(ENV)
URL = f"https://{cfg.get('SHOPIFY_SHOP_DOMAIN','ge-beauty-cosmeticos.myshopify.com')}/admin/api/{cfg.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
TOKEN = cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]


def gql(query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode("utf-8"))


DEL = """
mutation($ids:[MetafieldIdentifierInput!]!){
  metafieldsDelete(metafields:$ids){ deletedMetafields{ ownerId key } userErrors{ message } }
}
"""
SET = """
mutation($mf:[MetafieldsSetInput!]!){
  metafieldsSet(metafields:$mf){ metafields{ ownerType value } userErrors{ message } }
}
"""


def main():
    ids = [{"ownerId": f"gid://shopify/Product/{pid}", "namespace": "custom", "key": "ingredients"}
           for pid in DELETE_IDS.values()]
    d = gql(DEL, {"ids": ids})
    res = d.get("data", {}).get("metafieldsDelete", {})
    print("deleted:", len(res.get("deletedMetafields", [])), "errors:", res.get("userErrors"))

    mf = [{"ownerId": f"gid://shopify/Product/{pid}", "namespace": "custom", "key": "ingredients",
           "type": "single_line_text_field", "value": val} for (pid, val) in RESTORE.values()]
    d2 = gql(SET, {"mf": mf})
    res2 = d2.get("data", {}).get("metafieldsSet", {})
    print("restored:", len(res2.get("metafields", [])), "errors:", res2.get("userErrors"))


if __name__ == "__main__":
    main()
