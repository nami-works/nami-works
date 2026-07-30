"""Upload the hero image (DUPLA_FORTIFICANTE.png) to the bundle product as featured media.
Image was downloaded from Drive to the scratchpad. Run from c:\\claude\\gebeauty:
  C:/Python314/python.exe scripts/_dupla_fort_apply_hero.py --live"""
import json, sys, os, uuid, urllib.request
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

PID = "gid://shopify/Product/10217099297088"
IMG = Path(os.environ.get("HERO_PATH", r"C:\Users\LUCASG~1\AppData\Local\Temp\claude\C--claude\86a34660-68e0-462f-9b94-3df01bd20569\scratchpad\dupla_fort.png"))
ALT = "Dupla Shampoo Sem Sulfato + Booster Fortificante GE Beauty"
data = IMG.read_bytes()
print("image:", IMG, "bytes:", len(data), "LIVE:", LIVE)
if not LIVE:
    print("(dry) would staged-upload + productCreateMedia as featured hero"); sys.exit(0)

# 1) staged upload target
SU = """mutation($i:[StagedUploadInput!]!){ stagedUploadsCreate(input:$i){
  stagedTargets{ url resourceUrl parameters{ name value } } userErrors{ field message } } }"""
su = gql(SU, {"i":[{"resource":"IMAGE","filename":"DUPLA_FORTIFICANTE.png","mimeType":"image/png","httpMethod":"POST"}]})
err = su["data"]["stagedUploadsCreate"]["userErrors"]
if err: print("STAGED ERRORS:", err); sys.exit(1)
tgt = su["data"]["stagedUploadsCreate"]["stagedTargets"][0]

# 2) POST bytes to staged target (multipart/form-data)
boundary = "----geb" + uuid.uuid4().hex
CRLF = "\r\n"
body = b""
for p in tgt["parameters"]:
    body += ("--"+boundary+CRLF).encode()
    body += (f'Content-Disposition: form-data; name="{p["name"]}"'+CRLF+CRLF).encode()
    body += (p["value"]+CRLF).encode()
body += ("--"+boundary+CRLF).encode()
body += (f'Content-Disposition: form-data; name="file"; filename="DUPLA_FORTIFICANTE.png"'+CRLF).encode()
body += ("Content-Type: image/png"+CRLF+CRLF).encode()
body += data + CRLF.encode()
body += ("--"+boundary+"--"+CRLF).encode()
req = urllib.request.Request(tgt["url"], data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
resp = urllib.request.urlopen(req)
print("staged upload HTTP:", resp.status)

# 3) attach as product media
CM = """mutation($pid:ID!,$m:[CreateMediaInput!]!){ productCreateMedia(productId:$pid,media:$m){
  media{ ... on MediaImage{ id status } } mediaUserErrors{ field message } } }"""
cm = gql(CM, {"pid":PID,"m":[{"originalSource":tgt["resourceUrl"],"mediaContentType":"IMAGE","alt":ALT}]})
err = cm["data"]["productCreateMedia"]["mediaUserErrors"]
if err: print("MEDIA ERRORS:", err); sys.exit(1)
print("media attached:", cm["data"]["productCreateMedia"]["media"])
print("DONE hero image.")
