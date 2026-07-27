"""Recon: does the GE storefront search index PAGES? Determines how to keep two
new pages out of storefront search. Read-only."""
import json, re, urllib.parse, urllib.request
from pathlib import Path

ENV = Path(__file__).resolve().parent.parent / ".env"
cfg = {}
for line in ENV.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        cfg[k.strip()] = v.strip().strip('"').strip("'")
DOMAIN = cfg.get("SHOPIFY_SHOP_DOMAIN", "ge-beauty-cosmeticos.myshopify.com")
VER = cfg.get("SHOPIFY_API_VERSION", "2026-01")
THEME = "181379236160"
BASE = f"https://{DOMAIN}/admin/api/{VER}/themes/{THEME}"
HDR = {"X-Shopify-Access-Token": cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]}

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HDR)) as r:
        return json.loads(r.read().decode())

def asset(key):
    return get(f"{BASE}/assets.json?asset[key]={urllib.parse.quote(key)}")["asset"].get("value", "")

keys = [a["key"] for a in get(f"{BASE}/assets.json")["assets"]]
search_assets = [k for k in keys if "search" in k.lower()]
print("search-related theme assets:", ", ".join(search_assets) or "(none)")

# predictive search config in settings_data.json
try:
    sd = json.loads(asset("config/settings_data.json"))
    cur = sd.get("current", {})
    hits = {k: v for k, v in (cur.items() if isinstance(cur, dict) else []) if "search" in k.lower() or "predictive" in k.lower()}
    print("\nsettings_data search keys:", json.dumps(hits, ensure_ascii=False) if hits else "(none)")
except Exception as e:
    print("settings err", e)

# look at the search form/section for resource type declarations
for key in ["sections/main-search.liquid", "snippets/predictive-search.liquid",
            "sections/predictive-search.liquid", "snippets/search-form.liquid",
            "sections/header.liquid", "assets/predictive-search.js"]:
    if key not in keys:
        continue
    try:
        txt = asset(key)
    except Exception:
        continue
    lines = [ln.strip()[:160] for ln in txt.splitlines()
             if re.search(r'type["\']?\s*[:=].*(page|article|product)|resources\[type\]|predictive_search|search\.types|type:\s*[\'"]', ln, re.I)]
    if lines:
        print(f"\n### {key}")
        for ln in lines[:12]:
            print("   ", ln)
