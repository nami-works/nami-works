"""One-off: find where a Camila (founder) quote lives in the GE Beauty store -
checks Online Store pages (body_html), blog articles, files/images (alt + filename),
and metaobjects. Prints any match + a snippet."""
import json, re, urllib.request, urllib.parse
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
TOKEN = cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]
GQL = f"https://{DOMAIN}/admin/api/{VER}/graphql.json"
HDR = {"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN}

def gql(q, v=None):
    body = json.dumps({"query": q, "variables": v or {}}).encode()
    with urllib.request.urlopen(urllib.request.Request(GQL, data=body, headers=HDR)) as r:
        return json.loads(r.read().decode())

def rest(path):
    with urllib.request.urlopen(urllib.request.Request(f"https://{DOMAIN}/admin/api/{VER}/{path}", headers={"X-Shopify-Access-Token": TOKEN})) as r:
        return json.loads(r.read().decode())

NEEDLE = re.compile(r"camila", re.I)

def snip(text, kw=NEEDLE, pad=160):
    m = kw.search(text or "")
    if not m:
        return None
    i = m.start()
    return re.sub(r"\s+", " ", text[max(0, i-pad):i+pad])

# 1) PAGES
print("=== ONLINE STORE PAGES ===")
pages = rest("pages.json?limit=250").get("pages", [])
print(f"{len(pages)} pages total. Titles: " + " | ".join(p["title"] for p in pages))
for p in pages:
    blob = (p.get("title", "") + " " + (p.get("body_html") or ""))
    if NEEDLE.search(blob):
        print(f"\n  >>> MATCH page '{p['title']}' (/pages/{p['handle']}):")
        print("      " + (snip(blob) or ""))

# 2) BLOG ARTICLES
print("\n=== BLOG ARTICLES ===")
try:
    blogs = rest("blogs.json").get("blogs", [])
    for b in blogs:
        arts = rest(f"blogs/{b['id']}/articles.json?limit=250").get("articles", [])
        for a in arts:
            blob = (a.get("title", "") + " " + (a.get("body_html") or "") + " " + (a.get("summary_html") or ""))
            if NEEDLE.search(blob):
                print(f"  >>> MATCH article '{a['title']}' (blog {b['handle']}): " + (snip(blob) or ""))
except Exception as e:
    print("  (blogs error)", e)

# 3) FILES / IMAGES
print("\n=== FILES (alt / filename containing 'camila') ===")
q = '{ files(first: 50, query: "camila") { nodes { alt preview { image { url } } ... on MediaImage { image { url } } ... on GenericFile { url } } } }'
try:
    data = gql(q)
    nodes = data.get("data", {}).get("files", {}).get("nodes", [])
    if not nodes:
        print("  (no files match 'camila' search)")
    for n in nodes:
        url = ((n.get("image") or {}).get("url")) or n.get("url") or ((n.get("preview") or {}).get("image") or {}).get("url")
        print(f"  alt={n.get('alt')!r}  url={url}")
except Exception as e:
    print("  (files error)", e, json.dumps(data) if 'data' in dir() else '')

# 4) METAOBJECTS (scan types, then entries for camila)
print("\n=== METAOBJECTS ===")
try:
    defs = gql('{ metaobjectDefinitions(first:50){nodes{type}} }')["data"]["metaobjectDefinitions"]["nodes"]
    for d in defs:
        t = d["type"]
        res = gql('query($t:String!){ metaobjects(type:$t, first:50){nodes{handle fields{key value}}} }', {"t": t})
        for mo in res.get("data", {}).get("metaobjects", {}).get("nodes", []):
            blob = mo["handle"] + " " + " ".join((f.get("value") or "") for f in mo["fields"])
            if NEEDLE.search(blob):
                print(f"  >>> MATCH metaobject type={t} handle={mo['handle']}: " + (snip(blob) or ""))
except Exception as e:
    print("  (metaobjects error)", e)
