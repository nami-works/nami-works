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
def Pe(c,rx,ry,ang): a=math.radians(ang); return (c[0]+rx*math.cos(a), c[1]-ry*math.sin(a))
def arce(c,rx,ry,a0,a1,step):
    pts=[]; a=a0
    if a0>a1:
        while a>=a1: pts.append(Pe(c,rx,ry,a)); a-=step
    else:
        while a<=a1: pts.append(Pe(c,rx,ry,a)); a+=step
    return pts
def tdire(ang, rx, ry, cw):
    a=math.radians(ang)
    v=(rx*math.sin(a), ry*math.cos(a)) if cw else (-rx*math.sin(a), -ry*math.cos(a))
    n=math.hypot(*v); return (v[0]/n, v[1]/n)

def inf_e(s, rx, ry, g, L, LW, name):
    img,d=canvas(); ring(d,CX,CY,RING_R,RING_W)
    Rc=(CX+s,CY); Lc=(CX-s,CY)
    aR0=180-g; aR1=-(180-g)
    RUI=Pe(Rc,rx,ry,aR0); RLI=Pe(Rc,rx,ry,aR1)
    right=arce(Rc,rx,ry,aR0,aR1,4)
    aL0=g; aL1=360-g
    LUI=Pe(Lc,rx,ry,aL0); LLI=Pe(Lc,rx,ry,aL1)
    left=arce(Lc,rx,ry,aL0,aL1,4)
    dRLI=tdire(aR1,rx,ry,True); dLUI=tdire(aL0,rx,ry,False)
    c_RL=bez(RLI,(RLI[0]+dRLI[0]*L,RLI[1]+dRLI[1]*L),(LUI[0]-dLUI[0]*L,LUI[1]-dLUI[1]*L),LUI,30)
    dLLI=tdire(aL1,rx,ry,False); dRUI=tdire(aR0,rx,ry,True)
    c_LR=bez(LLI,(LLI[0]+dLLI[0]*L,LLI[1]+dLLI[1]*L),(RUI[0]-dRUI[0]*L,RUI[1]-dRUI[1]*L),RUI,30)
    path=right+c_RL[1:]+left+c_LR[1:]
    poly(d,path,LW,closed=True)
    return finish(img,name)

# A: tighter/steeper (loops close, steep vertical X)
A=inf_e(s=56, rx=66, ry=66, g=44, L=34, LW=14, name="inf-optA-steep")
# B: wider/open (loops apart, broad flat crossover)
B=inf_e(s=86, rx=62, ry=62, g=62, L=56, LW=14, name="inf-optB-open")
# C: elongated lean oval loops (long horizontal figure-eight)
C=inf_e(s=72, rx=82, ry=52, g=52, L=48, LW=13, name="inf-optC-oval")
print("rendered A,B,C")
def load(p): return Image.open(p).convert("RGBA").resize((SIZE,SIZE),Image.LANCZOS)
order=[("CURRENT (cross)",load("new_icons/inf-v5-b.png")),
       ("A steep",A),("B open",B),("C oval",C)]
cell=SIZE+20
sheet=Image.new("RGBA",(len(order)*cell,cell+SIZE//2+SIZE//4+40),(255,255,255,255))
for i,(k,im) in enumerate(order):
    sheet.alpha_composite(im,(i*cell+10,10))
    sheet.alpha_composite(im.resize((SIZE//2,SIZE//2),Image.LANCZOS),(i*cell+10,cell))
    sheet.alpha_composite(im.resize((SIZE//4,SIZE//4),Image.LANCZOS),(i*cell+10,cell+SIZE//2+10))
sheet.convert("RGB").save("infinity_options_qa.png"); print("qa saved")
