"""Find where the GEB 001 PDP 'Ingredientes' block (Sensoveil / Hebeatol / full
INCI) actually comes from. Resolves the descricao_longa_com_abas metaobject and
any nested metaobjects, searching for the tell-tale strings. Read-only."""
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
URL = f"https://{cfg.get('SHOPIFY_SHOP_DOMAIN','ge-beauty-cosmeticos.myshopify.com')}/admin/api/{cfg.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
TOKEN = cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]

NEEDLES = ["sensoveil", "hebeatol", "lista completa", "astrocaryum", "murumuru", "pantenol"]


def gql(query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode("utf-8"))


Q = "query($id: ID!) { metaobject(id: $id) { id type handle fields { key type value } } }"


def resolve(mid, depth=0, seen=None):
    seen = seen or set()
    if mid in seen or depth > 2:
        return
    seen.add(mid)
    d = gql(Q, {"id": mid})
    if "errors" in d:
        print("  ERR", mid, d["errors"][:1]); return
    mo = d["data"]["metaobject"]
    if not mo:
        print("  (null)", mid); return
    pad = "  " * depth
    print(f"{pad}METAOBJECT {mo['type']} handle={mo['handle']} id={mid.split('/')[-1]}")
    for f in mo["fields"]:
        v = f.get("value") or ""
        low = v.lower()
        hit = [n for n in NEEDLES if n in low]
        flag = "  <<< " + ",".join(hit) if hit else ""
        print(f"{pad}   {f['key']} ({f['type']}) len={len(v)}{flag}")
        if hit:
            print(f"{pad}      >>> {re.sub(chr(92)+'s+', ' ', v)[:300]}")
        if f["type"] in ("metaobject_reference", "list.metaobject_reference"):
            for cid in re.findall(r"gid://shopify/Metaobject/\d+", v)[:10]:
                resolve(cid, depth + 1, seen)


resolve("gid://shopify/Metaobject/45617152320")
