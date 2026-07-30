"""Activate the bundle (DRAFT->ACTIVE) and publish it to the same sales channels
the shampoo component (GEB 001) is on, so the PDP goes live on the web.
Run from c:\\claude\\gebeauty: C:/Python314/python.exe scripts/_dupla_fort_activate_publish.py --live"""
import json, sys, urllib.request
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
LIVE = "--live" in sys.argv
ENV = Path(__file__).resolve().parent.parent / ".env"
cfg = {}
for l in ENV.read_text(encoding="utf-8").splitlines():
    l = l.strip()
    if l.startswith("SHOPIFY") and "=" in l:
        k, v = l.split("=", 1); cfg[k.strip()] = v.strip().strip('"').strip("'")
URL = f"https://{cfg['SHOPIFY_SHOP_DOMAIN']}/admin/api/{cfg.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
def gql(q, v=None):
    b = json.dumps({"query": q, "variables": v or {}}).encode()
    r = urllib.request.Request(URL, data=b, headers={"Content-Type": "application/json", "X-Shopify-Access-Token": cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]})
    return json.loads(urllib.request.urlopen(r).read().decode())
PID   = "gid://shopify/Product/10217099297088"
SHAMP = "gid://shopify/Product/8803151282496"

# channels the shampoo component is published to (mirror them)
SRC = gql("""query($id:ID!){ product(id:$id){
  resourcePublications(first:30){ nodes{ isPublished publication{ id name } } } } }""", {"id":SHAMP})
chans = [p["publication"] for p in SRC["data"]["product"]["resourcePublications"]["nodes"] if p["isPublished"]]
print("shampoo is published on:", [c["name"] for c in chans])
cur = gql("""query($id:ID!){ product(id:$id){ status
  resourcePublications(first:30){ nodes{ isPublished publication{ id name } } } } }""", {"id":PID})
print("bundle status now:", cur["data"]["product"]["status"],
      "| published on:", [p["publication"]["name"] for p in cur["data"]["product"]["resourcePublications"]["nodes"] if p["isPublished"]])
if not LIVE:
    print("(dry) would set ACTIVE + publish to:", [c["name"] for c in chans]); sys.exit(0)

# 1) activate
AU = """mutation($p:ProductUpdateInput!){ productUpdate(product:$p){ product{ id status } userErrors{ field message } } }"""
au = gql(AU, {"p":{"id":PID,"status":"ACTIVE"}})
err = au["data"]["productUpdate"]["userErrors"]
if err: print("ACTIVATE ERRORS:", err); sys.exit(1)
print("status ->", au["data"]["productUpdate"]["product"]["status"])

# 2) publish to the mirrored channels
PUB = """mutation($id:ID!,$in:[PublicationInput!]!){ publishablePublish(id:$id,input:$in){
  userErrors{ field message } } }"""
pub = gql(PUB, {"id":PID,"in":[{"publicationId":c["id"]} for c in chans]})
err = pub["data"]["publishablePublish"]["userErrors"]
if err: print("PUBLISH ERRORS:", err); sys.exit(1)
after = gql("""query($id:ID!){ product(id:$id){ handle status onlineStoreUrl
  resourcePublications(first:30){ nodes{ isPublished publication{ name } } } } }""", {"id":PID})
p = after["data"]["product"]
print("published on:", [x["publication"]["name"] for x in p["resourcePublications"]["nodes"] if x["isPublished"]])
print("handle:", p["handle"], "| status:", p["status"])
print("onlineStoreUrl:", p.get("onlineStoreUrl"))
print("DONE activate+publish.")
