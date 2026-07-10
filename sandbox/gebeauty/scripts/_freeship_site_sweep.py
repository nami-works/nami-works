"""Full-sweep: everywhere the GE Beauty storefront communicates free shipping.

Read-only. Scans:
  1. Published theme assets (all text files) for frete / grátis / free shipping / thresholds
  2. config/settings_data.json free-shipping-related keys
  3. Online store pages (entrega / frete / shipping)
  4. Shop policies (shipping policy)
Writes full findings to _freeship_site_sweep.out.json; prints a summary.
"""
import json, re, time, urllib.request, urllib.parse, os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
SHOP = "ge-beauty-cosmeticos.myshopify.com"
VER = "2026-01"
BASE = f"https://{SHOP}/admin/api/{VER}"
HDRS = {"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN}

# Terms that indicate free-shipping / shipping-threshold messaging
PAT = re.compile(
    r"(frete\s*gr[aá]tis|frete|gr[aá]tis|free\s*ship|freeship|free_shipping|"
    r"shipping|entrega\s*gr[aá]tis|envio\s*gr[aá]tis|ganhe\s*(o\s*)?frete|"
    r"acima\s*de\s*r?\$?\s*\d|a\s*partir\s*de\s*r?\$?\s*\d)",
    re.IGNORECASE)
MONEY = re.compile(r"r\$\s?\d{2,4}([.,]\d{2})?", re.IGNORECASE)


def rest(path):
    req = urllib.request.Request(BASE + path, headers=HDRS)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def gql(q, v=None):
    b = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    req = urllib.request.Request(f"{BASE}/graphql.json", data=b, headers=HDRS)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


findings = {"theme": None, "domain": None, "asset_hits": [], "settings_keys": [],
            "pages": [], "policies": []}

# --- domain + published theme ---
shop = gql("{ shop { name primaryDomain { url host } } }")["data"]["shop"]
findings["domain"] = shop["primaryDomain"]
themes = rest("/themes.json")["themes"]
main = next(t for t in themes if t["role"] == "main")
findings["theme"] = {"id": main["id"], "name": main["name"]}
tid = main["id"]
print(f"Domain: {shop['primaryDomain']['url']}")
print(f"Published theme: {main['name']} (id {tid})\n")

# --- list assets ---
assets = rest(f"/themes/{tid}/assets.json")["assets"]
text_assets = [a for a in assets
               if a["key"].rsplit(".", 1)[-1].lower() in
               ("liquid", "json", "js", "css", "md", "txt", "svg")]
print(f"{len(assets)} assets total; scanning {len(text_assets)} text assets...")

for i, a in enumerate(text_assets):
    key = a["key"]
    try:
        q = urllib.parse.urlencode({"asset[key]": key})
        data = rest(f"/themes/{tid}/assets.json?{q}")
        val = data.get("asset", {}).get("value")
        if not val:
            continue
    except Exception as e:
        print(f"  ! skip {key}: {e}")
        continue
    hits = []
    for ln, line in enumerate(val.splitlines(), 1):
        if PAT.search(line):
            hits.append({"line": ln, "text": line.strip()[:300]})
    if hits:
        findings["asset_hits"].append({"asset": key, "count": len(hits), "lines": hits})
    if (i + 1) % 40 == 0:
        time.sleep(0.6)

# --- settings_data.json free-shipping keys ---
try:
    q = urllib.parse.urlencode({"asset[key]": "config/settings_data.json"})
    sd = rest(f"/themes/{tid}/assets.json?{q}")["asset"]["value"]
    sd_json = json.loads(sd)

    def walk(obj, path=""):
        out = []
        if isinstance(obj, dict):
            for k, v in obj.items():
                p = f"{path}.{k}" if path else k
                if re.search(r"frete|ship|free|promo_bar|gift|threshold|min(imum)?_amount", k, re.I):
                    out.append({"key": p, "value": v if not isinstance(v, (dict, list)) else "(nested)"})
                out += walk(v, p)
        elif isinstance(obj, list):
            for idx, v in enumerate(obj):
                out += walk(v, f"{path}[{idx}]")
        return out
    findings["settings_keys"] = walk(sd_json)
except Exception as e:
    findings["settings_keys"] = [{"error": str(e)}]

# --- online store pages ---
pg = gql("""
{ pages(first: 50) { edges { node { title handle bodySummary body } } } }
""")
for e in pg.get("data", {}).get("pages", {}).get("edges", []):
    n = e["node"]
    body = (n.get("body") or "")
    if PAT.search(n["title"] + " " + body):
        snippets = [l.strip()[:300] for l in re.split(r"<[^>]+>|\n", body) if PAT.search(l)][:8]
        findings["pages"].append({"title": n["title"], "handle": n["handle"], "snippets": snippets})

# --- shop policies ---
try:
    polr = gql("{ shop { shippingPolicy { body url } refundPolicy { body url } } }")
    pol = polr.get("data", {}).get("shop") or {}
    if polr.get("errors"):
        findings["policies"].append({"query_errors": polr["errors"]})
    for name in ("shippingPolicy", "refundPolicy"):
        p = pol.get(name)
        if p and p.get("body") and PAT.search(p["body"]):
            snippets = [l.strip()[:300] for l in re.split(r"<[^>]+>|\n", p["body"]) if PAT.search(l)][:8]
            findings["policies"].append({"policy": name, "url": p.get("url"), "snippets": snippets})
except Exception as e:
    findings["policies"].append({"error": str(e)})

out = Path(__file__).resolve().with_suffix(".out.json")
out.write_text(json.dumps(findings, ensure_ascii=False, indent=2), encoding="utf-8")

print("\n===== SUMMARY =====")
print(f"\nTheme assets with shipping language: {len(findings['asset_hits'])}")
for h in findings["asset_hits"]:
    print(f"  {h['asset']}  ({h['count']} line(s))")
print(f"\nsettings_data.json shipping/promo keys: {len(findings['settings_keys'])}")
for k in findings["settings_keys"]:
    print(f"  {k.get('key')} = {k.get('value')}")
print(f"\nPages mentioning shipping: {len(findings['pages'])}")
for p in findings["pages"]:
    print(f"  [{p['handle']}] {p['title']}")
print(f"\nPolicies mentioning shipping: {len(findings['policies'])}")
for p in findings["policies"]:
    print(f"  {p['policy']}: {p['url']}")
print(f"\nFull detail -> {out.name}")
