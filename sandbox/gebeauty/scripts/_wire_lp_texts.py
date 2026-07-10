# -*- coding: utf-8 -*-
"""Step 1 of wiring the LP's remaining hardcoded texts to the page registry.
Reads the current values straight from the template (avoids retyping accented PT),
converts richtext HTML -> rich_text AST, creates PAGE metafield definitions, and sets values.
Does NOT touch the template (binding is a separate step, run after the styling agent finishes).

Field plan (page metafield custom.* -> setting it will later bind to):
  single_line_text_field (inline_richtext / text settings, bind via .value):
    problema_titulo, solucao_titulo, ingredientes_titulo,
    ingrediente_1_titulo, ingrediente_2_titulo, ingrediente_3_titulo,
    faq_titulo, faq_1_pergunta, faq_2_pergunta, faq_3_pergunta,
    fechamento_titulo, fechamento_botao
  rich_text_field (richtext settings, bind via | metafield_tag):
    problema_texto, solucao_texto,
    ingrediente_1_texto, ingrediente_2_texto, ingrediente_3_texto,
    faq_1_resposta, faq_2_resposta, faq_3_resposta, fechamento_texto
"""
import json, urllib.request, urllib.error
from pathlib import Path
from html.parser import HTMLParser
TOKEN = None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='):
        TOKEN = line.strip().split('=', 1)[1]
API = 'https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01'
THEME = 181379236160
PAGE = "gid://shopify/Page/164358750528"


def gql(q, v=None):
    b = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    r = urllib.request.Request(f'{API}/graphql.json', data=b, headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    return json.loads(urllib.request.urlopen(r).read())


def asset_get(k):
    r = urllib.request.Request(f'{API}/themes/{THEME}/assets.json?asset[key]={k}', headers={'X-Shopify-Access-Token': TOKEN})
    return json.loads(urllib.request.urlopen(r).read())['asset']['value']


class Rich(HTMLParser):
    """Minimal HTML -> Shopify rich_text AST for the tags present here: p, ul, ol, li, strong/b, br."""
    def __init__(self):
        super().__init__()
        self.root = {"type": "root", "children": []}
        self.stack = [self.root]
        self.bold = 0

    def cur(self):
        return self.stack[-1]

    def handle_starttag(self, tag, attrs):
        if tag == 'p':
            n = {"type": "paragraph", "children": []}
            self.cur()["children"].append(n); self.stack.append(n)
        elif tag in ('ul', 'ol'):
            n = {"type": "list", "listType": "ordered" if tag == 'ol' else "unordered", "children": []}
            self.cur()["children"].append(n); self.stack.append(n)
        elif tag == 'li':
            n = {"type": "list-item", "children": []}
            self.cur()["children"].append(n); self.stack.append(n)
        elif tag in ('strong', 'b'):
            self.bold += 1
        elif tag == 'br':
            self._text("\n")

    def handle_endtag(self, tag):
        if tag in ('p', 'ul', 'ol', 'li') and len(self.stack) > 1:
            self.stack.pop()
        elif tag in ('strong', 'b'):
            self.bold = max(0, self.bold - 1)

    def _text(self, data):
        node = {"type": "text", "value": data}
        if self.bold:
            node["bold"] = True
        cur = self.cur()
        if cur["type"] in ("root", "list"):  # text must live in a block; wrap loose text
            p = {"type": "paragraph", "children": [node]}
            cur["children"].append(p)
        else:
            cur["children"].append(node)

    def handle_data(self, data):
        if data.strip():
            self._text(data)


def html_to_ast(html):
    p = Rich()
    p.feed(html)
    return json.dumps(p.root, ensure_ascii=False)


# --- read the current hardcoded values from the template ---
tpl = json.loads(asset_get('templates/page.landing-page.json'))
S = tpl['sections']
prob, sol, ing, faq, close = S['problem'], S['solution'], S['ingredients'], S['faq'], S['close']

single = {  # key -> raw value (inline_richtext / text; bound later via .value)
    'problema_titulo': prob['blocks']['h']['settings']['heading'],
    'solucao_titulo': sol['blocks']['h']['settings']['heading'],
    'ingredientes_titulo': ing['settings']['title'],
    'ingrediente_1_titulo': ing['blocks']['c1']['settings']['title'],
    'ingrediente_2_titulo': ing['blocks']['c2']['settings']['title'],
    'ingrediente_3_titulo': ing['blocks']['c3']['settings']['title'],
    'faq_titulo': faq['settings']['title'],
    'faq_1_pergunta': faq['blocks']['q1']['settings']['question'],
    'faq_2_pergunta': faq['blocks']['q2']['settings']['question'],
    'faq_3_pergunta': faq['blocks']['q3']['settings']['question'],
    'fechamento_titulo': close['blocks']['h']['settings']['heading'],
    'fechamento_botao': close['blocks']['btn']['settings']['button_label'],
}
rich = {  # key -> raw HTML (richtext; bound later via | metafield_tag)
    'problema_texto': prob['blocks']['t']['settings']['text'],
    'solucao_texto': sol['blocks']['t']['settings']['text'],
    'ingrediente_1_texto': ing['blocks']['c1']['settings']['text'],
    'ingrediente_2_texto': ing['blocks']['c2']['settings']['text'],
    'ingrediente_3_texto': ing['blocks']['c3']['settings']['text'],
    'faq_1_resposta': faq['blocks']['q1']['settings']['answer'],
    'faq_2_resposta': faq['blocks']['q2']['settings']['answer'],
    'faq_3_resposta': faq['blocks']['q3']['settings']['answer'],
    'fechamento_texto': close['blocks']['t']['settings']['text'],
}

# --- create definitions (idempotent: skip TAKEN) ---
DEFN = 'mutation($d:MetafieldDefinitionInput!){metafieldDefinitionCreate(definition:$d){createdDefinition{id} userErrors{code message}}}'
for k in single:
    r = gql(DEFN, {"d": {"name": 'LP ' + k, "namespace": "custom", "key": k, "type": "single_line_text_field", "ownerType": "PAGE"}})
    e = r['data']['metafieldDefinitionCreate']['userErrors']
    print('def', k, '->', 'OK' if not e else e[0]['code'])
for k in rich:
    r = gql(DEFN, {"d": {"name": 'LP ' + k, "namespace": "custom", "key": k, "type": "rich_text_field", "ownerType": "PAGE"}})
    e = r['data']['metafieldDefinitionCreate']['userErrors']
    print('def', k, '->', 'OK' if not e else e[0]['code'])

# --- set values ---
mfs = [{"ownerId": PAGE, "namespace": "custom", "key": k, "type": "single_line_text_field", "value": v} for k, v in single.items()]
mfs += [{"ownerId": PAGE, "namespace": "custom", "key": k, "type": "rich_text_field", "value": html_to_ast(v)} for k, v in rich.items()]
# metafieldsSet takes max 25 per call; we have 21
r = gql('mutation($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){metafields{key} userErrors{field message}}}', {"m": mfs})
res = r['data']['metafieldsSet']
print('metafieldsSet errors:', res['userErrors'] or 'OK', '| set:', len(res['metafields']))
