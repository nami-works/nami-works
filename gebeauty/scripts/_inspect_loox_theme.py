"""Read-only: inspect the published GE Beauty theme for Loox widget placement.

Answers 'is Loox already front-and-center on the site?' from the theme side:
which app embeds/blocks reference loox, and where the reviews widget + star
rating sit in the product template / homepage. Loox account settings (sort
order, product grouping, plan tier, featured pins) are NOT in the theme — those
live in Loox admin and must be checked there.
"""
from pathlib import Path
import json, urllib.request, os
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
SHOP = os.environ["SHOPIFY_SHOP_DOMAIN"]
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
VER = os.environ.get("SHOPIFY_API_VERSION", "2026-01")
BASE = f"https://{SHOP}/admin/api/{VER}"

def rest(path):
    req = urllib.request.Request(BASE + path, headers={"X-Shopify-Access-Token": TOKEN})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())

def asset(theme_id, key):
    import urllib.parse
    q = urllib.parse.urlencode({"asset[key]": key})
    return rest(f"/themes/{theme_id}/assets.json?{q}")["asset"]["value"]

themes = rest("/themes.json")["themes"]
main = next(t for t in themes if t["role"] == "main")
print(f"Published theme: {main['name']} (id {main['id']})\n")

def scan(key):
    try:
        raw = asset(main["id"], key)
    except Exception as e:
        print(f"  [{key}] not found ({e})"); return
    low = raw.lower()
    if "loox" not in low:
        print(f"  [{key}] no loox reference"); return
    print(f"  [{key}] LOOX REFERENCED:")
    try:
        data = json.loads(raw)
    except Exception:
        # plain liquid/html asset
        for ln in raw.splitlines():
            if "loox" in ln.lower():
                print("     |", ln.strip()[:140])
        return
    # JSON template/settings: walk for loox block types
    def walk(node, path=""):
        if isinstance(node, dict):
            t = str(node.get("type", ""))
            if "loox" in t.lower():
                dis = node.get("disabled", False)
                print(f"     block type={t}  disabled={dis}  at {path or 'root'}")
            for k, v in node.items():
                walk(v, f"{path}.{k}" if path else k)
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, f"{path}[{i}]")
    walk(data)

print("App embeds + global blocks (config/settings_data.json):")
scan("config/settings_data.json")
print("\nProduct template:")
for k in ["templates/product.json", "templates/product.default.json", "sections/main-product.json"]:
    scan(k)
print("\nHomepage template:")
for k in ["templates/index.json"]:
    scan(k)
