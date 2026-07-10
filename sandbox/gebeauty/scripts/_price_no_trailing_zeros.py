"""Swap money -> money_without_trailing_zeros in the in-button price, on both the card
snippet and the LP template, so R$129,00 shows as R$129 but R$128,50 stays R$128,50."""
import json, urllib.request, urllib.error
from pathlib import Path
TOKEN = None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='):
        TOKEN = line.strip().split('=', 1)[1]
API = 'https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01'
THEME = 181379236160


def call(method, path, data=None):
    r = urllib.request.Request(f'{API}{path}', data=(json.dumps(data).encode() if data is not None else None),
        method=method, headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    try:
        with urllib.request.urlopen(r) as resp:
            b = resp.read().decode()
            return resp.status, (json.loads(b) if b.strip() else {})
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:600]


# 1. card snippet
_, a = call('GET', f'/themes/{THEME}/assets.json?asset[key]=snippets/card-product.liquid')
cp = a['asset']['value']
old_c = "card_product.price | money | replace: 'R$ ', 'R$'"
new_c = "card_product.price | money_without_trailing_zeros | replace: 'R$ ', 'R$'"
if old_c in cp:
    cp = cp.replace(old_c, new_c)
    st, r = call('PUT', f'/themes/{THEME}/assets.json', {'asset': {'key': 'snippets/card-product.liquid', 'value': cp}})
    print('card-product:', st, '| now no-trailing-zeros:', new_c in cp)
else:
    print('card-product: pattern not found (already changed?)', 'money_without_trailing_zeros' in cp)

# 2. LP template
_, a2 = call('GET', f'/themes/{THEME}/assets.json?asset[key]=templates/page.landing-page.json')
tpl = json.loads(a2['asset']['value'])
fpk = next(k for k, s in tpl['sections'].items() if s.get('type') == 'featured-product')
S = tpl['sections'][fpk]['blocks']['lpstyle']['settings']['custom_liquid']
old_l = "value.price | money | strip_html | replace: 'R$ ', 'R$'"
new_l = "value.price | money_without_trailing_zeros | strip_html | replace: 'R$ ', 'R$'"
if old_l in S:
    tpl['sections'][fpk]['blocks']['lpstyle']['settings']['custom_liquid'] = S.replace(old_l, new_l)
    st2, r2 = call('PUT', f'/themes/{THEME}/assets.json', {'asset': {'key': 'templates/page.landing-page.json', 'value': json.dumps(tpl, ensure_ascii=False)}})
    print('LP template:', st2, '| now no-trailing-zeros:', new_l in json.dumps(tpl))
else:
    print('LP template: pattern not found (already changed?)', 'money_without_trailing_zeros' in S)
