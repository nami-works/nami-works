import math
from PIL import Image, ImageDraw
SIZE=512; F=4; W=SIZE*F
RED=(223,54,48,255); CX=256; CY=256
OUT="new_icons"; import os; os.makedirs(OUT,exist_ok=True)
def canvas(): img=Image.new("RGBA",(W,W),(0,0,0,0)); return img, ImageDraw.Draw(img)
def S(v): return int(round(v*F))
def Sf(v): return v*F
def dot(d,cx,cy,r): d.ellipse([Sf(cx-r),Sf(cy-r),Sf(cx+r),Sf(cy+r)],fill=RED)
def ring(d,cx,cy,r,w): d.ellipse([Sf(cx-r),Sf(cy-r),Sf(cx+r),Sf(cy+r)],outline=RED,width=S(w))
def poly(d,pts,w,closed=False):
    P=[(Sf(x),Sf(y)) for x,y in pts]
    if closed: P=P+[P[0]]
    d.line(P,fill=RED,width=S(w),joint="curve")
def finish(img,name): s=img.resize((SIZE,SIZE),Image.LANCZOS); s.save(f"{OUT}/{name}.png"); return s
RING_R=244; RING_W=11

# 1. ROUNDER infinity: Gerono figure-eight with fat lobes (big tip curvature) => softer, less pinched
def infinity_round():
    img,d=canvas(); ring(d,CX,CY,RING_R,RING_W)
    A=104; C=156; LW=15  # C>A -> rounder tips (tip radius = C^2/A ~ 234); fuller lobes
    pts=[]; N=300
    for i in range(N+1):
        t=2*math.pi*i/N
        pts.append((CX+A*math.cos(t), CY+C*math.sin(t)*math.cos(t)))
    poly(d,pts,LW,closed=True)
    return finish(img,"ritual-completo-infinito-v2")

# 2. HOURGLASS = infinity rotated 90 deg (vertical figure-eight) + falling sand grains
def hourglass():
    img,d=canvas(); ring(d,CX,CY,RING_R,RING_W)
    Ah=150; Cw=104; LW=14   # Ah vertical half-height (fat lobes), Cw waist->lobe width
    pts=[]; N=300
    for i in range(N+1):
        t=2*math.pi*i/N
        # rotated: y is the cos axis (vertical), x is the sin*cos axis (waist)
        pts.append((CX+Cw*math.sin(t)*math.cos(t), CY+Ah*math.cos(t)))
    poly(d,pts,LW,closed=True)
    # sand grains falling through the waist into the lower bulb
    dot(d,256,258,5)   # at waist
    dot(d,254,292,6)   # falling
    dot(d,260,320,6)   # falling
    dot(d,250,342,5); dot(d,264,344,5)  # settling in lower bulb
    return finish(img,"efeito-duradouro-ampulheta")

inf=infinity_round(); hg=hourglass(); print("generated v2 infinity + hourglass")
def load(p): return Image.open(p).convert("RGBA").resize((SIZE,SIZE),Image.LANCZOS)
order=[("infinity-OLD",load("new_icons/ritual-completo-infinito.png")),
       ("infinity-ROUNDER-NEW",inf),
       ("hidratacao(ref)",load("icon150/hidratacao.png")),
       ("hourglass-NEW",hg)]
cell=SIZE+20
sheet=Image.new("RGBA",(len(order)*cell,cell+SIZE//2+SIZE//4+40),(255,255,255,255))
for i,(k,im) in enumerate(order):
    sheet.alpha_composite(im,(i*cell+10,10))
    sheet.alpha_composite(im.resize((SIZE//2,SIZE//2),Image.LANCZOS),(i*cell+10,cell))
    sheet.alpha_composite(im.resize((SIZE//4,SIZE//4),Image.LANCZOS),(i*cell+10,cell+SIZE//2+10))
sheet.convert("RGB").save("icons2_qa.png"); print("qa saved")
