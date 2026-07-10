"""Neutralize a product hero's BACKGROUND to an exact target tone (#ecede9) while
preserving the product and the background's luminance/lighting. Deterministic (PIL+numpy).

Adaptive:
  - flat & near-target bg  -> global color shift (no mask)   [e.g. mascara mayday]
  - warm/non-uniform bg    -> product mask + normalized-convolution bg re-tone [e.g. kit]
Then hard-pins the bottom band to EXACTLY the target.

Run:  python _hero_bg_neutralize.py                 -> process the 2 test products, write montage
"""
import json, urllib.request, io, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
sys.stdout.reconfigure(encoding='utf-8')
OUT=Path("C:/Users/LUCASG~1/AppData/Local/Temp/claude/c--claude/b4078ee5-bd3e-40ec-8f18-b2a031134f3e/scratchpad")
TOKEN=None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='): TOKEN=line.strip().split('=',1)[1]
URL='https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json'
TARGET=np.array([236,237,233],float)  # #ecede9

def gql(q,v=None):
    body=json.dumps({'query':q,**({'variables':v} if v else {})}).encode()
    req=urllib.request.Request(URL,data=body,headers={'Content-Type':'application/json','X-Shopify-Access-Token':TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode())
def hero_url(h):
    q='query($q:String){ products(first:1, query:$q){ nodes{ media(first:1){ nodes{ ... on MediaImage { image{ url } } } } } } }'
    return gql(q,{'q':'handle:'+h})['data']['products']['nodes'][0]['media']['nodes'][0]['image']['url']
def load_full(u):
    raw=urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'})).read()
    return Image.open(io.BytesIO(raw)).convert('RGB')

def gblur_u8(arr_u8, radius):
    return np.asarray(Image.fromarray(arr_u8).filter(ImageFilter.GaussianBlur(radius)),float)

def bg_mask(im):
    W,H=im.size; work=im.copy(); SENT=(255,0,255)
    seeds=[(0,0),(W-1,0),(0,H-1),(W-1,H-1),(W//2,0),(W//2,H-1),(0,H//2),(W-1,H//2),(W//4,0),(3*W//4,0)]
    for s in seeds:
        try: ImageDraw.floodfill(work,s,SENT,thresh=46)
        except Exception: pass
    m=(np.all(np.asarray(work)==np.array(SENT),axis=-1)).astype('uint8')*255
    m=gblur_u8(m,3)/255.0            # feather
    return np.clip(m,0,1)

def process(im):
    a=np.asarray(im,float); H,W,_=a.shape
    border=np.concatenate([a[0],a[-1],a[:,0],a[:,-1]],axis=0)
    bmean=border.mean(0); bstd=border.std(0)
    flat = bstd.max()<6 and np.abs(TARGET-bmean).max()<12
    info={'flat':bool(flat),'border_mean':bmean.round(1).tolist(),'border_std':bstd.round(1).tolist()}
    if flat:
        out=a+(TARGET-bmean)
        maskvis=None
    else:
        mask=bg_mask(im); m3=np.dstack([mask]*3)
        r=max(20,W//12)
        num=gblur_u8(np.clip(a*m3,0,255).astype('uint8'),r)
        den=gblur_u8((mask*255).astype('uint8'),r)/255.0
        den=np.clip(den,1e-3,None)[...,None]
        Bloc=num/den
        out=a+(TARGET-Bloc)*m3       # shift bg only (feathered); product untouched
        maskvis=mask
        info['bg_coverage']=round(float(mask.mean()),3)
    # hard-pin bottom band to EXACT target (feathered up)
    band=max(2,H//60); ramp=np.linspace(0,1,band)[:,None,None]
    out[H-band:]=out[H-band:]*(1-ramp)+TARGET*ramp
    out=np.clip(out,0,255).astype('uint8')
    ci=Image.fromarray(out)
    info['bottom_row_after']=np.asarray(ci)[-1].mean(0).round(1).tolist()
    return ci, maskvis, info

def thumb(im,sz=340):
    im=im.copy(); im.thumbnail((sz,sz)); return im

PRODUCTS=['mascara-mayday','kit-travel-size']
rows=[]
for h in PRODUCTS:
    u=hero_url(h); im=load_full(u)
    ci,mv,info=process(im)
    ci.save(OUT/f'hero_fixed_{h}.png')
    extra = f" bg_cov={info.get('bg_coverage')}" if not info['flat'] else ""
    print(f"== {h} ({im.size[0]}x{im.size[1]}) flat={info['flat']} border_mean={info['border_mean']} bottom_after={info['bottom_row_after']} target={TARGET.tolist()}{extra}")
    rows.append((h,thumb(im),thumb(ci), (Image.fromarray((mv*255).astype('uint8')) if mv is not None else None)))

# montage
TH=340; PADT=22; cols=3; cw=TH+14
canvas=Image.new('RGB',(cw*cols+20, (TH+PADT+14)*len(rows)+40),(250,250,250))
d=ImageDraw.Draw(canvas)
d.text((10,6),'ORIGINAL',fill=(0,0,0)); d.text((cw+10,6),'CORRECTED (bg -> #ecede9)',fill=(0,120,0)); d.text((2*cw+10,6),'BG MASK (white=bg)',fill=(0,0,180))
# target swatch
d.rectangle([2*cw+180,4,2*cw+210,18],fill=(236,237,233),outline=(0,0,0))
for i,(h,orig,corr,mask) in enumerate(rows):
    y=30+i*(TH+PADT+14)
    d.text((10,y),h,fill=(0,0,0))
    canvas.paste(orig,(6,y+PADT)); canvas.paste(corr,(cw+6,y+PADT))
    if mask is not None:
        mt=mask.convert('RGB'); mt.thumbnail((TH,TH)); canvas.paste(mt,(2*cw+6,y+PADT))
    else:
        d.text((2*cw+10,y+PADT+150),'(flat bg: global shift, no mask)',fill=(120,120,120))
canvas.save(OUT/'hero_neutralize_montage.png')
print('\\nsaved montage:', OUT/'hero_neutralize_montage.png')
