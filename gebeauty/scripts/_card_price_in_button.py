"""Theme-wide: put the product price inside the card 'comprar' button (comprar . R$X),
matching the LP featured-product. Edits card-product.liquid (inject price span after the
button label) + base.css (hide the standalone card price). Idempotent + safe (aborts if
the label isn't uniquely found).
"""
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


# 1. card-product.liquid: inject price into the button
_, a = call('GET', f'/themes/{THEME}/assets.json?asset[key]=snippets/card-product.liquid')
cp = a['asset']['value']
LABEL = "{{ 'products.product.choose_options' | t }}"
SPAN = ('<span class="gb-card-price" style="text-transform:none;font-weight:700;">'
        " &middot; {{ card_product.price | money | replace: 'R$ ', 'R$' }}</span>")
n = cp.count(LABEL)
already = 'gb-card-price' in cp
print('label occurrences:', n, '| already injected:', already)
if already:
    print('SKIP card-product (already has gb-card-price)')
elif n == 1:
    cp2 = cp.replace(LABEL, LABEL + SPAN, 1)
    st, r = call('PUT', f'/themes/{THEME}/assets.json', {'asset': {'key': 'snippets/card-product.liquid', 'value': cp2}})
    print('card-product PUT:', st, '' if st == 200 else r)
else:
    print('ABORT: label not unique (', n, ') - manual check needed')

# 2. base.css: hide the standalone card price (price now shown in the button)
_, a2 = call('GET', f'/themes/{THEME}/assets.json?asset[key]=assets/base.css')
css = a2['asset']['value']
MARK = '/* GE card: price moved into the button */'
if MARK not in css:
    css = css + '\n' + MARK + '\n.card .price{display:none !important;}\n'
    st2, r2 = call('PUT', f'/themes/{THEME}/assets.json', {'asset': {'key': 'assets/base.css', 'value': css}})
    print('base.css hide card price PUT:', st2, '' if st2 == 200 else r2)
else:
    print('base.css already has the card-price hide rule')
