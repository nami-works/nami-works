"""Batch bg-neutralization across productType in {product, kit, acessorio} (active).
Produces corrected PNGs + per-group montages + an outlier-flagged summary. NO uploads.
Skips the 2 already-shipped heroes."""
import json, urllib.request, io, sys, os
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
sys.stdout.reconfigure(encoding='utf-8')
OUT=Path("C:/Users/LUCASG~1/AppData/Local/Temp/claude/c--claude/b4078ee5-bd3e-40ec-8f18-b2a031134f3e/scratchpad/batch")
OUT.mkdir(exist_ok=True)
TOKEN=None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='): TOKEN=line.strip().split('=',1)[1]
URL='https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json'
TARGET=np.array([236,237,233],float)
DONE={'mascara-mayday','kit-travel-size'}
def gql(q,v=None):
    body=json.dumps({'query':q,**({'variables':v} if v else {})}).encode()
    req=urllib.request.Request(URL,data=body,headers={'Content-Type':'application/json','X-Shopify-Access-Token':TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode())
def gblur(u8,r): return np.asarray(Image.fromarray(u8).filter(ImageFilter.GaussianBlur(r)),float)
def bg_mask(im):
    W,H=im.size; work=im.copy(); S=(255,0,255)
    for s in [(0,0),(W-1,0),(0,H-1),(W-1,H-1),(W//2,0),(W//2,H-1),(0,H//2),(W-1,H//2),(W//4,0),(3*W//4,0),(W//4,H-1),(3*W//4,H-1)]:
        try: ImageDraw.floodfill(work,s,S,thresh=46)
        except Exception: pass
    m=(np.all(np.asarray(work)==np.array(S),axis=-1)).astype('uint8')*255
    return np.clip(gblur(m,3)/255.0,0,1)
def process(im):
    a=np.asarray(im,float); H,W,_=a.shape
    border=np.concatenate([a[0],a[-1],a[:,0],a[:,-1]],axis=0); bmean=border.mean(0); bstd=border.std(0)
    flat=bstd.max()<6 and np.abs(TARGET-bmean).max()<12
    flags=[]
    # product/prop at bottom edge?
    brow=a[-1]; frac=(np.abs(brow-bmean).max(1)>45).mean()
    if frac>0.05: flags.append('product_at_bottom')
    if flat:
        out=a+(TARGET-bmean); cov=None
    else:
        mask=bg_mask(im); cov=float(mask.mean()); m3=np.dstack([mask]*3); r=max(20,W//12)
        Bloc=gblur(np.clip(a*m3,0,255).astype('uint8'),r)/np.clip(gblur((mask*255).astype('uint8'),r)/255.0,1e-3,None)[...,None]
        out=a+(TARGET-Bloc)*m3
        if cov<0.45: flags.append(f'mask_low_cov({cov:.2f})')
        if cov>0.97: flags.append(f'mask_high_cov({cov:.2f})')
    band=max(2,H//60); ramp=np.linspace(0,1,band)[:,None,None]; out[H-band:]=out[H-band:]*(1-ramp)+TARGET*ramp
    out=np.clip(out,0,255).astype('uint8'); ci=Image.fromarray(out)
    return ci,(mask if not flat else None),{'flat':bool(flat),'bmean':[float(x) for x in bmean.round(0)],'bstd':round(float(bstd.max()),1),'bottom':[float(x) for x in np.asarray(ci)[-1].mean(0).round(0)],'cov':(round(float(cov),3) if cov is not None else None),'flags':flags}

# gather handles + hero urls
q='query($q:String,$c:String){ products(first:100, after:$c, query:$q){ nodes{ handle productType media(first:1){ nodes{ ... on MediaImage { image{ url } } } } } pageInfo{ hasNextPage endCursor } } }'
items=[]
for pt in ['product','kit','acessorio']:
    c=None
    while True:
        r=gql(q,{'q':f'product_type:{pt} status:active','c':c}); pr=r['data']['products']
        for n in pr['nodes']:
            if n['handle'] in DONE: continue
            md=n['media']['nodes']
            if not md or not md[0].get('image'): continue
            items.append((pt,n['handle'],md[0]['image']['url']))
        if pr['pageInfo']['hasNextPage']: c=pr['pageInfo']['endCursor']
        else: break
print('to process:',len(items))
summary=[]; thumbs={}
for pt,h,u in items:
    try:
        raw=urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'})).read()
        im=Image.open(io.BytesIO(raw)).convert('RGB')
        ci,mv,info=process(im); ci.save(OUT/f'fixed_{h}.png')
        summary.append({'type':pt,'handle':h,**info})
        def th(x,s=230):
            x=x.copy(); x.thumbnail((s,s)); return x
        thumbs[h]=(th(im),th(ci),(Image.fromarray((mv*255).astype('uint8')).convert('RGB') if mv is not None else None),info)
        print(f"  [{pt[:4]}] {h:<40} {'FLAT' if info['flat'] else 'mask cov='+str(info['cov'])} bottom={info['bottom']} flags={info['flags']}")
    except Exception as e:
        print(f"  [{pt[:4]}] {h:<40} ERROR {e}"); summary.append({'type':pt,'handle':h,'error':str(e)})
(OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=1),encoding='utf-8')

# montages: risky first (masked or flagged); then build files of <=16 rows
risky=[s for s in summary if 'error' not in s and (not s['flat'] or s['flags'])]
def montage(rows,name):
    TH=230; cw=TH+12; H=(TH+30)*len(rows)+10
    cv=Image.new('RGB',(cw*3+16,H),(250,250,250)); d=ImageDraw.Draw(cv)
    for i,s in enumerate(rows):
        h=s['handle']; y=24+i*(TH+30); o,c,m,info=thumbs[h]
        d.text((8,y-16),f"{h} [{s['type']}] {'FLAT' if s['flat'] else 'cov='+str(s['cov'])} flags={s['flags']}",fill=(180,0,0) if s['flags'] else (0,0,0))
        cv.paste(o,(6,y)); cv.paste(c,(cw+6,y))
        if m is not None: mt=m.copy(); mt.thumbnail((TH,TH)); cv.paste(mt,(2*cw+6,y))
    cv.save(OUT/name); print('montage',name,len(rows),'rows')
risky.sort(key=lambda s:(0 if s['flags'] else 1))
for i in range(0,len(risky),16): montage(risky[i:i+16],f'montage_risky_{i//16}.png')
flatok=[s for s in summary if 'error' not in s and s['flat'] and not s['flags']]
print(f"\\nFLAT+clean (low-risk, bottom->target): {len(flatok)}")
print(f"RISKY/flagged (need eyes): {len(risky)}")
for s in summary:
    if s.get('flags'): print('  FLAG', s['handle'], s['flags'])
