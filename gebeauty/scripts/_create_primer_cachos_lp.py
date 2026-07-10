"""Build the Primer Cachos Definidos cold-traffic LP as a Shopify Page (body_html),
rendered by the live theme. Mirrors _create_pontos_fisicos_page.py conventions.

Modes:
  mockup  (default) -> writes local HTML to inputs/mockups/, ZERO store writes
  preview           -> create/update an UNLISTED preview Page (phone-accessible URL)
  apply             -> push to the final Page (created on first apply, then updated)

Namespaced .gepc-*. CSS-only + <details> FAQ (no JS). Product price/variant/image
are fetched LIVE so nothing is hardcoded stale. Copy is the /growth-hacker approved
set; social proof = verbatim comments from the Canva comment-ads (rendered as HTML).

Asset slots still pending (placeholders marked in-page):
  - HERO transformation media (Fernanda Paes Leme, rights-gated) -> swap .gepc-hero-media
  - before/after + creator UGC + texture macro -> swap .gepc-proof-media blocks
Free shipping is >= R$299 (store rule), reflected in the reassurance row.
"""
import json, urllib.request, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')

TOKEN = None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='):
        TOKEN = line.strip().split('=', 1)[1]
API = 'https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01'
STORE = 'https://ge-beauty-cosmeticos.myshopify.com'
PRODUCT_HANDLE = 'primer-cachos-definidos'
PREVIEW_HANDLE = 'primer-cachos-lp-preview'
PREVIEW_TITLE = 'Primer Cachos (LP preview)'
FINAL_HANDLE = 'primer-cachos-definido-lp'
FINAL_TITLE = 'Primer Cachos Definidos'
MODE = sys.argv[1] if len(sys.argv) > 1 else 'mockup'


def call(method, path, data=None):
    r = urllib.request.Request(f'{API}{path}',
        data=(json.dumps(data).encode() if data is not None else None), method=method,
        headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    with urllib.request.urlopen(r) as resp:
        b = resp.read().decode()
        return resp.status, (json.loads(b) if b.strip() else {})


def graphql(query, variables=None):
    body = json.dumps({"query": query, **({"variables": variables} if variables else {})}).encode()
    req = urllib.request.Request(f'{API}/graphql.json', data=body,
        headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())


def fetch_product():
    q = '''query($h:String!){ productByHandle(handle:$h){
      id title handle onlineStoreUrl featuredMedia{preview{image{url}}}
      variants(first:1){nodes{id price compareAtPrice}} } }'''
    d = graphql(q, {"h": PRODUCT_HANDLE})
    p = d["data"]["productByHandle"]
    v = p["variants"]["nodes"][0]
    vid = v["id"].split("/")[-1]
    img = (p.get("featuredMedia") or {}).get("preview", {}).get("image", {}).get("url", "")
    return {"title": p["title"], "handle": p["handle"], "variant_id": vid,
            "price": v["price"], "compare": v.get("compareAtPrice"),
            "img": img, "url": p.get("onlineStoreUrl") or f'{STORE}/products/{p["handle"]}'}


PROD = fetch_product()
VID = PROD["variant_id"]
PRICE = f'R$ {float(PROD["price"]):.2f}'.replace('.', ',')
CART = f'/cart/{VID}:1'   # add-to-cart permalink

# social proof (verbatim, from META_CACHOSCOMENTARIOS Canva comment-ad)
COMMENTS = [
    ("priscilaossomatica", "esse primer é MOOOOOOOITO bom pra cabelo cacheado!!! Comprei antes de mudar de país e já tô no foco de comprar mais um assim que botar o pé no Brasil!"),
    ("leilanyriosbarreto", "O melhor! Não deixa o cabelo com a textura pesada! Sem falar no cheiro!!!!"),
    ("isadoracruz", "Viciada no meu primer da GE Beauty"),
]

STYLE = '''<style>
.gepc{--ge-red:#DF372F;--ge-red-dark:#c12d26;--ink:#161616;--muted:#6b6b6b;--line:#ececec;--soft:#fbe9e8;color:var(--ink);max-width:720px;margin:0 auto;font-family:'Helvetica Neue',Arial,sans-serif}
.gepc *{box-sizing:border-box}
.gepc-sec{padding:34px 20px}
.gepc-hero{padding:0 0 8px}
.gepc-hero-media{position:relative;width:100%;aspect-ratio:4/5;background:linear-gradient(135deg,#f4d9d7,#e9b6b2);display:flex;align-items:center;justify-content:center;text-align:center;color:var(--ge-red-dark);font-size:13px;font-weight:600;letter-spacing:.02em}
.gepc-hero-media span{opacity:.8;padding:12px 18px}
.gepc-pad{padding:22px 20px 6px}
.gepc-h1{font-size:clamp(27px,6.2vw,40px);font-weight:800;letter-spacing:-.02em;line-height:1.06;margin:0 0 12px}
.gepc-sub{font-size:clamp(15px,4vw,18px);color:var(--muted);line-height:1.45;margin:0 0 18px}
.gepc-cta{display:flex;align-items:center;justify-content:center;gap:8px;background:var(--ge-red);color:#fff !important;font-size:16px;font-weight:800;padding:15px 20px;border-radius:12px;text-decoration:none;width:100%;transition:background .15s}
.gepc-cta:hover{background:var(--ge-red-dark)}
.gepc-reassure{display:flex;flex-wrap:wrap;gap:6px 14px;justify-content:center;margin:12px 0 6px;font-size:12.5px;color:var(--muted)}
.gepc-reassure b{color:var(--ink);font-weight:700}
.gepc-price{text-align:center;font-size:15px;font-weight:700;margin:14px 0 0}
.gepc-eyebrow{font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--ge-red);margin:0 0 8px}
.gepc-h2{font-size:clamp(21px,4.8vw,28px);font-weight:800;letter-spacing:-.01em;line-height:1.15;margin:0 0 12px}
.gepc-p{font-size:15px;line-height:1.55;color:#2b2b2b;margin:0 0 12px}
.gepc-micro{font-size:12.5px;color:var(--muted);margin:4px 0 0}
.gepc-bene{list-style:none;padding:0;margin:16px 0 0;display:flex;flex-direction:column;gap:10px}
.gepc-bene li{display:flex;gap:10px;align-items:flex-start;font-size:15px;font-weight:600}
.gepc-bene li::before{content:"";flex:none;width:20px;height:20px;border-radius:50%;background:var(--soft);background-image:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><path fill=%22%23DF372F%22 d=%22M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z%22/></svg>');background-repeat:no-repeat;background-position:center;background-size:14px;margin-top:1px}
.gepc-soft{background:var(--soft)}
.gepc-steps{counter-reset:s;list-style:none;padding:0;margin:16px 0 0;display:flex;flex-direction:column;gap:14px}
.gepc-steps li{counter-increment:s;position:relative;padding-left:44px;font-size:15px;line-height:1.4}
.gepc-steps li::before{content:counter(s);position:absolute;left:0;top:-2px;width:30px;height:30px;border-radius:50%;background:var(--ge-red);color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center;font-size:15px}
.gepc-cards{display:flex;flex-direction:column;gap:12px;margin-top:16px}
.gepc-card{border:1px solid var(--line);border-radius:14px;padding:14px 16px;background:#fff}
.gepc-card-top{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.gepc-av{flex:none;width:34px;height:34px;border-radius:50%;background:var(--ge-red);color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center;font-size:15px;text-transform:uppercase}
.gepc-user{font-size:13.5px;font-weight:700}
.gepc-verified{font-size:11px;color:var(--ge-red);font-weight:700}
.gepc-ctext{font-size:14px;line-height:1.5;color:#2b2b2b;margin:0}
.gepc-proof-media{width:100%;aspect-ratio:1/1;background:linear-gradient(135deg,#eef1ee,#dfe4df);border-radius:14px;display:flex;align-items:center;justify-content:center;text-align:center;color:#7a7a7a;font-size:12.5px;font-weight:600;margin-top:16px;padding:14px}
.gepc-prod{width:100%;border-radius:14px;display:block;margin:16px auto 0;max-width:360px}
details.gepc-faq{border-bottom:1px solid var(--line);padding:14px 0}
details.gepc-faq summary{font-size:15px;font-weight:700;cursor:pointer;list-style:none;display:flex;justify-content:space-between;gap:12px}
details.gepc-faq summary::-webkit-details-marker{display:none}
details.gepc-faq summary::after{content:"+";color:var(--ge-red);font-weight:800}
details.gepc-faq[open] summary::after{content:"–"}
details.gepc-faq p{font-size:14px;line-height:1.5;color:var(--muted);margin:10px 0 0}
.gepc-close{text-align:center}
.gepc-tag{font-size:15px;font-style:italic;color:var(--ge-red);margin:16px 0 0;font-weight:600}
.gepc-sticky{position:fixed;left:0;right:0;bottom:0;z-index:50;background:#fff;border-top:1px solid var(--line);box-shadow:0 -4px 18px rgba(0,0,0,.08);padding:10px 14px;display:flex;align-items:center;gap:12px}
.gepc-sticky .p{font-size:14px;font-weight:800;white-space:nowrap}
.gepc-sticky a{flex:1;background:var(--ge-red);color:#fff !important;text-decoration:none;font-weight:800;font-size:15px;padding:12px;border-radius:10px;text-align:center}
.gepc-spacer{height:76px}
@media(min-width:721px){.gepc-sticky{display:none}.gepc-spacer{display:none}.gepc-hero-media{aspect-ratio:16/9}}
</style>'''


def comment_card(user, text):
    return (f'<div class="gepc-card"><div class="gepc-card-top">'
            f'<div class="gepc-av">{user[0]}</div>'
            f'<div><div class="gepc-user">@{user}</div>'
            f'<div class="gepc-verified">avaliação verificada</div></div></div>'
            f'<p class="gepc-ctext">{text}</p></div>')


CARDS = ''.join(comment_card(u, t) for u, t in COMMENTS)

BODY = STYLE + f'''<div class="gepc">

<section class="gepc-hero">
  <div class="gepc-hero-media"><span>[ vídeo de transformação — Fernanda Paes Leme · asset em produção / rights ]</span></div>
  <div class="gepc-pad">
    <h1 class="gepc-h1">Definição de salão no seu cabelo, todo dia em casa.</h1>
    <p class="gepc-sub">Primer que define os cachos, protege do calor e hidrata sem pesar. O mesmo resultado que você viu, agora nas suas mãos.</p>
    <a class="gepc-cta" href="{CART}">Quero meus cachos definidos</a>
    <div class="gepc-reassure"><span><b>6x</b> sem juros</span><span><b>frete grátis</b> acima de R$299</span><span><b>troca grátis</b> em até 7 dias</span></div>
    <p class="gepc-price">{PRICE}</p>
  </div>
</section>

<section class="gepc-sec">
  <p class="gepc-eyebrow">o problema</p>
  <h2 class="gepc-h2">Você define os cachos de manhã. Até o meio do dia, o frizz volta.</h2>
  <p class="gepc-p">O cabelo cacheado pede definição que aguente o dia inteiro. Só que o calor da escova e do babyliss abre a fibra, e o resultado que era de salão vira frizz e volume sem forma.</p>
</section>

<section class="gepc-sec gepc-soft">
  <p class="gepc-eyebrow">a solução</p>
  <h2 class="gepc-h2">Um primer que prepara o cacho antes de tudo.</h2>
  <p class="gepc-p">O Primer Cachos Definidos age na base: define o desenho do cacho, protege a fibra do calor até 230°C e hidrata sem pesar. O cabelo fica com movimento e leveza, e a definição se mantém por até 24h. Sem frizz, sem aquela sensação de cabelo duro ou engessado.</p>
  <ul class="gepc-bene">
    <li>Define o desenho do cacho por até 24h</li>
    <li>Protege a fibra do calor até 230°C</li>
    <li>Hidrata sem pesar, com movimento e leveza</li>
  </ul>
  <img class="gepc-prod" src="{PROD['img']}" alt="Primer Cachos Definidos GE Beauty" loading="lazy">
  <p class="gepc-micro" style="text-align:center">250mL · para cabelos cacheados e ondulados</p>
</section>

<section class="gepc-sec">
  <p class="gepc-eyebrow">quem usa, aprova</p>
  <h2 class="gepc-h2">O antes e depois é real, e dura.</h2>
  <div class="gepc-cards">{CARDS}</div>
  <div class="gepc-proof-media"><span>[ antes / depois + UGC da creator · asset em produção ]</span></div>
</section>

<section class="gepc-sec gepc-soft">
  <p class="gepc-eyebrow">como usar</p>
  <h2 class="gepc-h2">Definição de salão em 3 passos.</h2>
  <ol class="gepc-steps">
    <li>Aplique no cabelo úmido, mecha a mecha, da raiz às pontas.</li>
    <li>Distribua com as mãos ou pente, modelando o desenho do cacho.</li>
    <li>Finalize ao natural ou com difusor. Cacho definido por até 24h.</li>
  </ol>
</section>

<section class="gepc-sec">
  <p class="gepc-eyebrow">ainda em dúvida?</p>
  <h2 class="gepc-h2">Perguntas rápidas.</h2>
  <details class="gepc-faq"><summary>Serve para o meu cabelo?</summary><p>Sim. Foi feito para cachos e ondulados, de qualquer densidade. Ele define o desenho que o seu cabelo já tem, respeitando o seu tipo de cacho.</p></details>
  <details class="gepc-faq"><summary>Dura mesmo o dia todo?</summary><p>A definição se mantém por até 24h. Você aplica de manhã e segue o dia sem precisar refazer.</p></details>
  <details class="gepc-faq"><summary>Pesa ou resseca o cabelo?</summary><p>Não. Ele hidrata sem pesar, então o cabelo fica definido, macio e com movimento, nunca duro ou opaco.</p></details>
</section>

<section class="gepc-sec gepc-close">
  <h2 class="gepc-h2">Seus cachos definidos começam hoje.</h2>
  <p class="gepc-p" style="text-align:center">O mesmo resultado de salão, agora na sua rotina.</p>
  <a class="gepc-cta" href="{CART}" style="max-width:420px;margin:0 auto">Quero meus cachos definidos</a>
  <div class="gepc-reassure"><span><b>6x</b> sem juros</span><span><b>frete grátis</b> acima de R$299</span><span><b>troca grátis</b> em até 7 dias</span></div>
  <p class="gepc-tag">no seu tempo, do seu jeito.</p>
</section>

</div>
<div class="gepc-spacer"></div>
<div class="gepc-sticky"><span class="p">{PRICE}</span><a href="{CART}">Quero meus cachos definidos</a></div>'''


def upsert_page(handle, title):
    _, lst = call('GET', '/pages.json?limit=250&fields=id,handle')
    ex = next((pg for pg in lst.get('pages', []) if pg['handle'] == handle), None)
    if ex:
        call('PUT', f"/pages/{ex['id']}.json", {'page': {'id': ex['id'], 'body_html': BODY, 'title': title}})
        return ex['id'], 'UPDATED'
    _, r = call('POST', '/pages.json', {'page': {'title': title, 'handle': handle, 'body_html': BODY, 'published': True}})
    return r['page']['id'], 'CREATED'


print(f'product: {PROD["title"]} | variant {VID} | {PRICE} | img {"yes" if PROD["img"] else "MISSING"}')
print(f'BODY: {len(BODY)} chars | CTA -> {CART}')

MOCK = Path(__file__).resolve().parents[3] / "inputs" / "mockups" / "gebeauty-primer-cachos-lp-v1.html"
doc = ('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
       '<meta name="viewport" content="width=device-width,initial-scale=1">'
       '<title>GE Beauty — Primer Cachos LP (mockup)</title>'
       '<style>body{margin:0;background:#fff}</style></head><body>' + BODY + '</body></html>')
MOCK.write_text(doc, encoding='utf-8')
print('MOCKUP:', MOCK)

if MODE == 'preview':
    pid, action = upsert_page(PREVIEW_HANDLE, PREVIEW_TITLE)
    print(f'PREVIEW page {action}: {pid}')
    print('preview URL:', f'{STORE}/pages/{PREVIEW_HANDLE}')
elif MODE == 'apply':
    pid, action = upsert_page(FINAL_HANDLE, FINAL_TITLE)
    print(f'FINAL page {action}: {pid}')
    print('URL:', f'https://www.gebeauty.com.br/pages/{FINAL_HANDLE}')
else:
    print('Mockup only. Pass "preview" for the phone URL, "apply" for the final page.')
