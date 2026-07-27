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
def poly(d,pts,w,closed=False,caps=True):
    P=[(Sf(x),Sf(y)) for x,y in pts]
    if closed: P=P+[P[0]]
    d.line(P,fill=RED,width=S(w),joint="curve")
    if caps:
        for x,y in pts: dot(d,x,y,w/2.0)
def bez(p0,p1,p2,p3,n=40):
    o=[]
    for i in range(n+1):
        t=i/n; u=1-t
        o.append((u*u*u*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t*t*t*p3[0],
                  u*u*u*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t*t*t*p3[1]))
    return o
def finish(img,name): s=img.resize((SIZE,SIZE),Image.LANCZOS); s.save(f"{OUT}/{name}.png"); return s
RING_R=244; RING_W=11; MW=11

def teardrop(cx,cyb,R,H):
    arc=[(cx+R*math.cos(math.radians(a)), cyb-R*math.sin(math.radians(a))) for a in range(180,361,6)]
    leftmid=(cx-R,cyb); rightmid=(cx+R,cyb); top=(cx,cyb-H)
    ru=bez(rightmid,(cx+R*0.95,cyb-H*0.42),(cx+R*0.32,cyb-H*0.82),top,30)
    ld=bez(top,(cx-R*0.32,cyb-H*0.82),(cx-R*0.95,cyb-H*0.42),leftmid,30)
    return arc+ru[1:]+ld[1:]

# ---- pure clean drop (nutrição profunda) ----
def drop():
    img,d=canvas(); ring(d,CX,CY,RING_R,RING_W)
    cx,cyb,R,H=256,300,84,190
    poly(d,teardrop(cx,cyb,R,H),MW,closed=True,caps=False)
    # subtle shine
    poly(d,bez((cx-40,cyb+6),(cx-52,cyb-34),(cx-34,cyb-64),(cx-8,cyb-84),24),7,caps=True)
    return finish(img,"nutricao-profunda-drop")

# ---- two-leaf sprout (raiz leve por mais tempo) ----
def leaf(bx,by,tx,ty,wid,n=26):
    dx=tx-bx; dy=ty-by; L=math.hypot(dx,dy); ux,uy=dx/L,dy/L; px,py=-uy,ux
    pts=[]
    for i in range(n+1):
        t=i/n; off=wid*math.sin(math.pi*t); pts.append((bx+dx*t+px*off, by+dy*t+py*off))
    for i in range(n,-1,-1):
        t=i/n; off=wid*math.sin(math.pi*t); pts.append((bx+dx*t-px*off, by+dy*t-py*off))
    return pts
def sprout():
    img,d=canvas(); ring(d,CX,CY,RING_R,RING_W)
    # stem (gentle curve, rising)
    stem=bez((256,388),(250,330),(258,272),(256,214),40)
    poly(d,stem,MW,caps=True)
    # left leaf
    L=leaf(256,268,192,196,30); poly(d,L,10,closed=True,caps=False)
    poly(d,[(256,268),(200,202)],6,caps=True)
    # right leaf (slightly higher)
    R=leaf(256,250,322,182,32); poly(d,R,10,closed=True,caps=False)
    poly(d,[(256,250),(316,190)],6,caps=True)
    return finish(img,"raiz-leve-sprout")

drp=drop(); spr=sprout()
print("generated drop + sprout")
def load(p): return Image.open(p).convert("RGBA").resize((SIZE,SIZE),Image.LANCZOS)
order=[("hidratacao(ref)",load("icon150/hidratacao.png")),
       ("nutricao-drop-NEW",drp),
       ("sem-sulfato(ref leaf)",load("icon150/sem-sulfato.png")),
       ("raiz-leve-sprout-NEW",spr)]
cell=SIZE+20
sheet=Image.new("RGBA",(len(order)*cell,cell+SIZE//2+SIZE//4+40),(255,255,255,255))
for i,(k,im) in enumerate(order):
    sheet.alpha_composite(im,(i*cell+10,10))
    sheet.alpha_composite(im.resize((SIZE//2,SIZE//2),Image.LANCZOS),(i*cell+10,cell))
    sheet.alpha_composite(im.resize((SIZE//4,SIZE//4),Image.LANCZOS),(i*cell+10,cell+SIZE//2+10))
sheet.convert("RGB").save("final_qa.png"); print("qa saved")
