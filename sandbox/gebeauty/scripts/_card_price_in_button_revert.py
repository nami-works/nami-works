"""Revert the card price-in-button change: remove the injected span from card-product.liquid
and the hide rule from base.css."""
import json, urllib.request, urllib.error, re
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


# 1. remove the injected span from card-product.liquid
_, a = call('GET', f'/themes/{THEME}/assets.json?asset[key]=snippets/card-product.liquid')
cp = a['asset']['value']
cp2 = re.sub(r'<span class="gb-card-price".*?</span>', '', cp, flags=re.S)
if cp2 != cp:
    st, r = call('PUT', f'/themes/{THEME}/assets.json', {'asset': {'key': 'snippets/card-product.liquid', 'value': cp2}})
    print('card-product reverted:', st, '| gb-card-price gone:', 'gb-card-price' not in cp2)
else:
    print('card-product: nothing to revert (no gb-card-price found)')

# 2. remove the hide rule from base.css
_, a2 = call('GET', f'/themes/{THEME}/assets.json?asset[key]=assets/base.css')
css = a2['asset']['value']
css2 = css.replace('\n/* GE card: price moved into the button */\n.card .price{display:none !important;}\n', '')
if css2 == css:
    css2 = re.sub(r'\s*/\* GE card: price moved into the button \*/\s*\.card \.price\{display:none !important;\}', '', css)
if css2 != css:
    st2, r2 = call('PUT', f'/themes/{THEME}/assets.json', {'asset': {'key': 'assets/base.css', 'value': css2}})
    print('base.css reverted:', st2, '| rule gone:', '.card .price{display:none' not in css2)
else:
    print('base.css: nothing to revert')
