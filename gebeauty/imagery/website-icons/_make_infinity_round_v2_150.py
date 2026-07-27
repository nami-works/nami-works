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
def bez(p0,p1,p2,p3,n=28):
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
    a=math.radians(ang)
    return (math.sin(a), math.cos(a)) if cw else (-math.sin(a), -math.cos(a))

def infinity_v4(L=52, name="ritual-completo-infinito-v4"):
    img,d=canvas(); ring(d,CX,CY,RING_R,RING_W)
    s=78; r=74; LW=14
    Rc=(CX+s,CY); Lc=(CX-s,CY)
    RUI=P(Rc,r,130); RLI=P(Rc,r,-130)
    LUI=P(Lc,r,50);  LLI=P(Lc,r,310)
    right=arc(Rc,r,130,-130,4)   # CW, RUI -> RLI
    left =arc(Lc,r,50,310,4)     # CCW, LUI -> LLI
    # crossing RLI -> LUI: leave right loop tangentially, arrive into left loop tangentially
    dRLI=tdir(-130,True)   # travel dir leaving right loop at RLI
    dLUI=tdir(50,False)    # travel dir of left loop at its start LUI (must match arrival)
    c_RL=bez(RLI,(RLI[0]+dRLI[0]*L, RLI[1]+dRLI[1]*L),
                 (LUI[0]-dLUI[0]*L, LUI[1]-dLUI[1]*L), LUI,28)
    # crossing LLI -> RUI
    dLLI=tdir(310,False)   # travel dir leaving left loop at LLI
    dRUI=tdir(130,True)    # travel dir of right loop at its start RUI (must match arrival)
    c_LR=bez(LLI,(LLI[0]+dLLI[0]*L, LLI[1]+dLLI[1]*L),
                 (RUI[0]-dRUI[0]*L, RUI[1]-dRUI[1]*L), RUI,28)
    path=right+c_RL[1:]+left+c_LR[1:]
    poly(d,path,LW,closed=True)
    return finish(img,name)

# try a couple L values to pick the smoothest crossing
variants={52:infinity_v4(52,"inf-v4-L52"), 64:infinity_v4(64,"inf-v4-L64"), 76:infinity_v4(76,"inf-v4-L76")}
print("rendered L variants")
def load(p): return Image.open(p).convert("RGBA").resize((SIZE,SIZE),Image.LANCZOS)
order=[("v3-sharp(old)",load("new_icons/ritual-completo-infinito-v3.png")),
       ("v4-L52",variants[52]),("v4-L64",variants[64]),("v4-L76",variants[76])]
cell=SIZE+20
sheet=Image.new("RGBA",(len(order)*cell,cell+SIZE//2+SIZE//4+40),(255,255,255,255))
for i,(k,im) in enumerate(order):
    sheet.alpha_composite(im,(i*cell+10,10))
    sheet.alpha_composite(im.resize((SIZE//2,SIZE//2),Image.LANCZOS),(i*cell+10,cell))
    sheet.alpha_composite(im.resize((SIZE//4,SIZE//4),Image.LANCZOS),(i*cell+10,cell+SIZE//2+10))
sheet.convert("RGB").save("infinity_v4_qa.png"); print("qa saved")
