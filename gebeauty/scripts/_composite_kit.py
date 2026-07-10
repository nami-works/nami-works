"""Deterministic kit-hero compositor: place already-corrected component cutouts on the exact
#ecede9 card tone with unified soft contact shadows. Text-safe (no generative pass).
Usage: python _composite_kit.py <kit-handle>"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
sys.stdout.reconfigure(encoding='utf-8')
CUT=Path('C:/Users/LUCASG~1/AppData/Local/Temp/claude/c--Users-Lucas-Guimar-es-Desktop-nami-works/b4078ee5-bd3e-40ec-8f18-b2a031134f3e/scratchpad/cutouts')
REGEN=Path('c:/claude/gebeauty/hero-validation-regen')
C=2000; TARGET=np.array([236,237,233],float)
# spec: (cutout-name, center_x_frac, baseline_y_frac, height_frac)  in back-to-front order
SPECS={
 'kit-reconstrucao-leveza':[
   ('melon-mood',0.24,0.905,0.60),
   ('leave-in-pluma',0.47,0.905,0.62),
   ('mascara-mayday',0.71,0.915,0.185),
 ],
 'kit-beach-hair':[
   ('melon-mood',0.25,0.905,0.60),
   ('leave-in-pluma',0.70,0.905,0.60),
   ('booster-hidratante',0.455,0.915,0.30),
 ],
 'kit-finalizacao-com-brilho-1':[
   ('mascara-condicionadora',0.29,0.84,0.52),
   ('shampoo-sem-sulfato',0.50,0.82,0.58),
   ('leave-in-protecao',0.69,0.85,0.47),
   ('booster-hidratante',0.40,0.88,0.25),
   ('escova-oval',0.60,0.965,0.135),
 ],
}
def render(handle):
    spec=SPECS[handle]
    base=Image.new('RGB',(C,C),tuple(TARGET.astype(int)))
    shadow=Image.new('L',(C,C),0); sd=ImageDraw.Draw(shadow)
    placed=[]
    for name,cx,by,hf in spec:
        im=Image.open(CUT/f'{name}.png').convert('RGBA')
        h=int(hf*C); w=int(h*im.width/im.height)
        im=im.resize((w,h),Image.LANCZOS)
        x=int(cx*C-w/2); y=int(by*C-h)
        placed.append((im,x,y,w,h))
        # elliptical contact shadow on floor at base
        ecx=int(cx*C); ey=int(by*C); ew=int(w*0.62); eh=max(10,int(w*0.11))
        sd.ellipse([ecx-ew,ey-eh//2,ecx+ew,ey+eh//2],fill=70)
    shadow=shadow.filter(ImageFilter.GaussianBlur(26))
    sh=np.asarray(shadow,float)/255.0
    arr=np.asarray(base,float)*(1-sh[...,None]*0.55)
    base=Image.fromarray(np.clip(arr,0,255).astype('uint8')).convert('RGBA')
    for im,x,y,w,h in placed:
        base.alpha_composite(im,(x,y))
    out=base.convert('RGB'); a=np.asarray(out,float)
    band=max(2,C//60); ramp=np.linspace(0,1,band)[:,None,None]; a[C-band:]=a[C-band:]*(1-ramp)+TARGET*ramp
    Image.fromarray(np.clip(a,0,255).astype('uint8')).save(REGEN/f'{handle}.png')
    print(handle,'composited, bottom',np.asarray(Image.open(REGEN/f'{handle}.png'))[-1].mean(0).round(1))
render(sys.argv[1])
