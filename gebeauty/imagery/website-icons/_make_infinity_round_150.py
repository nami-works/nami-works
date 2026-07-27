import math
from PIL import Image, ImageDraw
SIZE=512; F=4; W=SIZE*F
RED=(223,54,48,255); CX=256; CY=256
OUT="new_icons"; import os; os.makedirs(OUT,exist_ok=True)
def canvas(): img=Image.new("RGBA",(W,W),(0,0,0,0)); return img, ImageDraw.Draw(img)
def S(v): return int(round(v*F))
def Sf(v): return v*F
def ring(d,cx,cy,r,w): d.ellipse([Sf(cx-r),Sf(cy-r),Sf(cx+r),Sf(cy+r)],outline=RED,width=S(w))
def poly(d,pts,w,closed=False):
    P=[(Sf(x),Sf(y)) for x,y in pts]
    if closed: P=P+[P[0]]
    d.line(P,fill=RED,width=S(w),joint="curve")
def bez(p0,p1,p2,p3,n=24):
    o=[]
    for i in range(n+1):
        t=i/n; u=1-t
        o.append((u*u*u*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t*t*t*p3[0],
                  u*u*u*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t*t*t*p3[1]))
    return o
def finish(img,name): s=img.resize((SIZE,SIZE),Image.LANCZOS); s.save(f"{OUT}/{name}.png"); return s
RING_R=244; RING_W=11

def P(c,r,ang_deg):  # point on circle, y-down, ang measured CCW from +x
    a=math.radians(ang_deg); return (c[0]+r*math.cos(a), c[1]-r*math.sin(a))
def arc(c,r,a0,a1,step):
    pts=[]; a=a0
    if a0>a1:
        while a>=a1: pts.append(P(c,r,a)); a-=step
    else:
        while a<=a1: pts.append(P(c,r,a)); a+=step
    return pts

def infinity_v3():
    img,d=canvas(); ring(d,CX,CY,RING_R,RING_W)
    s=78; r=74; LW=14
    Rc=(CX+s,CY); Lc=(CX-s,CY)
    # right loop: outer arc from 130 deg CW down to -130 deg (gap faces center/left)
    RUI=P(Rc,r,130); RLI=P(Rc,r,-130)
    right=arc(Rc,r,130,-130,4)
    # left loop: outer arc from 50 deg CCW up to 310 deg (gap faces center/right)
    LUI=P(Lc,r,50); LLI=P(Lc,r,310)
    left=arc(Lc,r,50,310,4)
    # smooth crossing connectors through center (bezier pulled toward O)
    O=(CX,CY)
    c_RLI_LUI=bez(RLI,(RLI[0]*0.45+O[0]*0.55, RLI[1]*0.45+O[1]*0.55),
                      (LUI[0]*0.45+O[0]*0.55, LUI[1]*0.45+O[1]*0.55),LUI,20)
    c_LLI_RUI=bez(LLI,(LLI[0]*0.45+O[0]*0.55, LLI[1]*0.45+O[1]*0.55),
                      (RUI[0]*0.45+O[0]*0.55, RUI[1]*0.45+O[1]*0.55),RUI,20)
    path=right+c_RLI_LUI[1:]+left+c_LLI_RUI[1:]
    poly(d,path,LW,closed=True)
    return finish(img,"ritual-completo-infinito-v3")

inf=infinity_v3(); print("v3 done")
def load(p): return Image.open(p).convert("RGBA").resize((SIZE,SIZE),Image.LANCZOS)
order=[("v1-OLD",load("new_icons/ritual-completo-infinito.png")),
       ("v2-gerono-tall",load("new_icons/ritual-completo-infinito-v2.png")),
       ("v3-round-loops-NEW",inf),
       ("hourglass",load("new_icons/efeito-duradouro-ampulheta.png"))]
cell=SIZE+20
sheet=Image.new("RGBA",(len(order)*cell,cell+SIZE//2+SIZE//4+40),(255,255,255,255))
for i,(k,im) in enumerate(order):
    sheet.alpha_composite(im,(i*cell+10,10))
    sheet.alpha_composite(im.resize((SIZE//2,SIZE//2),Image.LANCZOS),(i*cell+10,cell))
    sheet.alpha_composite(im.resize((SIZE//4,SIZE//4),Image.LANCZOS),(i*cell+10,cell+SIZE//2+10))
sheet.convert("RGB").save("infinity_v3_qa.png"); print("qa saved")
