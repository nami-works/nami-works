"""Emilia's shipping zip + catalog weights (to build a heaviest-basket R$199 draft). Read-only."""
import json, urllib.request, os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
URL = "https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json"


def gql(q, v=None):
    b = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    r = urllib.request.Request(URL, data=b, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(r, timeout=60).read())


# --- 1. Her addresses (default + per-order shipping) ---
ADDR = """
query {
  customer(id: "gid://shopify/Customer/9324651315520") {
    displayName
    defaultAddress { zip address1 city province country }
    addresses { zip address1 city province country }
    orders(first: 5, reverse: true) {
      edges { node { name shippingAddress { zip address1 city province country } } }
    }
  }
}
"""
r = gql(ADDR)
if r.get("errors"):
    print("ADDR ERR:", json.dumps(r["errors"], ensure_ascii=False));
else:
    c = r["data"]["customer"]
    print(f"=== {c['displayName']} addresses ===")
    print("  default:", c["defaultAddress"])
    for a in c["addresses"]:
        print("  addr   :", a)
    for e in c["orders"]["edges"]:
        n = e["node"]
        print(f"  {n['name']} ship-to:", n["shippingAddress"])

# --- 2. Catalog weights (full-size, avulso) to find heaviest per real ---
PROD = """
query {
  products(first: 60, query: "tag:full-size") {
    edges { node {
      title status tags
      variants(first: 3) {
        edges { node {
          title
          price
          inventoryItem { measurement { weight { value unit } } }
          inventoryQuantity
        } }
      }
    } }
  }
}
"""
r2 = gql(PROD)
print("\n=== full-size products: price + weight ===")
if r2.get("errors"):
    print("PROD ERR:", json.dumps(r2["errors"], ensure_ascii=False))
else:
    rows = []
    for e in r2["data"]["products"]["edges"]:
        n = e["node"]
        if n["status"] != "ACTIVE":
            continue
        if "lancto" in n["tags"]:
            note = " [lancto-excluded]"
        else:
            note = ""
        v = n["variants"]["edges"][0]["node"]
        w = v["inventoryItem"]["measurement"]["weight"]
        wval = w["value"] if w else None
        wunit = w["unit"] if w else ""
        rows.append((wval or 0, n["title"], v["price"], wval, wunit, v["inventoryQuantity"], note))
    for wv, title, price, wval, wunit, qty, note in sorted(rows, reverse=True):
        print(f"  {wval} {wunit:<5} | R${price:<8} | stock={qty:<5} | {title}{note}")
