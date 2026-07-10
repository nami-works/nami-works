"""Apply the two approved free-shipping comms changes:
  1. Theme config/settings_data.json: enable cart free-ship progress bar + restore text.
  2. Pre-venda page (157722542400): replace 'por regiao' framing with flat R$299.

DRY-RUN by default; pass --execute to write. Aborts if any regex match count != 1.
"""
import json, sys, re, urllib.request, urllib.parse, os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
BASE = "https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01"
HDRS = {"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN}
THEME = 181379236160
PAGE_GID = "gid://shopify/Page/157722542400"
DRY = "--execute" not in sys.argv


def rest_get(path):
    r = urllib.request.Request(BASE + path, headers=HDRS)
    return json.loads(urllib.request.urlopen(r, timeout=60).read())


def rest_put(path, payload):
    r = urllib.request.Request(BASE + path, data=json.dumps(payload).encode(),
                               headers=HDRS, method="PUT")
    return json.loads(urllib.request.urlopen(r, timeout=60).read())


def gql(q, v=None):
    b = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    r = urllib.request.Request(f"{BASE}/graphql.json", data=b, headers=HDRS)
    return json.loads(urllib.request.urlopen(r, timeout=60).read())


# ---------- 1. THEME settings ----------
q = urllib.parse.urlencode({"asset[key]": "config/settings_data.json"})
sd_raw = rest_get(f"/themes/{THEME}/assets.json?{q}")["asset"]["value"]
sd = json.loads(sd_raw)
cur = sd["current"]
assert isinstance(cur, dict), "settings_data current is not a dict"

before = {k: cur.get(k) for k in
          ("show_free_shipping_progress", "free_shipping_text", "free_shipping_text_come")}
cur["show_free_shipping_progress"] = True
cur["free_shipping_text"] = "Faltam [amount] para o frete grátis"
cur["free_shipping_text_come"] = "Você ganhou frete grátis!"
after = {k: cur[k] for k in before}
print("THEME settings_data.json:")
print("  before:", json.dumps(before, ensure_ascii=False))
print("  after :", json.dumps(after, ensure_ascii=False))
new_sd = json.dumps(sd, ensure_ascii=False)

# ---------- 2. PAGE copy ----------
pg = gql('{ page(id: "%s") { body } }' % PAGE_GID)["data"]["page"]
body = pg["body"]

pa = re.compile(r"<p>O valor m.*?aqui</a>\.</p>", re.DOTALL)
NEW_A = ('<p>O <strong>frete grátis</strong> é aplicado automaticamente em pedidos a partir de '
         '<strong>R$299</strong>, conforme o valor total do carrinho. Mais detalhes na nossa '
         '<a title="Política de frete GE Beauty" '
         'href="https://www.gebeauty.com.br/policies/shipping-policy" target="_blank">'
         'Política de Frete</a>.</p>')

pb = re.compile(r"Os pedidos eleg.*?regi.o de entrega\.", re.DOTALL)
NEW_B = ('Os pedidos a partir de <strong>R$299</strong> recebem <strong>frete grátis</strong> '
         'automaticamente, conforme a nossa '
         '<a title="Política de Frete GE Beauty" '
         'href="https://www.gebeauty.com.br/policies/shipping-policy">Política de Frete</a>.')

na, nb = len(pa.findall(body)), len(pb.findall(body))
print(f"\nPAGE matches: passageA={na} passageB={nb} (each must be 1)")
assert na == 1 and nb == 1, "ABORT: page regex match count != 1"
new_body = pb.sub(NEW_B, pa.sub(NEW_A, body))
print("  passage A ->", pa.search(new_body) is None and "replaced" or "STILL PRESENT")
print("\n  NEW A:", NEW_A)
print("\n  NEW B:", NEW_B)

if DRY:
    print("\n(DRY-RUN — nothing written. Re-run with --execute.)")
    sys.exit(0)

# ---- write theme ----
r1 = rest_put(f"/themes/{THEME}/assets.json",
              {"asset": {"key": "config/settings_data.json", "value": new_sd}})
print("\nTHEME write:", "OK" if r1.get("asset") else json.dumps(r1, ensure_ascii=False))

# ---- write page ----
r2 = gql("""
mutation($id: ID!, $body: String!) {
  pageUpdate(id: $id, page: { body: $body }) {
    page { id title }
    userErrors { field message }
  }
}
""", {"id": PAGE_GID, "body": new_body})
ue = r2.get("data", {}).get("pageUpdate", {}).get("userErrors")
print("PAGE write:", "OK" if ue == [] else json.dumps(r2, ensure_ascii=False))
