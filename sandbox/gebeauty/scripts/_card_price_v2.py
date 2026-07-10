"""v2: inject price into the REAL card buy button (products.product.buy label), available
branch only. Does NOT hide the standalone price (verify first). Idempotent + safe."""
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


_, a = call('GET', f'/themes/{THEME}/assets.json?asset[key]=snippets/card-product.liquid')
cp = a['asset']['value']
ANCHOR = "{{ button_label | default: 'products.product.buy' | t }}"
SPAN = ('<span class="gb-card-price" style="text-transform:none;font-weight:700;">'
        " &middot; {{ card_product.price | money | replace: 'R$ ', 'R$' }}</span>")
n = cp.count(ANCHOR)
already = 'gb-card-price' in cp
print('buy-label occurrences:', n, '| already injected:', already)
if already:
    print('SKIP (already injected)')
elif n == 1:
    cp2 = cp.replace(ANCHOR, ANCHOR + SPAN, 1)
    st, r = call('PUT', f'/themes/{THEME}/assets.json', {'asset': {'key': 'snippets/card-product.liquid', 'value': cp2}})
    print('card-product PUT:', st, '' if st == 200 else r, '| injected:', 'gb-card-price' in cp2)
else:
    print('ABORT: buy label not unique (', n, ')')
