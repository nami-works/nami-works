"""Align every promotional icon strip to the homepage 'ícones promo' trio.

Targets ONLY icons-with-title sections named 'ícones promo' or
'ícones promocionais'. Leaves 'ícones' (brand values), 'ícones relax friday'
(campaign), and 'ícones progressiva' (discount tiers) untouched.

Canonical source = homepage templates/index.json 'ícones promo' blocks
(descontos / compre-em-ate-6-x-sem-juros / oferta-frete).

Dry-run by default. Pass 'apply' as argv[1] to write.
"""
import json, urllib.request, urllib.parse, sys, re, copy
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')

APPLY = len(sys.argv) > 1 and sys.argv[1] == 'apply'
TOKEN = None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='):
        TOKEN = line.strip().split('=', 1)[1]
SHOP = 'ge-beauty-cosmeticos.myshopify.com'; THEME = 181379236160
API = f'https://{SHOP}/admin/api/2026-01'
TARGET_NAMES = {'ícones promo', 'ícones promocionais'}

def get(url):
    req = urllib.request.Request(url, headers={'X-Shopify-Access-Token': TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode('utf-8'))
def get_asset(key):
    return get(f'{API}/themes/{THEME}/assets.json?asset[key]={urllib.parse.quote(key)}')['asset']['value']
def put_asset(key, value):
    body = json.dumps({'asset': {'key': key, 'value': value}}).encode('utf-8')
    req = urllib.request.Request(f'{API}/themes/{THEME}/assets.json', data=body, method='PUT',
        headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    with urllib.request.urlopen(req) as r:
        return r.status

HRE = re.compile(r'metaobjects\.icones(?:\.([a-z0-9_\-]+)|\[\\?"([a-z0-9_\-]+)\\?"\])')
def handles(section):
    order = section.get('block_order') or list(section.get('blocks', {}).keys())
    out = []
    for bid in order:
        m = HRE.search(json.dumps(section['blocks'].get(bid, {}), ensure_ascii=False))
        out.append((m.group(1) or m.group(2)) if m else '?')
    return out

# 1) canonical blocks from homepage
idx = json.loads(get_asset('templates/index.json'))
canon_blocks = canon_order = None
for s in idx['sections'].values():
    if s.get('type') == 'icons-with-title' and s.get('name') == 'ícones promo':
        canon_blocks = copy.deepcopy(s['blocks'])
        canon_order = list(s.get('block_order') or s['blocks'].keys())
print('CANONICAL (homepage):', handles({'blocks': canon_blocks, 'block_order': canon_order}))
print('MODE:', 'APPLY' if APPLY else 'DRY-RUN')
print('=' * 70)

# 2) walk all templates
lst = get(f'{API}/themes/{THEME}/assets.json')['assets']
tkeys = sorted(a['key'] for a in lst if a['key'].startswith('templates/') and a['key'].endswith('.json'))
changed_files = 0
for tk in tkeys:
    if tk == 'templates/index.json':
        continue
    try:
        data = json.loads(get_asset(tk))
    except Exception:
        continue
    secs = data.get('sections', {})
    file_changed = False
    lines = []
    for sid, s in secs.items():
        if s.get('type') == 'icons-with-title' and s.get('name') in TARGET_NAMES:
            before = handles(s)
            if before == handles({'blocks': canon_blocks, 'block_order': canon_order}):
                lines.append(f'    [{s.get("name")}] already aligned, skip')
                continue
            s['blocks'] = copy.deepcopy(canon_blocks)
            s['block_order'] = list(canon_order)
            after = handles(s)
            lines.append(f'    [{s.get("name")}] {before}  ->  {after}')
            file_changed = True
    if file_changed:
        changed_files += 1
        print(f'{tk}')
        for l in lines:
            print(l)
        if APPLY:
            status = put_asset(tk, json.dumps(data, ensure_ascii=False))
            print(f'    PUT -> {status}')
print('=' * 70)
print(f'{"WROTE" if APPLY else "WOULD CHANGE"} {changed_files} template files')
