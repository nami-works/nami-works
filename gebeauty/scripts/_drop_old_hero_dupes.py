"""Delete the OLD duplicate hero image from 9 products (keeps position #1 = the new
warm-bg hero). Matches the old media by the exact CDN url captured during the sweep.
Safety: never deletes index 0; aborts a product if the target can't be resolved.
Dry-run unless argv[1]=='apply'."""
import json, urllib.request, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
APPLY = len(sys.argv) > 1 and sys.argv[1] == 'apply'
TOKEN=None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='): TOKEN=line.strip().split('=',1)[1]
URL='https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json'
def gql(q,v=None):
    body=json.dumps({'query':q,**({'variables':v} if v else {})}).encode()
    req=urllib.request.Request(URL,data=body,headers={'Content-Type':'application/json','X-Shopify-Access-Token':TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode())

SWEEP=json.loads(Path("C:/Users/LUCASG~1/AppData/Local/Temp/claude/c--Users-Lucas-Guimar-es-Desktop-nami-works/b4078ee5-bd3e-40ec-8f18-b2a031134f3e/scratchpad/hero_product_active.json").read_text(encoding='utf-8'))
TARGETS=['primer-liso-intacto','primer-cachos-definidos','leave-in-pluma','booster-antifrizz',
 'melon-mood-body-hair-mist','shampoo-a-seco','mascara-condicionadora-travel-size',
 'shampoo-sem-sulfato-travel-size','mascara-condicionadora']
twin={r['handle']:r for r in SWEEP if r['handle'] in TARGETS}

PQ='''query($q:String){ products(first:1, query:$q){ nodes{ id handle
  media(first:25){ nodes{ ... on MediaImage { id createdAt image{ url width height } } } } } } }'''
DEL='''mutation($pid:ID!,$mids:[ID!]!){ productDeleteMedia(productId:$pid, mediaIds:$mids){ deletedMediaIds userErrors{field message} } }'''

print('MODE:', 'APPLY' if APPLY else 'DRY-RUN')
plan=[]
for h in TARGETS:
    tw=twin.get(h)
    if not tw: print(f'  {h}: NOT in sweep data, skip'); continue
    target_url=tw['twin_url']
    r=gql(PQ,{'q':f'handle:{h}'})
    nodes=r['data']['products']['nodes']
    if not nodes: print(f'  {h}: product not found, skip'); continue
    p=nodes[0]; media=[m for m in p['media']['nodes'] if m.get('image')]
    match=None
    for idx,m in enumerate(media):
        if m['image']['url']==target_url: match=(idx,m); break
    if not match:  # fallback: createdAt + dims
        for idx,m in enumerate(media):
            if (m['createdAt'] or '')[:10]==(tw['twin_created'] or '')[:10] and f"{m['image']['width']}x{m['image']['height']}"==tw['twin_dims'] and idx!=0:
                match=(idx,m); break
    if not match:
        print(f'  {h}: OLD image NOT resolved (skip — manual check)'); continue
    idx,m=match
    if idx==0:
        print(f'  {h}: matched image is at #1 — ABORT (would delete the new hero)'); continue
    keep0=media[0]
    print(f"  {h}: delete media#{idx+1} {m['id'].split('/')[-1]} ({(m['createdAt'] or '')[:10]}, {m['image']['width']}x{m['image']['height']})  |  keep #1 ({(keep0['createdAt'] or '')[:10]})")
    plan.append((h,p['id'],m['id']))

print(f'\\nresolved {len(plan)}/{len(TARGETS)} deletions')
if APPLY:
    for h,pid,mid in plan:
        r=gql(DEL,{'pid':pid,'mids':[mid]})
        res=r['data']['productDeleteMedia']
        print(f"  {h}: deleted={res['deletedMediaIds']} errs={res['userErrors']}")
else:
    print('(dry-run; pass "apply" to delete)')
