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

def infinity():
    img,d=canvas(); ring(d,CX,CY,RING_R,RING_W)
    A=126; LW=13
    pts=[]
    N=260
    for i in range(N+1):
        t=2*math.pi*i/N
        x=A*math.cos(t)
        y=A*math.sin(t)*math.cos(t)   # Gerono lemniscate -> figure eight
        pts.append((CX+x, CY+y))
    poly(d,pts,LW,closed=True)
    # round the crossing/terminals visually: dots at the two lobe extremes not needed (closed curve)
    return finish(img,"ritual-completo-infinito")

inf=infinity(); print("generated infinity")
def load(p): return Image.open(p).convert("RGBA").resize((SIZE,SIZE),Image.LANCZOS)
order=[("hidratacao(ref)",load("icon150/hidratacao.png")),
       ("protecao-termica(ref)",load("icon150/protecao-termica.png")),
       ("ritual-3circles-OLD",load("new_icons/ritual-completo.png")),
       ("infinity-NEW",inf)]
cell=SIZE+20
sheet=Image.new("RGBA",(len(order)*cell,cell+SIZE//2+SIZE//4+40),(255,255,255,255))
for i,(k,im) in enumerate(order):
    sheet.alpha_composite(im,(i*cell+10,10))
    sheet.alpha_composite(im.resize((SIZE//2,SIZE//2),Image.LANCZOS),(i*cell+10,cell))
    sheet.alpha_composite(im.resize((SIZE//4,SIZE//4),Image.LANCZOS),(i*cell+10,cell+SIZE//2+10))
sheet.convert("RGB").save("infinity_qa.png"); print("qa saved")
