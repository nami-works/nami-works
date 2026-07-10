"""!!! FROZEN — DO NOT RUN `deploy` AGAIN !!!
Lucas has since customized the live template in the Shopify theme editor (added Loox
review blocks: loox_trust_badge + loox_card_carousel, reordered featured-product,
added an lpstyle custom_liquid card-styling block). Regenerating from this script would
OVERWRITE those. For further edits, PATCH the live template
(GET templates/page.primer-cachos-lp.json -> mutate -> PUT), never full-regenerate.

Rebuild the Primer Cachos LP page template from NATIVE theme sections (replaces the
custom primer-cachos-lp section, per Lucas). Composes: image-banner (hero) ->
featured-product (native buy) -> rich-text (problem) -> image-with-text (solution) ->
multicolumn-ingredients (ingredient-as-proof, real actives) -> section-before-after
(real title/results) -> apps (Loox reviews) -> multicolumn (how-to) -> faq -> rich-text (close).

Content is real: benefits from custom.beneficio_em_destaque_*, ingredients from the
descricao_longa metaobject, before/after title from custom.antes_e_depois. Block setting
ids + the Loox app-block handle were read from THIS theme (181379236160) / its product template.

Modes:
  local  (default) -> validate + write local copy of the template JSON. ZERO store writes.
  deploy           -> PUT templates/page.primer-cachos-lp.json, DELETE the retired custom section,
                      keep the existing DRAFT preview page. Then print verify + preview links.
"""
import json, re, urllib.request, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')

TOKEN = None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='):
        TOKEN = line.strip().split('=', 1)[1]
API = 'https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01'
ADMIN = 'https://admin.shopify.com/store/ge-beauty-cosmeticos'
THEME = 181379236160
PRODUCT_HANDLE = 'primer-cachos-definidos'
CART = '/cart/50023998685504:1'
LOOX_BLOCK = 'shopify://apps/loox-reviews/blocks/loox-dynamic-section/5c3b337f-fd14-4df5-b1d6-80ec13e6e28e'
MODE = sys.argv[1] if len(sys.argv) > 1 else 'local'


def call(method, path, data=None):
    r = urllib.request.Request(f'{API}{path}',
        data=(json.dumps(data).encode() if data is not None else None), method=method,
        headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    with urllib.request.urlopen(r) as resp:
        b = resp.read().decode()
        return resp.status, (json.loads(b) if b.strip() else {})


TEMPLATE = {
    "sections": {
        "hero": {
            "type": "slideshow",
            "blocks": {
                "s1": {"type": "slide", "settings": {
                    "image": "shopify://shop_images/primer-cachos-lp-hero-desktop.png",
                    "image_mb": "shopify://shop_images/primer-cachos-lp-hero-mobile.png",
                    # copy is baked into the banner image now (headline + subhead), so the slide
                    # carries only the CTA button -> no duplicate text overlay
                    "heading": "",
                    "subheading": "",
                    "button_label": "comprar agora",
                    "link": CART,
                    "show_text_box": True,
                }},
            },
            "block_order": ["s1"],
            "settings": {"slide_height": "adapt_image", "border_radius_top_left": 20, "border_radius_top_right": 20, "border_radius_bottom_right": 20, "border_radius_bottom_left": 20},
        },
        "buy": {
            "type": "featured-product",
            "blocks": {
                "title": {"type": "title", "settings": {}},
                "price": {"type": "price", "settings": {}},
                "benefits": {"type": "icon-with-text", "settings": {
                    "layout": "vertical",
                    "image_1": "shopify://shop_images/icon-150-cachos-definidos.png",
                    "heading_1": "definição leve e natural",
                    "image_2": "shopify://shop_images/icon-150-protecao-termica.png",
                    "heading_2": "controla o frizz e blinda por até 24h",
                    "image_3": "shopify://shop_images/icon-150-hidratacao.png",
                    "heading_3": "brilho e hidratação sem rigidez"}},
                "variant": {"type": "variant_picker", "settings": {"picker_type": "button"}},
                "buy": {"type": "buy_buttons", "settings": {"show_dynamic_checkout": True}},
                "reviews": {"type": LOOX_BLOCK, "settings": {}},
            },
            "block_order": ["title", "price", "benefits", "variant", "buy", "reviews"],
            "settings": {"product": PRODUCT_HANDLE, "media_size": "large", "media_position": "left"},
        },
        "problem": {
            "type": "image-with-text",
            "blocks": {
                "h": {"type": "heading", "settings": {"heading": "Você define os cachos de manhã. Até o meio do dia, o frizz volta.", "heading_size": "h2"}},
                "t": {"type": "text", "settings": {"text": "<p>O cabelo cacheado pede definição que aguente o dia inteiro. Só que o calor da escova e do babyliss abre a fibra, e o resultado que era de salão vira frizz e volume sem forma.</p>"}},
            },
            "block_order": ["h", "t"],
            "settings": {"image": "shopify://shop_images/Antes.jpg", "layout": "image_first", "height": "medium"},
        },
        "solution": {
            "type": "image-with-text",
            "blocks": {
                "h": {"type": "heading", "settings": {"heading": "Um primer que prepara o cacho antes de tudo.", "heading_size": "h2"}},
                "t": {"type": "text", "settings": {"text": "<p>O Primer Cachos Definidos age na base: define o desenho do cacho, protege a fibra do calor até 230°C e hidrata sem pesar. A definição se mantém por até 24h, sem frizz e sem aquela sensação de cabelo duro.</p>"}},
            },
            "block_order": ["h", "t"],
            "settings": {"layout": "text_first", "height": "medium"},
        },
        "ingredients": {
            "type": "multicolumn-ingredients",
            "blocks": {
                "c1": {"type": "column", "settings": {"title": "Wavemax (chia e linhaça)", "text": "<p>tecnologia vegetal que forma uma película bioadesiva, define o desenho do cacho e blinda contra a umidade.</p>"}},
                "c2": {"type": "column", "settings": {"title": "óleos de girassol, milho e gergelim", "text": "<p>nutrem a fibra e trazem brilho, sem pesar no cacho.</p>"}},
                "c3": {"type": "column", "settings": {"title": "óleo de macadâmia", "text": "<p>hidrata e sela a fibra, mantendo o cacho macio e com movimento.</p>"}},
            },
            "block_order": ["c1", "c2", "c3"],
            "settings": {"title": "feito com ativos que entregam", "columns_desktop": 3, "columns_mobile": "1"},
        },
        "before_after": {
            "type": "section-before-after",
            "blocks": {
                "r": {"type": "result", "settings": {"before_image": "shopify://shop_images/Antes.jpg", "after_image": "shopify://shop_images/Depois.jpg", "title": "cachos definidos, protegidos e livres de frizz", "description": "<p>definição prolongada, brilho e controle de frizz por até 24h.</p>"}},
            },
            "block_order": ["r"],
            "settings": {"title": "o antes e depois é real, e dura"},
        },
        "howto": {
            "type": "multicolumn",
            "blocks": {
                "s1": {"type": "column", "settings": {"title": "1. aplique", "text": "<p>no cabelo úmido, mecha a mecha, da raiz às pontas.</p>"}},
                "s2": {"type": "column", "settings": {"title": "2. modele", "text": "<p>distribua com as mãos ou pente, desenhando o cacho.</p>"}},
                "s3": {"type": "column", "settings": {"title": "3. finalize", "text": "<p>ao natural ou com difusor. Cacho definido por até 24h.</p>"}},
            },
            "block_order": ["s1", "s2", "s3"],
            "settings": {"title": "definição de salão em 3 passos", "columns_desktop": 3, "columns_mobile": "1", "border_radius_top_left": 20, "border_radius_top_right": 20, "border_radius_bottom_right": 20, "border_radius_bottom_left": 20},
        },
        "faq": {
            "type": "faq",
            "blocks": {
                "q1": {"type": "question", "settings": {"question": "Serve para o meu cabelo?", "answer": "<p>Sim. Foi feito para cachos e ondulados, de qualquer densidade. Ele define o desenho que o seu cabelo já tem.</p>"}},
                "q2": {"type": "question", "settings": {"question": "Dura mesmo o dia todo?", "answer": "<p>A definição se mantém por até 24h. Você aplica de manhã e segue o dia sem precisar refazer.</p>"}},
                "q3": {"type": "question", "settings": {"question": "Pesa ou resseca o cabelo?", "answer": "<p>Não. Ele hidrata sem pesar, então o cabelo fica definido, macio e com movimento.</p>"}},
            },
            "block_order": ["q1", "q2", "q3"],
            "settings": {"title": "perguntas rápidas"},
        },
        "close": {
            "type": "rich-text",
            "blocks": {
                "h": {"type": "heading", "settings": {"heading": "Seus cachos definidos começam hoje.", "heading_size": "h2"}},
                "t": {"type": "text", "settings": {"text": "<p>O mesmo resultado de salão, agora na sua rotina. No seu tempo, do seu jeito.</p>"}},
                "btn": {"type": "button", "settings": {"button_label": "Quero meus cachos definidos", "button_link": CART}},
            },
            "block_order": ["h", "t", "btn"],
            "settings": {"content_alignment": "center", "border_radius_top_left": 20, "border_radius_top_right": 20, "border_radius_bottom_right": 20, "border_radius_bottom_left": 20},
        },
    },
    "order": ["hero", "buy", "problem", "solution", "ingredients", "before_after", "howto", "faq", "close"],
}

# theme settings are typed: richtext REQUIRES top-level <p>/<ul>/<h*>; inline_richtext/text
# FORBID block tags. Same id ('text') differs across sections, so format by actual type.
_tcache = {}
def _types(stype):
    if stype not in _tcache:
        v = call('GET', f'/themes/{THEME}/assets.json?asset[key]=sections/{stype}.liquid')[1]['asset']['value']
        s = json.loads(re.search(r'\{%-?\s*schema\s*-?%\}(.*?)\{%-?\s*endschema', v, re.S).group(1))
        sec = {x['id']: x['type'] for x in s.get('settings', []) if x.get('id')}
        blk = {b.get('type'): {x['id']: x['type'] for x in b.get('settings', []) if x.get('id')} for b in s.get('blocks', [])}
        _tcache[stype] = (sec, blk)
    return _tcache[stype]

def _fmt(val, ttype):
    if not isinstance(val, str) or not val.strip():
        return val
    if ttype == 'richtext':
        return val if val.lstrip().startswith('<') else f'<p>{val}</p>'
    return val.replace('<p>', '').replace('</p>', '')  # inline_richtext / text / textarea

for sdef in TEMPLATE['sections'].values():
    stype = sdef['type']
    if stype.startswith('shopify://'):
        continue
    sec_t, blk_t = _types(stype)
    for sid in list(sdef.get('settings', {})):
        if sid in sec_t:
            sdef['settings'][sid] = _fmt(sdef['settings'][sid], sec_t[sid])
    for bdef in sdef.get('blocks', {}).values():
        if bdef['type'].startswith('shopify://'):
            continue
        bt = blk_t.get(bdef['type'], {})
        for sid in list(bdef.get('settings', {})):
            if sid in bt:
                bdef['settings'][sid] = _fmt(bdef['settings'][sid], bt[sid])

blob = json.dumps(TEMPLATE, ensure_ascii=False, indent=2)
json.loads(blob)  # validate
print(f'template OK: {len(TEMPLATE["order"])} native sections -> {", ".join(t["type"] for t in TEMPLATE["sections"].values())}')

BASE = Path(__file__).resolve().parent.parent / "theme" / "templates"
BASE.mkdir(parents=True, exist_ok=True)
(BASE / "page.primer-cachos-lp.native.json").write_text(blob, encoding='utf-8')
print('local copy:', BASE / "page.primer-cachos-lp.native.json")

if MODE == 'deploy':
    call('PUT', f'/themes/{THEME}/assets.json', {'asset': {'key': 'templates/page.primer-cachos-lp.json', 'value': json.dumps(TEMPLATE, ensure_ascii=False)}})
    print('native template PUSHED (overwrote custom-section template)')
    try:
        call('DELETE', f'/themes/{THEME}/assets.json?asset[key]=sections/primer-cachos-lp.liquid')
        print('retired custom section: sections/primer-cachos-lp.liquid DELETED')
    except Exception as e:
        print('custom section delete note:', e)
    print('theme-editor preview:', f'{ADMIN}/themes/{THEME}/editor?previewPath=%2Fpages%2Fprimer-cachos-lp-preview')
    print('admin page (Preview btn):', f'{ADMIN}/content/pages/164358750528')
else:
    print('LOCAL only. Pass "deploy" to push the native template + retire the custom section.')
