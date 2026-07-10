"""Theme-wide: inject 'comprar . R$X' price into the shared buy-buttons submit (available
branch), matching the card/LP. Then remove the LP's redundant CSS price so it doesn't double.
money_without_trailing_zeros so R$129,00 shows as R$129. Idempotent + safe."""
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


# 1. buy-buttons.liquid: inject price after the inner label endif (available branch)
_, a = call('GET', f'/themes/{THEME}/assets.json?asset[key]=snippets/buy-buttons.liquid')
bb = a['asset']['value']
SPAN = ('<span class="gb-btn-price" style="text-transform:none;font-weight:700;">'
        " &middot; {{ product.price | money_without_trailing_zeros | replace: 'R$ ', 'R$' }}</span>")
if 'gb-btn-price' in bb:
    print('buy-buttons: already injected, skip')
else:
    # anchor: the add_to_cart label followed by its closing {% endif %} (the main_product_bar_label if)
    pat = re.compile(r"(\{\{ 'products\.product\.add_to_cart' \| t \}\}\s*\{% endif %\})")
    if len(pat.findall(bb)) == 1:
        bb2 = pat.sub(r"\1\n              " + SPAN, bb, count=1)
        st, r = call('PUT', f'/themes/{THEME}/assets.json', {'asset': {'key': 'snippets/buy-buttons.liquid', 'value': bb2}})
        print('buy-buttons PUT:', st, '| injected:', 'gb-btn-price' in bb2)
    else:
        print('ABORT: anchor not unique in buy-buttons (', len(pat.findall(bb)), ')')

# 2. LP lpstyle: remove the redundant CSS price (--lp-price rule + span::after)
_, a2 = call('GET', f'/themes/{THEME}/assets.json?asset[key]=templates/page.landing-page.json')
tpl = json.loads(a2['asset']['value'])
fpk = next(k for k, s in tpl['sections'].items() if s.get('type') == 'featured-product')
S = tpl['sections'][fpk]['blocks']['lpstyle']['settings']['custom_liquid']
S2 = re.sub(r'#shopify-section-\{\{ section\.id \}\} \.product-form__submit\{[^}]*--lp-price[^}]*\}', '', S)
S2 = re.sub(r'#shopify-section-\{\{ section\.id \}\} \.product-form__submit span::after\{[^}]*\}', '', S2)
if S2 != S:
    tpl['sections'][fpk]['blocks']['lpstyle']['settings']['custom_liquid'] = S2
    st2, r2 = call('PUT', f'/themes/{THEME}/assets.json', {'asset': {'key': 'templates/page.landing-page.json', 'value': json.dumps(tpl, ensure_ascii=False)}})
    print('LP CSS price removed:', st2, '| lp-price gone:', '--lp-price' not in S2, '| ::after gone:', 'submit span::after' not in S2)
else:
    print('LP: no CSS price rules found to remove (already clean?)')
