# -*- coding: utf-8 -*-
"""Clone the LP to Primer Liso Intacto (initiative phase 9).

Creates the Shopify page (template_suffix=landing-page) and fills its page metafields:
  - IPSIS-LITERIS (pulled RAW from the product, verbatim): tabs (como usar / resultados /
    saiba mais), before/after title + result, featured product.
  - KILLER COPY (new /content-director cold-traffic voice): problem, solution,
    ingredients-as-proof, faq, close. Authored as HTML -> converted to rich_text AST
    with the SAME converter used by _wire_lp_texts.py.
  - IMAGES: placeholders from the product's own real images (banners + before/after +
    solution media), clearly temporary until the Canva banner pair + before/after are made.

NOT set here (owned by the initiative session, defs don't exist yet): beneficio_{1,2,3}
(the buy-section chips) and cta_cart (hero + close cart link). Until those land, Liso's
benefit chips + hero/close CTA link inherit the Cachos values hardwired in the shared
template. Everything else renders as Liso.
"""
import json, urllib.request, urllib.error, sys
from pathlib import Path
from html.parser import HTMLParser
sys.stdout.reconfigure(encoding='utf-8')

TOKEN = None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='):
        TOKEN = line.strip().split('=', 1)[1]
API = 'https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01'
STORE = 'https://ge-beauty-cosmeticos.myshopify.com'
PRODUCT_HANDLE = 'primer-liso-intacto'
PAGE_HANDLE = 'primer-liso-intacto'
PAGE_TITLE = 'Primer Liso Intacto'
CACHOS_PAGE_ID = 164358750528


def gql(q, v=None):
    b = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    r = urllib.request.Request(f'{API}/graphql.json', data=b, headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    return json.loads(urllib.request.urlopen(r).read())


def rest(method, path, data=None):
    r = urllib.request.Request(f'{API}{path}', data=(json.dumps(data).encode() if data is not None else None),
                               method=method, headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    try:
        with urllib.request.urlopen(r) as resp:
            b = resp.read().decode()
            return resp.status, (json.loads(b) if b.strip() else {})
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode()[:400]}


# --- HTML -> rich_text AST (identical to _wire_lp_texts.py) ---
class Rich(HTMLParser):
    def __init__(self):
        super().__init__(); self.root = {"type": "root", "children": []}; self.stack = [self.root]; self.bold = 0
    def cur(self): return self.stack[-1]
    def handle_starttag(self, tag, attrs):
        if tag == 'p':
            n = {"type": "paragraph", "children": []}; self.cur()["children"].append(n); self.stack.append(n)
        elif tag in ('ul', 'ol'):
            n = {"type": "list", "listType": "ordered" if tag == 'ol' else "unordered", "children": []}; self.cur()["children"].append(n); self.stack.append(n)
        elif tag == 'li':
            n = {"type": "list-item", "children": []}; self.cur()["children"].append(n); self.stack.append(n)
        elif tag in ('strong', 'b'): self.bold += 1
        elif tag == 'br': self._text("\n")
    def handle_endtag(self, tag):
        if tag in ('p', 'ul', 'ol', 'li') and len(self.stack) > 1: self.stack.pop()
        elif tag in ('strong', 'b'): self.bold = max(0, self.bold - 1)
    def _text(self, data):
        node = {"type": "text", "value": data}
        if self.bold: node["bold"] = True
        cur = self.cur()
        if cur["type"] in ("root", "list"):
            p = {"type": "paragraph", "children": [node]}; cur["children"].append(p)
        else: cur["children"].append(node)
    def handle_data(self, data):
        if data.strip(): self._text(data)


def ast(html):
    p = Rich(); p.feed(html); return json.dumps(p.root, ensure_ascii=False)


# --- fetch product: ids, featured media, benefit images, ipsis-literis metaobjects ---
PQ = '''query($h:String!){ productByHandle(handle:$h){
  id
  featuredMedia{... on MediaImage{id}}
  variants(first:1){nodes{id}}
  metafields(first:60){nodes{namespace key value}}
} }'''
p = gql(PQ, {"h": PRODUCT_HANDLE})["data"]["productByHandle"]
PROD_GID = p["id"]
VID = p["variants"]["nodes"][0]["id"].split("/")[-1]
FEAT_IMG = (p.get("featuredMedia") or {}).get("id")
mf = {f"{m['namespace']}.{m['key']}": m['value'] for m in p['metafields']['nodes']}


def mo_fields(gid):
    d = gql('query($id:ID!){node(id:$id){... on Metaobject{fields{key value}}}}', {"id": gid})
    return {f['key']: f['value'] for f in d['data']['node']['fields']}


desc = mo_fields(mf['custom.descricao_longa_com_abas'])
ad = mo_fields(mf['custom.antes_e_depois'])

IMG1 = mf.get('custom.imagem_beneficio_em_destaque_1')  # lifestyle
IMG2 = mf.get('custom.imagem_beneficio_em_destaque_2')  # lifestyle
IMG3 = mf.get('custom.imagem_beneficio_em_destaque_3')  # lifestyle

# --- upsert the page ---
st, lst = rest('GET', '/pages.json?limit=250&fields=id,handle')
existing = next((pg for pg in lst.get('pages', []) if pg['handle'] == PAGE_HANDLE), None)
# mirror the Cachos LP page's published state
_, cachos = rest('GET', f'/pages/{CACHOS_PAGE_ID}.json?fields=published_at')
published = cachos.get('page', {}).get('published_at') is not None
body = {'page': {'title': PAGE_TITLE, 'handle': PAGE_HANDLE, 'template_suffix': 'landing-page',
                 'body_html': '', 'published': published}}
if existing:
    body['page']['id'] = existing['id']
    st, r = rest('PUT', f"/pages/{existing['id']}.json", body)
    action = 'UPDATED'
else:
    st, r = rest('POST', '/pages.json', body)
    action = 'CREATED'
PAGE_ID = r['page']['id']
PAGE_GID = f"gid://shopify/Page/{PAGE_ID}"
print(f'page {action}: {PAGE_ID} | handle {r["page"]["handle"]} | suffix {r["page"].get("template_suffix")} | published={published}')

# --- metafield values ---
single = {  # single_line_text_field (inline_richtext / text; keep inline <strong>)
    'antes_depois_titulo': ad.get('t_tulo', ''),
    'problema_titulo': '<strong>você alisa de manhã, mas no meio do dia o frizz já voltou</strong>',
    'solucao_titulo': '<strong>um primer que sela o liso antes de você secar</strong>',
    'ingredientes_titulo': 'feito com ativos que entregam',
    'ingrediente_1_titulo': 'Allinea™',
    'ingrediente_2_titulo': 'óleo de girassol',
    'ingrediente_3_titulo': 'trehalose',
    'faq_titulo': 'dúvidas frequentes',
    'faq_1_pergunta': 'Serve para o meu cabelo?',
    'faq_2_pergunta': 'Protege mesmo do calor?',
    'faq_3_pergunta': 'Segura o liso no dia úmido?',
    'fechamento_titulo': 'Seu liso começa hoje, e continua amanhã.',
    'fechamento_botao': 'Quero meu liso intacto',
}
rich_html = {  # rich_text_field (authored HTML -> AST)
    'problema_texto': '<p>o calor da escova e da chapinha abre a cutícula do fio.</p><p>aí o cabelo absorve a umidade do ar, incha e perde o alinhamento. o liso que era de salão vira frizz, e você refaz tudo no dia seguinte.</p>',
    'solucao_texto': '<p>o <strong>primer liso intacto</strong> realinha os fios e forma um filme que funciona como um guarda-chuva</p><ul><li>a umidade do ambiente não entra, então o liso não desmancha</li><li>protege do calor <strong>até 230°C</strong></li><li>hidrata sem pesar</li></ul><p>o resultado se mantém por <strong>até 24h</strong>, sem frizz e sem toque pesado</p>',
    'ingrediente_1_texto': '<p>ativo vegetal que realinha os fios e sela a cutícula, criando o efeito guarda-chuva que segura o liso mesmo no dia úmido.</p>',
    'ingrediente_2_texto': '<p>rico em ômegas e vitamina E, nutre com leveza, ajuda a controlar o frizz e deixa o toque aveludado.</p>',
    'ingrediente_3_texto': '<p>protege do calor e preserva a umidade interna do fio contra o secador e a chapinha.</p>',
    'faq_1_resposta': '<p>Sim. De lisos naturais a ondulados e cacheados que gostam de escovar ou pranchar e querem que o resultado dure mais.</p>',
    'faq_2_resposta': '<p>Sim. Protege até 230°C, então você usa secador e chapinha sem ressecar, mantendo os fios hidratados no processo.</p>',
    'faq_3_resposta': '<p>Sim. Ele cria uma blindagem que mantém o cabelo alinhado por até 24h, mesmo quando o ar está úmido.</p>',
    'fechamento_texto': '<p>O mesmo resultado de salão, agora na sua rotina. No seu tempo, do seu jeito.</p>',
}
rich_raw = {  # rich_text_field IPSIS-LITERIS (copy the product's AST verbatim)
    'tab_como_usar': desc.get('passo_a_passo', ''),
    'tab_resultados': desc.get('resultado', ''),
    'antes_depois_resultado': ad.get('resultados', ''),
}
multi = {'tab_saiba_mais': desc.get('o_que_e', '')}
files = {  # file_reference PLACEHOLDERS (product's own images, temporary)
    'banner_desktop': IMG1, 'banner_mobile': IMG1,
    'midia': FEAT_IMG or IMG1, 'antes_foto': IMG2, 'depois_foto': IMG3,
}
refs = {'produto_em_destaque_1': PROD_GID}

mfs = []
for k, v in single.items():
    mfs.append({"ownerId": PAGE_GID, "namespace": "custom", "key": k, "type": "single_line_text_field", "value": v})
for k, v in rich_html.items():
    mfs.append({"ownerId": PAGE_GID, "namespace": "custom", "key": k, "type": "rich_text_field", "value": ast(v)})
for k, v in rich_raw.items():
    if v:
        mfs.append({"ownerId": PAGE_GID, "namespace": "custom", "key": k, "type": "rich_text_field", "value": v})
for k, v in multi.items():
    mfs.append({"ownerId": PAGE_GID, "namespace": "custom", "key": k, "type": "multi_line_text_field", "value": v})
for k, v in files.items():
    if v:
        mfs.append({"ownerId": PAGE_GID, "namespace": "custom", "key": k, "type": "file_reference", "value": v})
for k, v in refs.items():
    mfs.append({"ownerId": PAGE_GID, "namespace": "custom", "key": k, "type": "product_reference", "value": v})

# metafieldsSet max 25 per call
SET = 'mutation($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){metafields{key} userErrors{field message}}}'
done = 0
for i in range(0, len(mfs), 20):
    batch = mfs[i:i + 20]
    r = gql(SET, {"m": batch})
    res = r['data']['metafieldsSet']
    if res['userErrors']:
        print('  ERRORS:', res['userErrors'])
    done += len(res['metafields'])
print(f'metafields set: {done}/{len(mfs)}')
print(f'variant (liso): {VID}  | featured media: {FEAT_IMG}')
print(f'URL: {STORE}/pages/{PAGE_HANDLE}')
