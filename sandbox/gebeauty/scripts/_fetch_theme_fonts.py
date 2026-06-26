"""One-off (pass 2): find WHERE Italian Plate cuts are APPLIED vs Assistant, and the
Dawn :root font-variable definitions, so the B2B catalog can mirror the DTC combination."""
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
        return json.loads(r.read().decode("utf-8"))


def asset(key):
    return get(f"{BASE}/assets.json?asset[key]={urllib.parse.quote(key)}")["asset"].get("value", "")


keys = [a["key"] for a in get(f"{BASE}/assets.json")["assets"]]

# 1) Dawn :root font vars from theme.liquid
tl = asset("layout/theme.liquid")
print("=== theme.liquid :root font vars + Italian applications ===")
for ln in tl.splitlines():
    if re.search(r"--font-(heading|body)-family|--font-(heading|body)-weight", ln) or \
       (re.search(r"font-family\s*:", ln) and "Italian" in ln):
        print("  ", ln.strip()[:200])

# 2) Italian Plate APPLICATIONS across all css (selector: font-family rule), exclude @font-face src
print("\n=== Italian Plate APPLICATIONS (asset :: selector -> rule) ===")
for key in [k for k in keys if k.endswith(".css") or k.endswith(".liquid")]:
    try:
        txt = asset(key)
    except Exception:
        continue
    lines = txt.splitlines()
    for i, ln in enumerate(lines):
        if re.search(r"font-family\s*:", ln) and re.search(r"Italian", ln, re.I) and "src:" not in ln and "@font-face" not in lines[max(0, i-1)]:
            # climb to nearest selector line
            sel = ""
            for j in range(i, max(0, i-8), -1):
                if "{" in lines[j]:
                    sel = lines[j].split("{")[0].strip()
                    break
            print(f"  {key} :: {sel[:80]} -> {ln.strip()[:120]}")
