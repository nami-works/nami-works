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
def bez(p0,p1,p2,p3,n=30):
    o=[]
    for i in range(n+1):
        t=i/n; u=1-t
        o.append((u*u*u*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t*t*t*p3[0],
                  u*u*u*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t*t*t*p3[1]))
    return o
def finish(img,name): s=img.resize((SIZE,SIZE),Image.LANCZOS); s.save(f"{OUT}/{name}.png"); return s
RING_R=244; RING_W=11
def P(c,r,ang): a=math.radians(ang); return (c[0]+r*math.cos(a), c[1]-r*math.sin(a))
def arc(c,r,a0,a1,step):
    pts=[]; a=a0
    if a0>a1:
        while a>=a1: pts.append(P(c,r,a)); a-=step
    else:
        while a<=a1: pts.append(P(c,r,a)); a+=step
    return pts
def tdir(ang, cw):
    a=math.radians(ang); return (math.sin(a), math.cos(a)) if cw else (-math.sin(a), -math.cos(a))

def inf(s=72, r=66, g=48, L=40, LW=14, name="inf"):
    # loops drawn as C's (inner arc near 180/0 left OUT); crossover via 2 crossing connectors
    img,d=canvas(); ring(d,CX,CY,RING_R,RING_W)
    Rc=(CX+s,CY); Lc=(CX-s,CY)
    aR0=180-g; aR1=-(180-g)          # right C from (180-g) CW down to -(180-g)
    RUI=P(Rc,r,aR0); RLI=P(Rc,r,aR1)
    right=arc(Rc,r,aR0,aR1,4)
    aL0=g; aL1=360-g                 # left C from g CCW up to (360-g)
    LUI=P(Lc,r,aL0); LLI=P(Lc,r,aL1)
    left=arc(Lc,r,aL0,aL1,4)
    # tangential crossing connectors that actually cross at center
    dRLI=tdir(aR1,True); dLUI=tdir(aL0,False)
    c_RL=bez(RLI,(RLI[0]+dRLI[0]*L,RLI[1]+dRLI[1]*L),(LUI[0]-dLUI[0]*L,LUI[1]-dLUI[1]*L),LUI,30)
    dLLI=tdir(aL1,False); dRUI=tdir(aR0,True)
    c_LR=bez(LLI,(LLI[0]+dLLI[0]*L,LLI[1]+dLLI[1]*L),(RUI[0]-dRUI[0]*L,RUI[1]-dRUI[1]*L),RUI,30)
    path=right+c_RL[1:]+left+c_LR[1:]
    poly(d,path,LW,closed=True)
    return finish(img,name)

# larger inner gap g so loop inner edges stay OFF-center; tune L for soft-but-real crossover
v={}
v['a']=inf(s=72,r=66,g=52,L=34,name="inf-v5-a")
v['b']=inf(s=72,r=66,g=52,L=46,name="inf-v5-b")
v['c']=inf(s=68,r=68,g=58,L=44,name="inf-v5-c")
print("rendered")
def load(p): return Image.open(p).convert("RGBA").resize((SIZE,SIZE),Image.LANCZOS)
order=[("v3-sharp",load("new_icons/ritual-completo-infinito-v3.png")),
       ("v5a g52 L34",v['a']),("v5b g52 L46",v['b']),("v5c g58 L44",v['c'])]
cell=SIZE+20
sheet=Image.new("RGBA",(len(order)*cell,cell+SIZE//2+SIZE//4+40),(255,255,255,255))
for i,(k,im) in enumerate(order):
    sheet.alpha_composite(im,(i*cell+10,10))
    sheet.alpha_composite(im.resize((SIZE//2,SIZE//2),Image.LANCZOS),(i*cell+10,cell))
    sheet.alpha_composite(im.resize((SIZE//4,SIZE//4),Image.LANCZOS),(i*cell+10,cell+SIZE//2+10))
sheet.convert("RGB").save("infinity_v5_qa.png"); print("qa saved")
