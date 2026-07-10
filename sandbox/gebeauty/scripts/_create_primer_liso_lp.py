# -*- coding: utf-8 -*-
"""Build the Primer Liso Intacto cold-traffic LP mockup, mirroring the Primer Cachos
LP (native landing-page template) so Lucas can approve the KILLER COPY before it is
wired natively into Shopify page metafields.

This is a faithful visual preview of what the native `landing-page` sections will
render. It is NOT the production build (that is page metafields + the shared theme
template). Modes:
  mockup (default) -> writes local HTML to inputs/mockups/, ZERO store writes.

Copy split (per Lucas):
  - IPSIS-LITERIS from the PDP: how-to / results / saiba-mais tabs, before/after
    title + result, the 3 benefit chips. Pulled LIVE from the product metafields.
  - CHANGED (new on-brand cold-traffic copy, /content-director voice): hero,
    problem, solution + bullets, ingredients-as-proof, faq, close.

Voice rules honored: no em dashes, "você" base, ingredient-as-proof (active bound to
benefit), claims canon (230C / 24h), tagline "no seu tempo, do seu jeito."
"""
import json, urllib.request, sys, re
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')

TOKEN = None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='):
        TOKEN = line.strip().split('=', 1)[1]
API = 'https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01'
STORE = 'https://ge-beauty-cosmeticos.myshopify.com'
PRODUCT_HANDLE = 'primer-liso-intacto'
MODE = sys.argv[1] if len(sys.argv) > 1 else 'mockup'


def graphql(query, variables=None):
    body = json.dumps({"query": query, **({"variables": variables} if variables else {})}).encode()
    req = urllib.request.Request(f'{API}/graphql.json', data=body,
        headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode())


def rich_to_html(val):
    """Minimal Shopify rich_text JSON -> HTML (p / ul / ol / li / bold)."""
    if not val:
        return ''
    try:
        node = json.loads(val)
    except Exception:
        return f'<p>{val}</p>'

    def render(n):
        t = n.get('type')
        ch = ''.join(render(c) for c in n.get('children', []))
        if t == 'root':
            return ch
        if t == 'paragraph':
            return f'<p>{ch}</p>' if ch.strip() else ''
        if t == 'list':
            tag = 'ol' if n.get('listType') == 'ordered' else 'ul'
            return f'<{tag}>{ch}</{tag}>'
        if t == 'list-item':
            return f'<li>{ch}</li>'
        if t == 'text':
            txt = n.get('value', '')
            if n.get('bold'):
                txt = f'<strong>{txt}</strong>'
            if n.get('italic'):
                txt = f'<em>{txt}</em>'
            return txt
        return ch
    return render(node)


def fetch():
    q = '''query($h:String!){ productByHandle(handle:$h){
      id title handle onlineStoreUrl
      featuredMedia{preview{image{url}}}
      variants(first:1){nodes{id price compareAtPrice}}
      metafields(first:60){nodes{namespace key type value}}
    } }'''
    p = graphql(q, {"h": PRODUCT_HANDLE})["data"]["productByHandle"]
    mf = {f"{m['namespace']}.{m['key']}": m['value'] for m in p['metafields']['nodes']}
    # resolve descricao_longa + antes_e_depois metaobjects
    def mo(gid):
        d = graphql('query($id:ID!){node(id:$id){... on Metaobject{fields{key value}}}}', {"id": gid})
        return {f['key']: f['value'] for f in d['data']['node']['fields']}
    desc = mo(mf['custom.descricao_longa_com_abas'])
    ad = mo(mf['custom.antes_e_depois'])
    v = p['variants']['nodes'][0]
    return {
        "title": p['title'],
        "handle": p['handle'],
        "variant_id": v['id'].split('/')[-1],
        "price": v['price'],
        "img": (p.get('featuredMedia') or {}).get('preview', {}).get('image', {}).get('url', ''),
        "url": p.get('onlineStoreUrl') or f'{STORE}/products/{p["handle"]}',
        "beneficios": [mf.get('custom.beneficio_em_destaque_1', ''),
                       mf.get('custom.beneficio_em_destaque_2', ''),
                       mf.get('custom.beneficio_em_destaque_3', '')],
        "dosagem": mf.get('custom.dosagem', ''),
        # ipsis-literis PDP content
        "tab_como_usar": rich_to_html(desc.get('passo_a_passo')),
        "tab_resultados": rich_to_html(desc.get('resultado')),
        "tab_saiba_mais": desc.get('o_que_e', ''),
        "ad_titulo": ad.get('t_tulo', ''),
        "ad_resultado": rich_to_html(ad.get('resultados')),
    }


PROD = fetch()
VID = PROD["variant_id"]
PRICE = f'R$ {float(PROD["price"]):.2f}'.replace('.', ',')
CART = f'/cart/{VID}:1'
CTA = "Quero meu liso intacto"
REASSURE = ('<div class="gepl-reassure"><span><b>6x</b> sem juros</span>'
            '<span><b>frete grátis</b> acima de R$299</span>'
            '<span><b>troca grátis</b> em até 7 dias</span></div>')

# ---- IPSIS-LITERIS benefit chips (from product) ----
BENE_CHIPS = ''.join(f'<li>{b}</li>' for b in PROD['beneficios'] if b)

# ---- IPSIS-LITERIS tabs (saiba mais wraps plain text in <p> per PDP convention) ----
SAIBA = ''.join(f'<p>{ln.strip()}</p>' for ln in PROD['tab_saiba_mais'].split('\n') if ln.strip())

STYLE = '''<style>
.gepl{--ge-red:#DF372F;--ge-red-dark:#c12d26;--ink:#161616;--muted:#6b6b6b;--line:#ececec;--soft:#fbe9e8;color:var(--ink);max-width:720px;margin:0 auto;font-family:'Helvetica Neue',Arial,sans-serif}
.gepl *{box-sizing:border-box}
.gepl-sec{padding:34px 20px}
.gepl-hero{padding:0 0 8px}
.gepl-hero-media{position:relative;width:100%;aspect-ratio:4/5;background:linear-gradient(135deg,#eef1f4,#cdd6de);display:flex;align-items:center;justify-content:center;text-align:center;color:#5a6672;font-size:13px;font-weight:600;letter-spacing:.02em}
.gepl-hero-media span{opacity:.85;padding:12px 18px}
.gepl-pad{padding:22px 20px 6px}
.gepl-h1{font-size:clamp(27px,6.2vw,40px);font-weight:800;letter-spacing:-.02em;line-height:1.06;margin:0 0 12px}
.gepl-sub{font-size:clamp(15px,4vw,18px);color:var(--muted);line-height:1.45;margin:0 0 18px}
.gepl-cta{display:flex;align-items:center;justify-content:center;gap:8px;background:var(--ge-red);color:#fff !important;font-size:16px;font-weight:800;padding:15px 20px;border-radius:12px;text-decoration:none;width:100%;transition:background .15s}
.gepl-cta:hover{background:var(--ge-red-dark)}
.gepl-reassure{display:flex;flex-wrap:wrap;gap:6px 14px;justify-content:center;margin:12px 0 6px;font-size:12.5px;color:var(--muted)}
.gepl-reassure b{color:var(--ink);font-weight:700}
.gepl-price{text-align:center;font-size:15px;font-weight:700;margin:14px 0 0}
.gepl-chips{list-style:none;padding:0;margin:16px 0 0;display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.gepl-chips li{font-size:12.5px;font-weight:700;background:var(--soft);color:var(--ge-red-dark);padding:7px 12px;border-radius:40px}
.gepl-eyebrow{font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--ge-red);margin:0 0 8px}
.gepl-h2{font-size:clamp(21px,4.8vw,28px);font-weight:800;letter-spacing:-.01em;line-height:1.15;margin:0 0 12px}
.gepl-p{font-size:15px;line-height:1.55;color:#2b2b2b;margin:0 0 12px}
.gepl-micro{font-size:12.5px;color:var(--muted);margin:4px 0 0}
.gepl-bene{list-style:none;padding:0;margin:16px 0 0;display:flex;flex-direction:column;gap:10px}
.gepl-bene li{display:flex;gap:10px;align-items:flex-start;font-size:15px;font-weight:600}
.gepl-bene li::before{content:"";flex:none;width:20px;height:20px;border-radius:50%;background:var(--soft);background-image:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><path fill=%22%23DF372F%22 d=%22M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z%22/></svg>');background-repeat:no-repeat;background-position:center;background-size:14px;margin-top:1px}
.gepl-soft{background:var(--soft)}
.gepl-cols{display:flex;flex-direction:column;gap:14px;margin-top:16px}
.gepl-col{border:1px solid var(--line);border-radius:14px;padding:16px}
.gepl-col h3{font-size:15px;font-weight:800;margin:0 0 6px;color:var(--ge-red-dark)}
.gepl-col p{font-size:14px;line-height:1.5;color:#2b2b2b;margin:0}
.gepl-steps{counter-reset:s;list-style:none;padding:0;margin:16px 0 0;display:flex;flex-direction:column;gap:14px}
.gepl-steps li{counter-increment:s;position:relative;padding-left:44px;font-size:15px;line-height:1.4}
.gepl-steps li::before{content:counter(s);position:absolute;left:0;top:-2px;width:30px;height:30px;border-radius:50%;background:var(--ge-red);color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center;font-size:15px}
.gepl-tabres{list-style:none;padding:0;margin:16px 0 0;display:flex;flex-direction:column;gap:10px}
.gepl-tabres li{display:flex;gap:10px;align-items:flex-start;font-size:15px;line-height:1.4}
.gepl-tabres li::before{content:"\\2605";color:var(--ge-red);flex:none}
.gepl-proof-media{width:100%;aspect-ratio:1/1;background:linear-gradient(135deg,#eef1f4,#d4dde4);border-radius:14px;display:flex;align-items:center;justify-content:center;text-align:center;color:#5a6672;font-size:12.5px;font-weight:600;margin-top:16px;padding:14px}
.gepl-prod{width:100%;border-radius:14px;display:block;margin:16px auto 0;max-width:360px}
details.gepl-faq{border-bottom:1px solid var(--line);padding:14px 0}
details.gepl-faq summary{font-size:15px;font-weight:700;cursor:pointer;list-style:none;display:flex;justify-content:space-between;gap:12px}
details.gepl-faq summary::-webkit-details-marker{display:none}
details.gepl-faq summary::after{content:"+";color:var(--ge-red);font-weight:800}
details.gepl-faq[open] summary::after{content:"\\2013"}
details.gepl-faq p{font-size:14px;line-height:1.5;color:var(--muted);margin:10px 0 0}
.gepl-close{text-align:center}
.gepl-tag{font-size:15px;font-style:italic;color:var(--ge-red);margin:16px 0 0;font-weight:600}
.gepl-sticky{position:fixed;left:0;right:0;bottom:0;z-index:50;background:#fff;border-top:1px solid var(--line);box-shadow:0 -4px 18px rgba(0,0,0,.08);padding:10px 14px;display:flex;align-items:center;gap:12px}
.gepl-sticky .p{font-size:14px;font-weight:800;white-space:nowrap}
.gepl-sticky a{flex:1;background:var(--ge-red);color:#fff !important;text-decoration:none;font-weight:800;font-size:15px;padding:12px;border-radius:10px;text-align:center}
.gepl-spacer{height:76px}
.gepl-tabsblock{margin-top:16px}
.gepl-tabsblock h4{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:18px 0 6px}
@media(min-width:721px){.gepl-sticky{display:none}.gepl-spacer{display:none}.gepl-hero-media{aspect-ratio:16/9}}
</style>'''

BODY = STYLE + f'''<div class="gepl">

<section class="gepl-hero">
  <div class="gepl-hero-media"><span>[ HERO: banner de campanha (escova/liso + umidade) . asset Canva em produção ]</span></div>
  <div class="gepl-pad">
    <h1 class="gepl-h1">Seu liso intacto, mesmo no dia mais úmido.</h1>
    <p class="gepl-sub">O primer que prolonga a escova, blinda contra a umidade e protege do calor até 230°C. Você alisa uma vez, e o frizz não volta no meio do dia.</p>
    <a class="gepl-cta" href="{CART}">{CTA}</a>
    {REASSURE}
    <p class="gepl-price">{PRICE}</p>
    <ul class="gepl-chips">{BENE_CHIPS}</ul>
  </div>
</section>

<section class="gepl-sec">
  <p class="gepl-eyebrow">o problema</p>
  <h2 class="gepl-h2">Você alisa de manhã. No meio do dia, o frizz já voltou.</h2>
  <p class="gepl-p">O calor da escova e da chapinha abre a cutícula do fio. Aí o cabelo absorve a umidade do ar, incha e perde o alinhamento. O liso que era de salão vira frizz, e você acaba refazendo tudo no dia seguinte.</p>
</section>

<section class="gepl-sec gepl-soft">
  <p class="gepl-eyebrow">a solução</p>
  <h2 class="gepl-h2">Um primer que sela o liso antes de você secar.</h2>
  <p class="gepl-p">O Primer Liso Intacto realinha os fios e forma um filme que funciona como um guarda-chuva: a umidade do ambiente não entra, então o liso não desmancha. Ele protege do calor até 230°C e hidrata sem pesar. Você aplica no cabelo úmido, seca, e o resultado se mantém por até 24h, sem frizz e sem toque pesado.</p>
  <ul class="gepl-bene">
    <li>Prolonga a escova e o liso por até 24h</li>
    <li>Blinda contra a umidade, com efeito guarda-chuva</li>
    <li>Protege do calor até 230°C e hidrata sem pesar</li>
  </ul>
  <img class="gepl-prod" src="{PROD['img']}" alt="Primer Liso Intacto GE Beauty" loading="lazy">
  <p class="gepl-micro" style="text-align:center">{PROD['dosagem']} · para cabelos lisos e ondulados</p>
</section>

<section class="gepl-sec">
  <p class="gepl-eyebrow">por que funciona</p>
  <h2 class="gepl-h2">Feito com ativos que entregam.</h2>
  <div class="gepl-cols">
    <div class="gepl-col"><h3>Allinea™</h3><p>ativo vegetal que realinha os fios e sela a cutícula, criando o efeito guarda-chuva que segura o liso mesmo no dia úmido.</p></div>
    <div class="gepl-col"><h3>óleo de girassol</h3><p>rico em ômegas e vitamina E, nutre com leveza, ajuda a controlar o frizz e deixa o toque aveludado.</p></div>
    <div class="gepl-col"><h3>trehalose</h3><p>protege do calor e preserva a umidade interna do fio contra o secador e a chapinha.</p></div>
  </div>
</section>

<section class="gepl-sec gepl-soft">
  <p class="gepl-eyebrow">quem usa, aprova</p>
  <h2 class="gepl-h2">{PROD['ad_titulo']}</h2>
  <div class="gepl-tabsblock">{PROD['ad_resultado']}</div>
  <div class="gepl-proof-media"><span>[ antes / depois + comentários reais (Loox / UGC) . asset em produção ]</span></div>
</section>

<section class="gepl-sec">
  <p class="gepl-eyebrow">como usar</p>
  <h2 class="gepl-h2">Liso intacto em 3 passos.</h2>
  {PROD['tab_como_usar'].replace('<ol>', '<ol class="gepl-steps">')}
  <div class="gepl-tabsblock">
    <h4>o que você vê depois</h4>
    {PROD['tab_resultados'].replace('<ul>', '<ul class="gepl-tabres">')}
  </div>
</section>

<section class="gepl-sec gepl-soft">
  <p class="gepl-eyebrow">ainda em dúvida?</p>
  <h2 class="gepl-h2">Perguntas rápidas.</h2>
  <details class="gepl-faq"><summary>Serve para o meu cabelo?</summary><p>Sim. De lisos naturais a ondulados e cacheados que gostam de escovar ou pranchar e querem que o resultado dure mais.</p></details>
  <details class="gepl-faq"><summary>Protege mesmo do calor?</summary><p>Sim. Protege até 230°C, então você usa secador e chapinha sem ressecar, mantendo os fios hidratados no processo.</p></details>
  <details class="gepl-faq"><summary>Segura o liso no dia úmido?</summary><p>Sim. Ele cria uma blindagem que mantém o cabelo alinhado por até 24h, mesmo quando o ar está úmido.</p></details>
  <details class="gepl-faq"><summary>Preciso escovar ou pranchar para usar?</summary><p>Não. O primer também controla o frizz e dá brilho quando você deixa o cabelo secar ao natural.</p></details>
</section>

<section class="gepl-sec gepl-close">
  <h2 class="gepl-h2">Seu liso começa hoje, e continua amanhã.</h2>
  <p class="gepl-p" style="text-align:center">O mesmo resultado de salão, agora na sua rotina.</p>
  <a class="gepl-cta" href="{CART}" style="max-width:420px;margin:0 auto">{CTA}</a>
  {REASSURE}
  <p class="gepl-tag">no seu tempo, do seu jeito.</p>
</section>

</div>
<div class="gepl-spacer"></div>
<div class="gepl-sticky"><span class="p">{PRICE}</span><a href="{CART}">{CTA}</a></div>'''

print(f'product: {PROD["title"]} | variant {VID} | {PRICE} | img {"yes" if PROD["img"] else "MISSING"}')
print(f'benefit chips: {PROD["beneficios"]}')
print(f'BODY: {len(BODY)} chars | CTA -> {CART}')

MOCK = Path(__file__).resolve().parents[3] / "inputs" / "mockups" / "gebeauty-primer-liso-lp-v1.html"
doc = ('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
       '<meta name="viewport" content="width=device-width,initial-scale=1">'
       '<title>GE Beauty . Primer Liso LP (mockup)</title>'
       '<style>body{margin:0;background:#fff}</style></head><body>' + BODY + '</body></html>')
MOCK.write_text(doc, encoding='utf-8')
print('MOCKUP:', MOCK)
