"""Author + deploy the Primer Cachos LP as a customizer-editable THEME SECTION
(+ page template), not a body_html blob. Mirrors the store's Themes Asset API pattern.

Artifacts:
  sections/primer-cachos-lp.liquid   -> namespaced section with {% schema %} (editable in customizer)
  templates/page.primer-cachos-lp.json -> page template instance (approved copy + blocks + product)

Modes:
  local   (default) -> write both files under gebeauty/theme/ + validate schema JSON. ZERO store writes.
  deploy            -> PUT both files to a theme (default published 181379236160, or arg2 theme id),
                       then create/assign an UNLISTED draft-ish page (template_suffix) for preview.

New namespaced files are inert until a page uses the template, so the live store is visually unchanged.
"""
import json, re, urllib.request, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')

TOKEN = None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='):
        TOKEN = line.strip().split('=', 1)[1]
API = 'https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01'
STORE = 'https://ge-beauty-cosmeticos.myshopify.com'
PUBLISHED_THEME = 181379236160
PRODUCT_HANDLE = 'primer-cachos-definidos'
TEMPLATE_SUFFIX = 'primer-cachos-lp'
PREVIEW_HANDLE = 'primer-cachos-lp-preview'
PREVIEW_TITLE = 'Primer Cachos (LP preview)'
MODE = sys.argv[1] if len(sys.argv) > 1 else 'local'
THEME_ID = int(sys.argv[2]) if len(sys.argv) > 2 else PUBLISHED_THEME


def call(method, path, data=None):
    r = urllib.request.Request(f'{API}{path}',
        data=(json.dumps(data).encode() if data is not None else None), method=method,
        headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    with urllib.request.urlopen(r) as resp:
        b = resp.read().decode()
        return resp.status, (json.loads(b) if b.strip() else {})


SECTION = r'''{%- style -%}
.gepc{--ge-red:#DF3630;--ge-red-dark:#c12d26;--ink:#161616;--muted:#6b6b6b;--line:#ececec;--soft:#fbe9e8;color:var(--ink);max-width:720px;margin:0 auto;font-family:'Helvetica Neue',Arial,sans-serif}
.gepc *{box-sizing:border-box}
.gepc-sec{padding:34px 20px}
.gepc-hero-media{position:relative;width:100%;aspect-ratio:4/5;background:linear-gradient(135deg,#f4d9d7,#e9b6b2);display:flex;align-items:center;justify-content:center;text-align:center;color:var(--ge-red-dark);font-size:13px;font-weight:600;object-fit:cover}
.gepc-hero-media span{opacity:.8;padding:12px 18px}
.gepc-pad{padding:22px 20px 6px}
.gepc-h1{font-size:clamp(27px,6.2vw,40px);font-weight:800;letter-spacing:-.02em;line-height:1.06;margin:0 0 12px}
.gepc-sub{font-size:clamp(15px,4vw,18px);color:var(--muted);line-height:1.45;margin:0 0 18px}
.gepc-cta{display:flex;align-items:center;justify-content:center;gap:8px;background:var(--ge-red);color:#fff;font-size:16px;font-weight:800;padding:15px 20px;border-radius:12px;text-decoration:none;width:100%;border:0;cursor:pointer;transition:background .15s}
.gepc-cta:hover{background:var(--ge-red-dark)}
.gepc-ctaform{margin:0}
.gepc-reassure{display:flex;flex-wrap:wrap;gap:6px 14px;justify-content:center;margin:12px 0 6px;font-size:12.5px;color:var(--muted)}
.gepc-reassure b{color:var(--ink);font-weight:700}
.gepc-price{text-align:center;font-size:15px;font-weight:700;margin:14px 0 0}
.gepc-eyebrow{font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--ge-red);margin:0 0 8px}
.gepc-h2{font-size:clamp(21px,4.8vw,28px);font-weight:800;letter-spacing:-.01em;line-height:1.15;margin:0 0 12px}
.gepc-p{font-size:15px;line-height:1.55;color:#2b2b2b;margin:0 0 12px}
.gepc-micro{font-size:12.5px;color:var(--muted);margin:4px 0 0;text-align:center}
.gepc-bene{list-style:none;padding:0;margin:16px 0 0;display:flex;flex-direction:column;gap:10px}
.gepc-bene li{display:flex;gap:10px;align-items:flex-start;font-size:15px;font-weight:600}
.gepc-bene li::before{content:"";flex:none;width:20px;height:20px;border-radius:50%;background:var(--soft);background-image:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><path fill=%22%23DF3630%22 d=%22M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z%22/></svg>');background-repeat:no-repeat;background-position:center;background-size:14px;margin-top:1px}
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
.gepc-sticky .gepc-cta{font-size:15px;padding:12px}
.gepc-spacer{height:76px}
@media(min-width:721px){.gepc-sticky{display:none}.gepc-spacer{display:none}.gepc-hero-media{aspect-ratio:16/9}}
{%- endstyle -%}

{%- assign p = section.settings.product -%}
{%- assign vid = p.selected_or_first_available_variant.id -%}
{%- capture cta -%}
{%- if vid -%}
<form action="{{ routes.cart_add_url }}" method="post" enctype="multipart/form-data" class="gepc-ctaform">
  <input type="hidden" name="id" value="{{ vid }}">
  <button type="submit" class="gepc-cta">{{ section.settings.cta_label }}</button>
</form>
{%- else -%}
<a class="gepc-cta" href="{{ section.settings.cta_link }}">{{ section.settings.cta_label }}</a>
{%- endif -%}
{%- endcapture -%}
{%- capture reassure -%}
<div class="gepc-reassure"><span>{{ section.settings.reassure_a }}</span><span>{{ section.settings.reassure_b }}</span><span>{{ section.settings.reassure_c }}</span></div>
{%- endcapture -%}
{%- if p and p.price -%}{%- assign pricehtml = p.price | money -%}{%- else -%}{%- assign pricehtml = section.settings.price_text -%}{%- endif -%}

<div class="gepc">
  <section class="gepc-hero">
    {%- if section.settings.hero_image -%}
      <img class="gepc-hero-media" src="{{ section.settings.hero_image | image_url: width: 1200 }}" alt="{{ section.settings.hero_h1 | escape }}" loading="eager">
    {%- else -%}
      <div class="gepc-hero-media"><span>{{ section.settings.hero_placeholder }}</span></div>
    {%- endif -%}
    <div class="gepc-pad">
      <h1 class="gepc-h1">{{ section.settings.hero_h1 }}</h1>
      <p class="gepc-sub">{{ section.settings.hero_sub }}</p>
      {{ cta }}
      {{ reassure }}
      {%- if pricehtml != blank -%}<p class="gepc-price">{{ pricehtml }}</p>{%- endif -%}
    </div>
  </section>

  <section class="gepc-sec">
    <p class="gepc-eyebrow">{{ section.settings.problem_eyebrow }}</p>
    <h2 class="gepc-h2">{{ section.settings.problem_h2 }}</h2>
    <div class="gepc-p">{{ section.settings.problem_body }}</div>
  </section>

  <section class="gepc-sec gepc-soft">
    <p class="gepc-eyebrow">{{ section.settings.solution_eyebrow }}</p>
    <h2 class="gepc-h2">{{ section.settings.solution_h2 }}</h2>
    <div class="gepc-p">{{ section.settings.solution_body }}</div>
    {%- if section.blocks.size > 0 -%}
    <ul class="gepc-bene">
      {%- for block in section.blocks -%}{%- if block.type == 'benefit' -%}<li {{ block.shopify_attributes }}>{{ block.settings.text }}</li>{%- endif -%}{%- endfor -%}
    </ul>
    {%- endif -%}
    {%- if section.settings.solution_image -%}
      <img class="gepc-prod" src="{{ section.settings.solution_image | image_url: width: 720 }}" alt="{{ p.title | default: 'Primer Cachos' | escape }}" loading="lazy">
    {%- elsif p.featured_image -%}
      <img class="gepc-prod" src="{{ p.featured_image | image_url: width: 720 }}" alt="{{ p.title | escape }}" loading="lazy">
    {%- endif -%}
    {%- if section.settings.solution_micro != blank -%}<p class="gepc-micro">{{ section.settings.solution_micro }}</p>{%- endif -%}
  </section>

  <section class="gepc-sec">
    <p class="gepc-eyebrow">{{ section.settings.proof_eyebrow }}</p>
    <h2 class="gepc-h2">{{ section.settings.proof_h2 }}</h2>
    <div class="gepc-cards">
      {%- for block in section.blocks -%}{%- if block.type == 'review' -%}
      <div class="gepc-card" {{ block.shopify_attributes }}>
        <div class="gepc-card-top"><div class="gepc-av">{{ block.settings.handle | slice: 0 }}</div>
        <div><div class="gepc-user">@{{ block.settings.handle }}</div><div class="gepc-verified">avaliação verificada</div></div></div>
        <p class="gepc-ctext">{{ block.settings.text }}</p>
      </div>
      {%- endif -%}{%- endfor -%}
    </div>
    {%- if section.settings.proof_placeholder != blank -%}<div class="gepc-proof-media"><span>{{ section.settings.proof_placeholder }}</span></div>{%- endif -%}
  </section>

  <section class="gepc-sec gepc-soft">
    <p class="gepc-eyebrow">{{ section.settings.howto_eyebrow }}</p>
    <h2 class="gepc-h2">{{ section.settings.howto_h2 }}</h2>
    <ol class="gepc-steps">
      {%- for block in section.blocks -%}{%- if block.type == 'step' -%}<li {{ block.shopify_attributes }}>{{ block.settings.text }}</li>{%- endif -%}{%- endfor -%}
    </ol>
  </section>

  <section class="gepc-sec">
    <p class="gepc-eyebrow">{{ section.settings.faq_eyebrow }}</p>
    <h2 class="gepc-h2">{{ section.settings.faq_h2 }}</h2>
    {%- for block in section.blocks -%}{%- if block.type == 'faq' -%}
    <details class="gepc-faq" {{ block.shopify_attributes }}><summary>{{ block.settings.question }}</summary><p>{{ block.settings.answer }}</p></details>
    {%- endif -%}{%- endfor -%}
  </section>

  <section class="gepc-sec gepc-close">
    <h2 class="gepc-h2">{{ section.settings.close_h2 }}</h2>
    <div class="gepc-p" style="text-align:center">{{ section.settings.close_body }}</div>
    <div style="max-width:420px;margin:0 auto">{{ cta }}</div>
    {{ reassure }}
    {%- if section.settings.tagline != blank -%}<p class="gepc-tag">{{ section.settings.tagline }}</p>{%- endif -%}
  </section>
</div>
{%- if section.settings.show_sticky and vid -%}
<div class="gepc-spacer"></div>
<div class="gepc-sticky"><span class="p">{{ pricehtml }}</span>{{ cta }}</div>
{%- endif -%}

{% schema %}
{
  "name": "Primer Cachos LP",
  "tag": "section",
  "class": "gepc-section",
  "settings": [
    {"type":"product","id":"product","label":"Produto (CTA add-to-cart)"},
    {"type":"header","content":"Hero"},
    {"type":"image_picker","id":"hero_image","label":"Imagem do hero (transformação)","info":"Vazio = placeholder. Trocar pela transformação (Fernanda) quando o asset estiver pronto."},
    {"type":"text","id":"hero_placeholder","label":"Texto do placeholder do hero","default":"[ vídeo de transformação — asset em produção ]"},
    {"type":"text","id":"hero_h1","label":"Título (H1)","default":"Definição de salão no seu cabelo, todo dia em casa."},
    {"type":"textarea","id":"hero_sub","label":"Subtítulo","default":"Primer que define os cachos, protege do calor e hidrata sem pesar. O mesmo resultado que você viu, agora nas suas mãos."},
    {"type":"text","id":"cta_label","label":"Texto do botão","default":"Quero meus cachos definidos"},
    {"type":"url","id":"cta_link","label":"Link do botão (usado só se não houver produto)"},
    {"type":"text","id":"price_text","label":"Preço (fallback se não houver produto)","default":"R$ 149,00"},
    {"type":"text","id":"reassure_a","label":"Reassurance 1","default":"6x sem juros"},
    {"type":"text","id":"reassure_b","label":"Reassurance 2","default":"frete grátis acima de R$299"},
    {"type":"text","id":"reassure_c","label":"Reassurance 3","default":"troca grátis em até 7 dias"},
    {"type":"header","content":"Problema"},
    {"type":"text","id":"problem_eyebrow","label":"Eyebrow","default":"o problema"},
    {"type":"text","id":"problem_h2","label":"Título","default":"Você define os cachos de manhã. Até o meio do dia, o frizz volta."},
    {"type":"richtext","id":"problem_body","label":"Texto","default":"<p>O cabelo cacheado pede definição que aguente o dia inteiro. Só que o calor da escova e do babyliss abre a fibra, e o resultado que era de salão vira frizz e volume sem forma.</p>"},
    {"type":"header","content":"Solução"},
    {"type":"text","id":"solution_eyebrow","label":"Eyebrow","default":"a solução"},
    {"type":"text","id":"solution_h2","label":"Título","default":"Um primer que prepara o cacho antes de tudo."},
    {"type":"richtext","id":"solution_body","label":"Texto","default":"<p>O Primer Cachos Definidos age na base: define o desenho do cacho, protege a fibra do calor até 230°C e hidrata sem pesar. O cabelo fica com movimento e leveza, e a definição se mantém por até 24h. Sem frizz, sem aquela sensação de cabelo duro ou engessado.</p>"},
    {"type":"image_picker","id":"solution_image","label":"Imagem do produto","info":"Vazio = usa a imagem principal do produto."},
    {"type":"text","id":"solution_micro","label":"Microcopy","default":"250mL · para cabelos cacheados e ondulados"},
    {"type":"header","content":"Prova social"},
    {"type":"text","id":"proof_eyebrow","label":"Eyebrow","default":"quem usa, aprova"},
    {"type":"text","id":"proof_h2","label":"Título","default":"O antes e depois é real, e dura."},
    {"type":"text","id":"proof_placeholder","label":"Placeholder antes/depois","default":"[ antes / depois + UGC da creator · asset em produção ]"},
    {"type":"header","content":"Como usar"},
    {"type":"text","id":"howto_eyebrow","label":"Eyebrow","default":"como usar"},
    {"type":"text","id":"howto_h2","label":"Título","default":"Definição de salão em 3 passos."},
    {"type":"header","content":"FAQ"},
    {"type":"text","id":"faq_eyebrow","label":"Eyebrow","default":"ainda em dúvida?"},
    {"type":"text","id":"faq_h2","label":"Título","default":"Perguntas rápidas."},
    {"type":"header","content":"Fechamento"},
    {"type":"text","id":"close_h2","label":"Título","default":"Seus cachos definidos começam hoje."},
    {"type":"richtext","id":"close_body","label":"Texto","default":"<p>O mesmo resultado de salão, agora na sua rotina.</p>"},
    {"type":"text","id":"tagline","label":"Tagline","default":"no seu tempo, do seu jeito."},
    {"type":"checkbox","id":"show_sticky","label":"Barra fixa de compra (mobile)","default":true}
  ],
  "blocks": [
    {"type":"benefit","name":"Benefício","settings":[{"type":"text","id":"text","label":"Texto"}]},
    {"type":"review","name":"Avaliação","settings":[{"type":"text","id":"handle","label":"@ do cliente"},{"type":"textarea","id":"text","label":"Comentário"}]},
    {"type":"step","name":"Passo","settings":[{"type":"text","id":"text","label":"Texto"}]},
    {"type":"faq","name":"FAQ","settings":[{"type":"text","id":"question","label":"Pergunta"},{"type":"textarea","id":"answer","label":"Resposta"}]}
  ],
  "presets": [{"name":"Primer Cachos LP","blocks":[
    {"type":"benefit","settings":{"text":"Define o desenho do cacho por até 24h"}},
    {"type":"benefit","settings":{"text":"Protege a fibra do calor até 230°C"}},
    {"type":"benefit","settings":{"text":"Hidrata sem pesar, com movimento e leveza"}},
    {"type":"review","settings":{"handle":"priscilaossomatica","text":"esse primer é MOOOOOOOITO bom pra cabelo cacheado!!! Comprei antes de mudar de país e já tô no foco de comprar mais um assim que botar o pé no Brasil!"}},
    {"type":"review","settings":{"handle":"leilanyriosbarreto","text":"O melhor! Não deixa o cabelo com a textura pesada! Sem falar no cheiro!!!!"}},
    {"type":"review","settings":{"handle":"isadoracruz","text":"Viciada no meu primer da GE Beauty"}},
    {"type":"step","settings":{"text":"Aplique no cabelo úmido, mecha a mecha, da raiz às pontas."}},
    {"type":"step","settings":{"text":"Distribua com as mãos ou pente, modelando o desenho do cacho."}},
    {"type":"step","settings":{"text":"Finalize ao natural ou com difusor. Cacho definido por até 24h."}},
    {"type":"faq","settings":{"question":"Serve para o meu cabelo?","answer":"Sim. Foi feito para cachos e ondulados, de qualquer densidade. Ele define o desenho que o seu cabelo já tem, respeitando o seu tipo de cacho."}},
    {"type":"faq","settings":{"question":"Dura mesmo o dia todo?","answer":"A definição se mantém por até 24h. Você aplica de manhã e segue o dia sem precisar refazer."}},
    {"type":"faq","settings":{"question":"Pesa ou resseca o cabelo?","answer":"Não. Ele hidrata sem pesar, então o cabelo fica definido, macio e com movimento, nunca duro ou opaco."}}
  ]}]
}
{% endschema %}
'''

# template JSON: instance of the section with product + the preset blocks baked in
TEMPLATE = {
    "sections": {
        "main": {
            "type": "primer-cachos-lp",
            "settings": {"product": PRODUCT_HANDLE, "show_sticky": True},
            "blocks": {
                "b1": {"type": "benefit", "settings": {"text": "Define o desenho do cacho por até 24h"}},
                "b2": {"type": "benefit", "settings": {"text": "Protege a fibra do calor até 230°C"}},
                "b3": {"type": "benefit", "settings": {"text": "Hidrata sem pesar, com movimento e leveza"}},
                "r1": {"type": "review", "settings": {"handle": "priscilaossomatica", "text": "esse primer é MOOOOOOOITO bom pra cabelo cacheado!!! Comprei antes de mudar de país e já tô no foco de comprar mais um assim que botar o pé no Brasil!"}},
                "r2": {"type": "review", "settings": {"handle": "leilanyriosbarreto", "text": "O melhor! Não deixa o cabelo com a textura pesada! Sem falar no cheiro!!!!"}},
                "r3": {"type": "review", "settings": {"handle": "isadoracruz", "text": "Viciada no meu primer da GE Beauty"}},
                "s1": {"type": "step", "settings": {"text": "Aplique no cabelo úmido, mecha a mecha, da raiz às pontas."}},
                "s2": {"type": "step", "settings": {"text": "Distribua com as mãos ou pente, modelando o desenho do cacho."}},
                "s3": {"type": "step", "settings": {"text": "Finalize ao natural ou com difusor. Cacho definido por até 24h."}},
                "f1": {"type": "faq", "settings": {"question": "Serve para o meu cabelo?", "answer": "Sim. Foi feito para cachos e ondulados, de qualquer densidade. Ele define o desenho que o seu cabelo já tem, respeitando o seu tipo de cacho."}},
                "f2": {"type": "faq", "settings": {"question": "Dura mesmo o dia todo?", "answer": "A definição se mantém por até 24h. Você aplica de manhã e segue o dia sem precisar refazer."}},
                "f3": {"type": "faq", "settings": {"question": "Pesa ou resseca o cabelo?", "answer": "Não. Ele hidrata sem pesar, então o cabelo fica definido, macio e com movimento, nunca duro ou opaco."}},
            },
            "block_order": ["b1", "b2", "b3", "r1", "r2", "r3", "s1", "s2", "s3", "f1", "f2", "f3"],
        }
    },
    "order": ["main"],
}

# validate the {% schema %} JSON so we never ship a broken section
m = re.search(r'\{%\s*schema\s*%\}(.*?)\{%\s*endschema\s*%\}', SECTION, re.S)
schema_obj = json.loads(m.group(1))
print(f'schema OK: {len(schema_obj["settings"])} settings, {len(schema_obj["blocks"])} block types, {len(schema_obj["presets"][0]["blocks"])} preset blocks')

# always write local copies for review
BASE = Path(__file__).resolve().parent.parent / "theme"
(BASE / "sections").mkdir(parents=True, exist_ok=True)
(BASE / "templates").mkdir(parents=True, exist_ok=True)
(BASE / "sections" / "primer-cachos-lp.liquid").write_text(SECTION, encoding='utf-8')
(BASE / "templates" / "page.primer-cachos-lp.json").write_text(json.dumps(TEMPLATE, ensure_ascii=False, indent=2), encoding='utf-8')
print('local files written under', BASE)

if MODE == 'deploy':
    print(f'deploying to theme {THEME_ID} ...')
    call('PUT', f'/themes/{THEME_ID}/assets.json', {'asset': {'key': 'sections/primer-cachos-lp.liquid', 'value': SECTION}})
    call('PUT', f'/themes/{THEME_ID}/assets.json', {'asset': {'key': 'templates/page.primer-cachos-lp.json', 'value': json.dumps(TEMPLATE, ensure_ascii=False)}})
    print('  section + template pushed')
    _, lst = call('GET', '/pages.json?limit=250&fields=id,handle')
    ex = next((pg for pg in lst.get('pages', []) if pg['handle'] == PREVIEW_HANDLE), None)
    # DRAFT (published:false) -> not public; previewable via the theme editor only
    payload = {'title': PREVIEW_TITLE, 'handle': PREVIEW_HANDLE, 'template_suffix': TEMPLATE_SUFFIX, 'published': False}
    if ex:
        _, r = call('PUT', f"/pages/{ex['id']}.json", {'page': {**payload, 'id': ex['id']}})
        pid = ex['id']; print('  draft preview page UPDATED:', pid)
    else:
        _, r = call('POST', '/pages.json', {'page': payload})
        pid = r['page']['id']; print('  draft preview page CREATED:', pid)
    ADMIN = 'https://admin.shopify.com/store/ge-beauty-cosmeticos'
    print('  theme-editor preview:', f'{ADMIN}/themes/{THEME_ID}/editor?previewPath=%2Fpages%2F{PREVIEW_HANDLE}')
    print('  admin page (Preview btn):', f'{ADMIN}/content/pages/{pid}')
else:
    print('LOCAL only. Pass "deploy" to push files + create the unlisted preview page.')
