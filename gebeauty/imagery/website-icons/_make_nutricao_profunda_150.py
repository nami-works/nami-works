import math
from PIL import Image, ImageDraw

SIZE=512; F=4; W=SIZE*F
RED=(223,54,48,255)
CX=256; CY=256
OUT="new_icons"
import os; os.makedirs(OUT,exist_ok=True)

def canvas():
    img=Image.new("RGBA",(W,W),(0,0,0,0)); return img, ImageDraw.Draw(img)
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
    out=[]
    for i in range(n+1):
        t=i/n; u=1-t
        out.append((u*u*u*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t*t*t*p3[0],
                    u*u*u*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t*t*t*p3[1]))
    return out
def finish(img,name):
    small=img.resize((SIZE,SIZE),Image.LANCZOS); small.save(f"{OUT}/{name}.png"); return small

RING_R=244; RING_W=11; MW=11

def teardrop(cx,cyb,R,H):
    # bottom semicircle leftmid->bottom->rightmid (angles 180..360)
    arc=[]
    for a in range(180,361,6):
        arc.append((cx+R*math.cos(math.radians(a)), cyb - R*math.sin(math.radians(a))))
    leftmid=(cx-R,cyb); rightmid=(cx+R,cyb); top=(cx, cyb-H)
    right_up=bez(rightmid,(cx+R*0.95, cyb-H*0.42),(cx+R*0.32, cyb-H*0.82), top,30)
    left_dn=bez(top,(cx-R*0.32, cyb-H*0.82),(cx-R*0.95, cyb-H*0.42), leftmid,30)
    return arc+right_up[1:]+left_dn[1:]

def nutricao_profunda():
    img,d=canvas(); ring(d,CX,CY,RING_R,RING_W)
    # wavy hair strand (left of center)
    strand=[(196+26*math.sin(2*math.pi*1.15*(t/244)), 138+t) for t in range(0,245,6)]
    poly(d,strand,MW,caps=True)
    # nourishing droplet (right, hero)
    cx,cyb,R,H=318,268,58,132
    td=teardrop(cx,cyb,R,H)
    poly(d,td,MW,closed=True,caps=False)
    # inner shine line (upper-left of droplet)
    shine=bez((cx-30,cyb+2),(cx-38,cyb-24),(cx-24,cyb-46),(cx-6,cyb-60),24)
    poly(d,shine,7,caps=True)
    return finish(img,"nutricao-profunda")

new=nutricao_profunda()
print("generated nutricao-profunda")

# QA sheet: set context — protecao-termica(reuse), hidratacao(droplet family), old nutricao, NEW
def load(p): return Image.open(p).convert("RGBA").resize((SIZE,SIZE),Image.LANCZOS)
order=[("protecao-termica",load("icon150/protecao-termica.png")),
       ("hidratacao",load("icon150/hidratacao.png")),
       ("nutricao-OLD(slip)",load("icon150/nutricao.png")),
       ("nutricao-profunda-NEW",new)]
cell=SIZE+20
sheet=Image.new("RGBA",(len(order)*cell, cell+SIZE//2+SIZE//4+40),(255,255,255,255))
for i,(k,im) in enumerate(order):
    sheet.alpha_composite(im,(i*cell+10,10))
    sheet.alpha_composite(im.resize((SIZE//2,SIZE//2),Image.LANCZOS),(i*cell+10,cell))
    sheet.alpha_composite(im.resize((SIZE//4,SIZE//4),Image.LANCZOS),(i*cell+10,cell+SIZE//2+10))
sheet.convert("RGB").save("nutricao_qa.png")
print("qa saved")
