"""Storefront-vs-rules watchdog (READ-ONLY). Ad-hoc phase of initiative
.claude/initiatives/gebeauty-storefront-rules-watchdog.md.

Checks the live GE Beauty store against codified discount + badge rules and
prints a grouped violations report. Exit code = number of violations (0 = clean),
so it can later gate a cron alert. Never mutates anything.

Invariants (see initiative for detail):
  B1 bundle component with 0 variants selected (unlinked / deleted variant)
  B2 kit priced ABOVE its resolved component sum (penalty bundle)
  B3 kit compareAtPrice != component sum, or price > compareAtPrice
  G1 compare-at product missing/‑wrong off-badge  (de<100 -> N% off ; de>=100 -> R$N off)
  G2 off-badge on a full-price product (stray)
  G3 referenced etiqueta metaobject is DRAFT (links but never renders)
  G4 duplicate ACTIVE off-badges with identical texto (library hygiene, low sev)
"""
import json, urllib.request, time, re, sys
from collections import Counter
from pathlib import Path
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
            with urllib.request.urlopen(req, timeout=30) as r: return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(2); continue
            print('HTTP', e.code, e.read().decode()[:300]); raise
        except (urllib.error.URLError, TimeoutError) as e:
            print('  net retry:', e); time.sleep(3); continue

PCT = re.compile(r'^\s*(\d+)\s*%\s*off\s*$', re.I)
RS  = re.compile(r'^\s*r\$\s*(\d+)\s*off\s*$', re.I)
def f(x):
    try: return float(x)
    except: return 0.0

HIGH, NORMAL, LOW = 'HIGH', 'NORMAL', 'LOW'
violations = []  # (sev, code, title, detail)
def flag(sev, code, title, detail): violations.append((sev, code, title, detail))

# ---- etiqueta library: parse off-badges, publish status, duplicates ----
qm = 'query($c:String){metaobjects(type:"etiqueta",first:100,after:$c){pageInfo{hasNextPage endCursor} nodes{id fields{key value} capabilities{publishable{status}}}}}'
c = None; ents = []
while True:
    d = gql(qm, {'c': c}); conn = d['data']['metaobjects']; ents += conn['nodes']
    if conn['pageInfo']['hasNextPage']: c = conn['pageInfo']['endCursor']
    else: break
status_by_gid = {}; offgids = set(); by_text_active = {}
for e in ents:
    fm = {x['key']: x['value'] for x in e['fields']}; txt = (fm.get('texto') or '').strip()
    st = e['capabilities']['publishable']['status']; status_by_gid[e['id']] = st
    if PCT.match(txt) or RS.match(txt):
        offgids.add(e['id'])
        if st == 'ACTIVE': by_text_active.setdefault(txt.lower().replace(' ', ''), []).append(e['id'])
for txt, gids in by_text_active.items():
    if len(gids) > 1:
        flag(LOW, 'G4', f'duplicate ACTIVE off-badge "{txt}"', f'{len(gids)} metaobjects: {[g.split("/")[-1] for g in gids]}')

# ---- all products ----
qp = '''query($c:String){products(first:50,after:$c){pageInfo{hasNextPage endCursor}
 nodes{title status productType
  variants(first:30){nodes{price compareAtPrice
    productVariantComponents(first:30){nodes{quantity productVariant{price}}}}}
  bundleComponents(first:25){nodes{quantity componentVariantsCount{count} componentProduct{title}}}
  et:metafield(namespace:"custom",key:"etiquetas"){references(first:25){nodes{... on Metaobject{id t:field(key:"texto"){value}}}}}}}}'''
c = None; prods = []
while True:
    d = gql(qp, {'c': c}); conn = d['data']['products']; prods += conn['nodes']
    if conn['pageInfo']['hasNextPage']: c = conn['pageInfo']['endCursor']
    else: break

n_kits = n_disc = 0
for p in prods:
    title = p['title']; is_kit = p['productType'] == 'kit'; active = p['status'] == 'ACTIVE'

    # B1 — unlinked bundle component
    for bc in (p['bundleComponents']['nodes'] if p['bundleComponents'] else []):
        cnt = (bc.get('componentVariantsCount') or {}).get('count')
        if cnt == 0:
            flag(HIGH, 'B1', f'{title}: component "{bc["componentProduct"]["title"]}" has 0 variants selected',
                 'defined in bundle but unlinked (deleted variant) -> drops at checkout; fix in Bundles app')

    # per-variant discount + bundle price coherence
    disc_variant = None
    for v in p['variants']['nodes']:
        pr = f(v['price']); ca = f(v['compareAtPrice'])
        if ca > pr + 0.01 and disc_variant is None: disc_variant = (pr, ca)
        if is_kit and active:
            comps = v['productVariantComponents']['nodes']
            if comps:
                s = sum(f(n['productVariant']['price']) * n['quantity'] for n in comps)
                if pr > s + 0.5:
                    flag(HIGH, 'B2', f'{title}: priced above components', f'price R${pr:.0f} > component sum R${s:.0f} (penalty bundle)')
                if ca > 0.01 and abs(ca - s) > 0.5:
                    flag(NORMAL, 'B3', f'{title}: de != component sum', f'de R${ca:.0f} vs sum R${s:.0f}')
                if ca > 0.01 and pr > ca + 0.01:
                    flag(NORMAL, 'B3', f'{title}: price > de', f'price R${pr:.0f} > de R${ca:.0f}')

    # badge checks
    if is_kit: n_kits += 1
    refs = [(n['id'], (n['t']['value'] if n.get('t') else '')) for n in (p['et']['references']['nodes'] if p['et'] and p['et']['references'] else [])]
    off_refs = [(gid, t) for gid, t in refs if gid in offgids]
    # G3 — any referenced badge that is DRAFT
    for gid, t in refs:
        if status_by_gid.get(gid) and status_by_gid[gid] != 'ACTIVE':
            flag(HIGH, 'G3', f'{title}: badge "{t or gid.split("/")[-1]}" is {status_by_gid[gid]}', 'links but will not render on storefront')

    if disc_variant:
        n_disc += 1
        pr, ca = disc_variant
        kind = 'rs' if ca >= 100 else 'pct'
        val = round(ca - pr) if kind == 'rs' else round((1 - pr / ca) * 100)
        want = (f'R${val} off' if kind == 'rs' else f'{val}% off').lower().replace(' ', '')
        got = [t for _, t in off_refs]
        if len(off_refs) != 1 or off_refs[0][1].lower().replace(' ', '') != want:
            flag(NORMAL, 'G1', f'{title}: off-badge wrong/missing', f'want [{want}] got {got or "[none]"} (de R${ca:.0f}, price R${pr:.0f})')
    else:
        # G2 — off-badge on a full-price product
        if off_refs:
            flag(NORMAL, 'G2', f'{title}: off-badge on full-price product', f'{[t for _, t in off_refs]}')

# ---- D1: discount combinability with free shipping ----
# Every active non-free-shipping discount must have combinesWith.shippingDiscounts=true,
# else it can't stack with the R$299 free-ship Function. Detection only (read-only);
# remediation is gebeauty/scripts/fix_discount_shipping_combine.py.
QD = ('fragment cw on DiscountCombinesWith { shippingDiscounts }'
      'query($cur:String){discountNodes(first:100,after:$cur,query:"status:active",sortKey:CREATED_AT){'
      ' pageInfo{hasNextPage endCursor} edges{node{discount{__typename'
      '  ... on DiscountCodeBasic{title combinesWith{...cw}}'
      '  ... on DiscountCodeBxgy{title combinesWith{...cw}}'
      '  ... on DiscountCodeApp{title combinesWith{...cw}}'
      '  ... on DiscountAutomaticBasic{title combinesWith{...cw}}'
      '  ... on DiscountAutomaticBxgy{title combinesWith{...cw}}'
      '  ... on DiscountAutomaticApp{title combinesWith{...cw}}'
      '  ... on DiscountCodeFreeShipping{title}'
      '  ... on DiscountAutomaticFreeShipping{title}}}}}}')
FREESHIP = {'DiscountCodeFreeShipping', 'DiscountAutomaticFreeShipping'}
def _cls(t):
    t = t.strip()
    if t.startswith('gift_'): return 'gift_ (CRM Bonus cashback)'
    if t.startswith('Loox Referrals'): return 'Loox referral'
    if re.fullmatch(r'[A-Z]+10', t): return 'affiliate NAME10'
    return 'other'
cur = None; n_disc_total = 0; noncombine = []
while True:
    d = gql(QD, {'cur': cur}); conn = d['data']['discountNodes']
    for e in conn['edges']:
        disc = e['node']['discount'] or {}; n_disc_total += 1
        t = disc.get('__typename', '?'); cw = disc.get('combinesWith') or {}
        if t not in FREESHIP and cw.get('shippingDiscounts') is False:
            noncombine.append((disc.get('title') or '', t))
    if conn['pageInfo']['hasNextPage']: cur = conn['pageInfo']['endCursor']
    else: break
# The R$299 free-ship is itself a DiscountAutomaticApp Function; shipping=false is
# CORRECT for it (a shipping discount doesn't stack with shipping). Exclude by title.
# Other app-automatic discounts are app-owned -> can't flip from our token; report LOW.
code_nc = [(tt, t) for tt, t in noncombine if t != 'DiscountAutomaticApp']
app_nc = [(tt, t) for tt, t in noncombine if t == 'DiscountAutomaticApp' and 'frete gr' not in tt.lower()]
if code_nc:
    cls = Counter(_cls(tt) for tt, _ in code_nc)
    breakdown = '; '.join(f'{v} {k}' for k, v in cls.most_common())
    flag(NORMAL, 'D1', f'{len(code_nc)} code discounts do not combine with free shipping',
         f'{breakdown} — remediate: fix_discount_shipping_combine.py --all --no-app --apply')
if app_nc:
    flag(LOW, 'D1-app', f'{len(app_nc)} app-automatic discounts do not combine with free shipping (manual review)',
         f'{[tt for tt, _ in app_nc]} — app-owned, cannot flip from our token; fix in the owning app if they should stack')

# ---- report ----
print(f"Audited {len(prods)} products ({n_kits} kits, {n_disc} with a compare-at discount) "
      f"and {n_disc_total} active discounts.")
order = {HIGH: 0, NORMAL: 1, LOW: 2}
violations.sort(key=lambda x: order[x[0]])
if not violations:
    print("\n✅ CLEAN — no storefront-vs-rules violations.")
else:
    print(f"\n⚠ {len(violations)} violation(s):")
    for sev, code, t, detail in violations:
        print(f"  [{sev:6}] {code} {t}\n           {detail}")
_h = sum(1 for v in violations if v[0] == HIGH)
_n = sum(1 for v in violations if v[0] == NORMAL)
_l = sum(1 for v in violations if v[0] == LOW)
print(f"SUMMARY high={_h} normal={_n} low={_l}")  # machine-readable for watchdog_report.py
sys.exit(min(len(violations), 250))
