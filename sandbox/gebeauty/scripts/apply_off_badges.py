"""Resync 'off' discount badges (custom.etiquetas) on every compare-at item.

Badge-choice rule (Lucas): de<100 -> "N% off"; de>=100 -> "R$N off".
de=100 is the exact crossover, so this always shows the higher absolute number.

Per product with compareAtPrice: drop all existing off-badges, keep every
non-off badge (best-seller / lançamento / etc., order preserved), append the
one correct off-badge. Creates any missing badge metaobject as ACTIVE (a DRAFT
metaobject links in the metafield but never renders on the storefront).

Idempotent + resumable. DRY-RUN unless argv[1]=='apply'.
See Claude memory reference_gebeauty_etiqueta_applier for the full mechanic.
"""
import json, urllib.request, time, re, sys
from pathlib import Path
APPLY = len(sys.argv) > 1 and sys.argv[1] == 'apply'
sys.stdout.reconfigure(encoding='utf-8')

TOKEN = None
for line in (Path(__file__).resolve().parent.parent / ".env").read_text(encoding="utf-8").splitlines():
    if line.strip().startswith("SHOPIFY_ADMIN_ACCESS_TOKEN="):
        TOKEN = line.split("=", 1)[1].strip().strip('"')
URL = 'https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json'

def gql(q, v=None):
    body = json.dumps({'query': q, **({'variables': v} if v else {})}).encode()
    req = urllib.request.Request(URL, data=body, headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN})
    for _ in range(6):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:  # timeout: a stalled conn hung a prior run
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(2); continue
            print('HTTP', e.code, e.read().decode()[:300]); raise
        except (urllib.error.URLError, TimeoutError) as e:
            print('  net retry:', e); time.sleep(3); continue

PCT = re.compile(r'^\s*(\d+)\s*%\s*off\s*$', re.I)
RS  = re.compile(r'^\s*r\$\s*(\d+)\s*off\s*$', re.I)

def load_lib():
    qm = 'query($c:String){metaobjects(type:"etiqueta",first:100,after:$c){pageInfo{hasNextPage endCursor} nodes{id fields{key value}}}}'
    c = None; ents = []
    while True:
        d = gql(qm, {'c': c}); conn = d['data']['metaobjects']; ents += conn['nodes']
        if conn['pageInfo']['hasNextPage']: c = conn['pageInfo']['endCursor']
        else: break
    offgids = set(); pct = {}; rs = {}
    for e in ents:
        fm = {f['key']: f['value'] for f in e['fields']}; txt = (fm.get('texto') or '').strip()
        m1 = PCT.match(txt); m2 = RS.match(txt)
        if m1: offgids.add(e['id']); pct.setdefault(int(m1.group(1)), e['id'])
        elif m2: offgids.add(e['id']); rs.setdefault(int(m2.group(1)), e['id'])
    return offgids, pct, rs

offgids, PCTMAP, RSMAP = load_lib()
print(f"Library: {len(offgids)} off-badges ({len(PCTMAP)} %, {len(RSMAP)} R$)")

CREATE = 'mutation($m:MetaobjectCreateInput!){metaobjectCreate(metaobject:$m){metaobject{id} userErrors{field message code}}}'
def ensure_badge(kind, val):
    m = RSMAP if kind == 'rs' else PCTMAP
    if val in m: return m[val]
    txt = f"R${val} off" if kind == 'rs' else f"{val}% off"
    handle = f"r-{val}-off" if kind == 'rs' else f"{val}-pct-off"
    inp = {'type': 'etiqueta', 'handle': handle,
           'capabilities': {'publishable': {'status': 'ACTIVE'}},  # DRAFT would link but never render
           'fields': [{'key': 'texto', 'value': txt}, {'key': 'cor_do_fundo', 'value': '#df3630'},
                      {'key': 'cor_do_texto', 'value': '#ffffff'}, {'key': 'texto_em_negrito', 'value': 'true'}]}
    if not APPLY:
        print(f"  [dry] would CREATE {txt} (handle {handle})"); return f"NEW:{txt}"
    res = gql(CREATE, {'m': inp})['data']['metaobjectCreate']
    if res['userErrors']: print(f"  X CREATE {txt}: {res['userErrors']}"); return None
    gid = res['metaobject']['id']; m[val] = gid; offgids.add(gid)
    print(f"  + created {txt} -> {gid.split('/')[-1]}"); return gid

qp = '''query($c:String){products(first:60,after:$c){pageInfo{hasNextPage endCursor}
 nodes{id title variants(first:30){nodes{price compareAtPrice}}
  et:metafield(namespace:"custom",key:"etiquetas"){references(first:25){nodes{... on Metaobject{id t:field(key:"texto"){value}}}}}}}}'''
c = None; prods = []
while True:
    d = gql(qp, {'c': c}); conn = d['data']['products']; prods += conn['nodes']
    if conn['pageInfo']['hasNextPage']: c = conn['pageInfo']['endCursor']
    else: break

def f(x):
    try: return float(x)
    except: return 0.0

targets = []
for p in prods:
    ds = [(f(v['price']), f(v['compareAtPrice'])) for v in p['variants']['nodes'] if f(v['compareAtPrice']) > f(v['price']) + 0.01]
    if not ds: continue
    pr, de = ds[0]
    kind = 'rs' if de >= 100 else 'pct'
    val = round(de - pr) if kind == 'rs' else round((1 - pr / de) * 100)
    targets.append((p, pr, de, kind, val))

print(f"\n{len(targets)} compare-at products. Ensuring badges exist:")
for (kind, val) in sorted({(k, v) for _, _, _, k, v in targets}):
    ensure_badge(kind, val)

SET = 'mutation($mf:[MetafieldsSetInput!]!){metafieldsSet(metafields:$mf){userErrors{field message}}}'
print(f"\n{'APPLY' if APPLY else 'DRY-RUN'} - per-product changes:")
for p, pr, de, kind, val in targets:
    cur = [(n['id'], (n['t']['value'] if n.get('t') else '')) for n in (p['et']['references']['nodes'] if p['et'] and p['et']['references'] else [])]
    keep = [gid for gid, t in cur if gid not in offgids]  # non-off badges, order preserved
    tgt = (RSMAP if kind == 'rs' else PCTMAP).get(val)
    if not tgt or str(tgt).startswith('NEW:'):
        print(f"  {p['title'][:38]:38} -> target {kind} {val} not yet created (dry); skip"); continue
    newlist = keep + ([tgt] if tgt not in keep else [])
    curgids = [gid for gid, _ in cur]
    drop = [t for gid, t in cur if gid in offgids]
    txt = f"R${val} off" if kind == 'rs' else f"{val}% off"
    if newlist == curgids:
        print(f"  {p['title'][:38]:38} already correct ({txt}), skip"); continue
    print(f"  {p['title'][:38]:38} drop{drop or '[]'} keep{len(keep)} + {txt}")
    if APPLY:
        errs = gql(SET, {'mf': [{'ownerId': p['id'], 'namespace': 'custom', 'key': 'etiquetas',
                                 'type': 'list.metaobject_reference', 'value': json.dumps(newlist)}]})['data']['metafieldsSet']['userErrors']
        if errs: print(f"      X {errs}")
print("\nDone.", "APPLIED." if APPLY else "Dry-run only; re-run with 'apply'.")
