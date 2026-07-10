"""Hardcode the correct Octane quiz id into the modal snippet (snippets/quiz-modal.liquid),
replacing the old quiz id in data-quiz-id. Dry-run unless argv[1]=='apply'."""
import json, urllib.request, urllib.parse, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
APPLY = len(sys.argv) > 1 and sys.argv[1] == 'apply'
TOKEN=None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='): TOKEN=line.strip().split('=',1)[1]
SHOP='ge-beauty-cosmeticos.myshopify.com'; THEME=181379236160
API=f'https://{SHOP}/admin/api/2026-01'
KEY='snippets/quiz-modal.liquid'
OLD='data-quiz-id="iqVDfs8iAzxgnlQw"'
NEW='data-quiz-id="i8z8npJNxmAkzfHw"'

def get_asset():
    u=f'{API}/themes/{THEME}/assets.json?asset[key]={urllib.parse.quote(KEY)}'
    return json.loads(urllib.request.urlopen(urllib.request.Request(u,headers={'X-Shopify-Access-Token':TOKEN})).read().decode())['asset']['value']
def put_asset(val):
    body=json.dumps({'asset':{'key':KEY,'value':val}}).encode()
    r=urllib.request.Request(f'{API}/themes/{THEME}/assets.json',data=body,method='PUT',headers={'Content-Type':'application/json','X-Shopify-Access-Token':TOKEN})
    return urllib.request.urlopen(r).status

v=get_asset()
n=v.count(OLD)
print('MODE:', 'APPLY' if APPLY else 'DRY-RUN', '| old-id occurrences:', n)
if n!=1:
    print('ABORT: expected exactly 1 occurrence, found', n); sys.exit(1)
for line in v.splitlines():
    if 'data-quiz-id' in line:
        print('BEFORE:', line.strip()[:200])
new_v=v.replace(OLD,NEW)
for line in new_v.splitlines():
    if 'data-quiz-id' in line:
        print('AFTER :', line.strip()[:200])
if APPLY:
    print('PUT status:', put_asset(new_v))
else:
    print('(dry-run; pass "apply" to write)')
