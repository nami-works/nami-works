# -*- coding: utf-8 -*-
"""Step 2: bind the LP section settings to the page metafields created in _wire_lp_texts.py.
Run AFTER the image-with-text styling agent finishes (fetches the current template so the
agent's styling changes are preserved). inline_richtext/text settings bind via .value;
richtext settings bind via | metafield_tag."""
import json, urllib.request, urllib.error
from pathlib import Path
TOKEN = None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='):
        TOKEN = line.strip().split('=', 1)[1]
API = 'https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01'
THEME = 181379236160


def call(m, p, d=None):
    r = urllib.request.Request(f'{API}{p}', data=(json.dumps(d).encode() if d is not None else None), method=m, headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    try:
        with urllib.request.urlopen(r) as x:
            return x.status, (json.loads(x.read().decode() or '{}'))
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:700]


def V(k):   # single_line / text setting binding
    return '{{ page.metafields.custom.' + k + '.value }}'


def T(k):   # richtext setting binding
    return '{{ page.metafields.custom.' + k + ' | metafield_tag }}'


_, a = call('GET', f'/themes/{THEME}/assets.json?asset[key]=templates/page.landing-page.json')
tpl = json.loads(a['asset']['value'])
S = tpl['sections']
prob, sol, ing, faq, close = S['problem'], S['solution'], S['ingredients'], S['faq'], S['close']

prob['blocks']['h']['settings']['heading'] = V('problema_titulo')
prob['blocks']['t']['settings']['text'] = T('problema_texto')
sol['blocks']['h']['settings']['heading'] = V('solucao_titulo')
sol['blocks']['t']['settings']['text'] = T('solucao_texto')
ing['settings']['title'] = V('ingredientes_titulo')
for c, n in (('c1', 1), ('c2', 2), ('c3', 3)):
    ing['blocks'][c]['settings']['title'] = V(f'ingrediente_{n}_titulo')
    ing['blocks'][c]['settings']['text'] = T(f'ingrediente_{n}_texto')
faq['settings']['title'] = V('faq_titulo')
for q, n in (('q1', 1), ('q2', 2), ('q3', 3)):
    faq['blocks'][q]['settings']['question'] = V(f'faq_{n}_pergunta')
    faq['blocks'][q]['settings']['answer'] = T(f'faq_{n}_resposta')
close['blocks']['h']['settings']['heading'] = V('fechamento_titulo')
close['blocks']['t']['settings']['text'] = T('fechamento_texto')
close['blocks']['btn']['settings']['button_label'] = V('fechamento_botao')

st, r = call('PUT', f'/themes/{THEME}/assets.json', {'asset': {'key': 'templates/page.landing-page.json', 'value': json.dumps(tpl, ensure_ascii=False)}})
print('PUT', st, '' if st == 200 else r)
