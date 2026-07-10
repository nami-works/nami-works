"""
Fetch Shopify product images + retail prices for Magenta proposal.
Outputs: sandbox/gebeauty/scripts/_b2b_magenta_assets.json

Run:
  C:/Python314/python.exe sandbox/gebeauty/scripts/_b2b_fetch_magenta_assets.py
"""
import json, sys, base64, urllib.request, urllib.error
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT     = Path(__file__).resolve().parent
ENV_PATH = ROOT.parent / ".env"
OUT_JSON = ROOT / "_b2b_magenta_assets.json"

# ── Load .env ─────────────────────────────────────────────────────────────────
env = {}
for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
    s = line.strip()
    if not s or s.startswith("#"): continue
    if "=" not in s: continue
    k, v = s.split("=", 1)
    env[k.strip()] = v.strip()

SHOP_DOMAIN  = env.get("SHOPIFY_SHOP_DOMAIN", "")
ACCESS_TOKEN = env.get("SHOPIFY_ADMIN_ACCESS_TOKEN", "")
API_VERSION  = env.get("SHOPIFY_API_VERSION", "2026-01")

# ── Target SKUs ───────────────────────────────────────────────────────────────
def norm(sku): return sku.strip().upper().replace(" ", "").replace("-", "")

PROPOSTA_SKUS = [
    "GEB024", "GEB102", "GEB029", "GEB023",
    "GEB011", "GEB013", "GEB010", "GEB022", "GEB008",
]

# ── Shopify GQL helper ─────────────────────────────────────────────────────────
def gql(query, variables=None):
    url  = f"https://{SHOP_DOMAIN}/admin/api/{API_VERSION}/graphql.json"
    body = json.dumps({"query": query, **({"variables": variables} if variables else {})}).encode()
    req  = urllib.request.Request(url, data=body, headers={
        "Content-Type":            "application/json",
        "X-Shopify-Access-Token":  ACCESS_TOKEN,
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

def fetch_b64(url, label=""):
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            data = r.read()
            ct   = r.headers.get("Content-Type", "image/jpeg").split(";")[0]
            b64  = base64.b64encode(data).decode()
            print(f"    img ok ({len(data)//1024}kB) {label}")
            return f"data:{ct};base64,{b64}"
    except Exception as e:
        print(f"    [!] img fail {label}: {e}")
        return None

# ── 1. Shop brand logo ─────────────────────────────────────────────────────────
SHOP_Q = """{ shop { name brand { logo { image { url } } } } }"""

# ── 2. Products (productType = product | acessorio) ───────────────────────────
# Fetch all pages; cursor pagination
PROD_Q = """
query($after: String) {
  products(first: 250, after: $after,
           query: "product_type:product OR product_type:acessorio") {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        title
        variants(first: 50) {
          edges { node { sku price compareAtPrice } }
        }
        images(first: 1) {
          edges { node { url } }
        }
      }
    }
  }
}
"""

def main():
    assets = {}

    # ── Shop logo ──────────────────────────────────────────────────────────────
    print("Fetching shop brand logo...")
    try:
        res  = gql(SHOP_Q)
        logo = (res.get("data", {}).get("shop", {}).get("brand") or {})
        logo_url = ((logo.get("logo") or {}).get("image") or {}).get("url")
        if logo_url:
            print(f"  logo url: {logo_url[:80]}")
            logo_b64 = fetch_b64(logo_url, "logo")
            assets["logo"] = logo_b64
        else:
            print("  [!] brand.logo not set in shop")
            assets["logo"] = None
    except Exception as e:
        print(f"  [!] logo fetch error: {e}")
        assets["logo"] = None

    # ── Products ───────────────────────────────────────────────────────────────
    print("\nFetching products (productType: product | acessorio)...")
    all_products = []
    cursor = None
    page = 0
    while True:
        page += 1
        res = gql(PROD_Q, {"after": cursor})
        prods = res.get("data", {}).get("products", {})
        edges = prods.get("edges", [])
        all_products.extend(edges)
        pi = prods.get("pageInfo", {})
        if not pi.get("hasNextPage"):
            break
        cursor = pi.get("endCursor")
        print(f"  page {page}: {len(edges)} products fetched, continuing...")

    print(f"  total products: {len(all_products)}")

    # ── Index by SKU ──────────────────────────────────────────────────────────
    sku_map = {}   # norm_sku -> {title, price, compareAtPrice, image_url}
    for edge in all_products:
        node = edge["node"]
        title    = node["title"]
        img_url  = ((node.get("images", {}).get("edges") or [{}])[0].get("node") or {}).get("url")
        for vedge in node.get("variants", {}).get("edges", []):
            v    = vedge["node"]
            nsku = norm(v.get("sku") or "")
            if not nsku: continue
            if nsku in PROPOSTA_SKUS and nsku not in sku_map:
                sku_map[nsku] = {
                    "title":         title,
                    "price":         float(v.get("price") or 0),
                    "compareAtPrice": float(v.get("compareAtPrice") or 0) or None,
                    "image_url":     img_url,
                }

    print(f"  matched SKUs: {sorted(sku_map.keys())}")
    missing = [s for s in PROPOSTA_SKUS if s not in sku_map]
    if missing:
        print(f"  [!] Not found in catalog: {missing}  (will use fallbacks)")

    # ── Download images ────────────────────────────────────────────────────────
    print("\nDownloading product images...")
    products = {}
    for sku in PROPOSTA_SKUS:
        info = sku_map.get(sku)
        if info:
            img_b64 = None
            if info.get("image_url"):
                print(f"  {sku}:")
                img_b64 = fetch_b64(info["image_url"], sku)
            products[sku] = {
                "title":          info["title"],
                "price":          info["price"],
                "compareAtPrice": info["compareAtPrice"],
                "image":          img_b64,
            }
        else:
            products[sku] = {
                "title":          None,
                "price":          None,
                "compareAtPrice": None,
                "image":          None,
            }
            print(f"  {sku}: not found in catalog")

    assets["products"] = products

    # ── Write JSON ─────────────────────────────────────────────────────────────
    OUT_JSON.write_text(json.dumps(assets, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nAssets written to: {OUT_JSON}")

    # ── Summary ────────────────────────────────────────────────────────────────
    print("\nRetail price summary:")
    print(f"{'SKU':<10} {'Title':<40} {'Price':>8} {'CompAt':>8} {'Retail':>8}")
    for sku in PROPOSTA_SKUS:
        p = products[sku]
        retail = p["compareAtPrice"] or p["price"] or 0
        print(f"{sku:<10} {str(p['title'] or 'N/A')[:40]:<40} {p['price'] or 0:>8.2f} {p['compareAtPrice'] or 0:>8.2f} {retail:>8.2f}")


if __name__ == "__main__":
    main()
