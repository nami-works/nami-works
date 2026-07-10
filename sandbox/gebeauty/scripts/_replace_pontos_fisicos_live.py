"""Promote the revamped 'pontos-fisicos-novo' (temp 164178952512) into the LIVE page
'pontos-fisicos' (132999643456): back up current HTML, copy new body over, delete temp."""
import json, urllib.request, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
TOKEN=None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='):
        TOKEN=line.strip().split('=',1)[1]
API='https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01'
LIVE=132999643456; TEMP=164178952512
H={'Content-Type':'application/json','X-Shopify-Access-Token':TOKEN}
def call(method,path,data=None):
    r=urllib.request.Request(f'{API}{path}',data=(json.dumps(data).encode() if data else None),method=method,headers=H)
    with urllib.request.urlopen(r) as resp:
        body=resp.read().decode()
        return resp.status, (json.loads(body) if body.strip() else {})

# 1) backup current live body
_,live=call('GET',f'/pages/{LIVE}.json')
old=live['page']['body_html']
bdir=Path(__file__).resolve().parent.parent / "research"
bpath=bdir / "pontos-fisicos-live-backup-2026-06-25.html"
bpath.write_text(old, encoding='utf-8')
print('BACKUP saved:', bpath, '|', len(old), 'chars')

# 2) get approved new body from temp page
_,tmp=call('GET',f'/pages/{TEMP}.json')
new=tmp['page']['body_html']
print('NEW body from temp:', len(new), 'chars | has <style>:', '<style>' in new, '| has <script>:', '<script>' in new)

# 3) write new body into live page (title/handle untouched)
st,_=call('PUT',f'/pages/{LIVE}.json',{'page':{'id':LIVE,'body_html':new}})
print('PUT live page status:', st)

# 4) delete temp page
st2,_=call('DELETE',f'/pages/{TEMP}.json')
print('DELETE temp page status:', st2)

# 5) verify live page id + handle
_,chk=call('GET',f'/pages/{LIVE}.json')
print('LIVE page handle:', chk['page']['handle'], '| body now', len(chk['page']['body_html']),'chars | gebpf present:', 'class="gebpf"' in chk['page']['body_html'])
