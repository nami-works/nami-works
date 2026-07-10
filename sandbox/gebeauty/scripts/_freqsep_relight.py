"""Merge relit lighting (low-freq) with original sharp detail/text (high-freq) via frequency
separation, then neutralize background to the exact #ecede9 card tone. Text-safe relight."""
import urllib.request, io, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
sys.stdout.reconfigure(encoding='utf-8')
REGEN=Path('c:/Users/Lucas Guimarães/Desktop/nami-works/sandbox/gebeauty/hero-validation-regen')
TARGET=np.array([236,237,233],float); R=22
JOBS={
 'kit-reconstrucao-leveza':('https://cdn.shopify.com/s/files/1/0807/8344/2240/files/kit_reconstrucao_leveza.png','https://pikaso.cdnpk.net/private/production/4757589302/render.png?token=exp=1783296000~hmac=5ec98d7a75a130f5d2f822c9e065763ac9505b163f2728b8559e69063384e025'),
 'kit-finalizacao-com-brilho-1':('https://cdn.shopify.com/s/files/1/0807/8344/2240/files/kit-finalizacao-com-brilho-1.png','https://pikaso.cdnpk.net/private/production/4758603694/render.png?token=exp=1783296000~hmac=4ad89e83eab662a78c9ca5f0b799776db69a8b50df81268014dc2fdafbd995b3'),
 'kit-beach-hair':('https://cdn.shopify.com/s/files/1/0807/8344/2240/files/KITBEACH_801d1e04-9157-4306-af53-0f9ff5cacddf.png','https://pikaso.cdnpk.net/private/production/4758604665/render.png?token=exp=1783296000~hmac=bee7961c112b34bf3d7c77c584de72371aa7b616206ac687f9deed21deedb339'),
 'kit-cabelo-renovado':('https://cdn.shopify.com/s/files/1/0807/8344/2240/products/kit-cabelo-renovado-1.jpg','https://pikaso.cdnpk.net/private/production/4758604893/render.png?token=exp=1783296000~hmac=51ae69a69e8f47e3839f4eb45227d6d6a80054a711386189148b8682f3f5d727'),
}
def dl(u): return Image.open(io.BytesIO(urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'})).read())).convert('RGB')
def gb(a,rr): return np.stack([np.asarray(Image.fromarray(a[...,c].astype('uint8')).filter(ImageFilter.GaussianBlur(rr)),float) for c in range(3)],-1)
def neutralize(a):
    H,W,_=a.shape
    border=np.concatenate([a[0],a[-1],a[:,0],a[:,-1]],0); bmean=border.mean(0); bstd=border.std(0)
    if bstd.max()<8 and np.abs(TARGET-bmean).max()<18:
        out=a+(TARGET-bmean)
    else:
        work=Image.fromarray(np.clip(a,0,255).astype('uint8')); S=(255,0,255)
        for s in [(0,0),(W-1,0),(0,H-1),(W-1,H-1),(W//2,0),(W//2,H-1),(0,H//2),(W-1,H//2)]:
            try: ImageDraw.floodfill(work,s,S,thresh=46)
            except: pass
        m=(np.all(np.asarray(work)==np.array(S),-1)).astype('uint8')*255
        mask=np.clip(np.asarray(Image.fromarray(m).filter(ImageFilter.GaussianBlur(3)),float)/255,0,1)
        m3=np.dstack([mask]*3); rr=max(20,W//12)
        Bloc=gb(np.clip(a*m3,0,255),rr)/np.clip(np.asarray(Image.fromarray((mask*255).astype('uint8')).filter(ImageFilter.GaussianBlur(rr)),float)/255,1e-3,None)[...,None]
        out=a+(TARGET-Bloc)*m3
    band=max(2,H//60); ramp=np.linspace(0,1,band)[:,None,None]; out[H-band:]=out[H-band:]*(1-ramp)+TARGET*ramp
    return np.clip(out,0,255)
for h,(ou,lu) in JOBS.items():
    o=dl(ou); l=dl(lu)
    if l.size!=o.size: l=l.resize(o.size,Image.LANCZOS)
    o=np.asarray(o,float); l=np.asarray(l,float)
    merge=gb(l,R)+(o-gb(o,R))
    out=neutralize(merge)
    Image.fromarray(out.astype('uint8')).save(REGEN/f'{h}.png')
    print(h,'done',o.shape[1],'x',o.shape[0],'bottom',out[-1].mean(0).round(1))
