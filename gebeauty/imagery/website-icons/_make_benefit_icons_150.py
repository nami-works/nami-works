import math, numpy as np
from PIL import Image, ImageDraw, ImageFont

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
def bez(p0,p1,p2,p3,n=60):
    out=[]
    for i in range(n+1):
        t=i/n; u=1-t
        x=u*u*u*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t*t*t*p3[0]
        y=u*u*u*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t*t*t*p3[1]
        out.append((x,y))
    return out
def sine(x0,x1,y,amp,cycles,n=80,phase=0):
    return [(x0+(x1-x0)*i/n, y+amp*math.sin(phase+cycles*2*math.pi*i/n)) for i in range(n+1)]

def finish(img,name):
    small=img.resize((SIZE,SIZE),Image.LANCZOS)
    small.save(f"{OUT}/{name}.png")
    return small

RING_R=244; RING_W=11; MW=11  # motif weight matches ring

# ---------------- ICON 2: ritual completo (1-2-3) ----------------
def ritual():
    img,d=canvas(); ring(d,CX,CY,RING_R,RING_W)
    xs=[134,256,378]; y=256; r=54
    font=ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", S(66))
    for i,x in enumerate(xs):
        ring(d,x,y,r,10)
        ch=str(i+1)
        bb=d.textbbox((0,0),ch,font=font)
        tw=bb[2]-bb[0]; th=bb[3]-bb[1]
        d.text((Sf(x)-tw/2-bb[0], Sf(y)-th/2-bb[1]), ch, font=font, fill=RED)
    # chevrons between
    for x in [196,318]:
        poly(d,[(x-9,y-15),(x+9,y),(x-9,y+15)],9)
    return finish(img,"ritual-completo")

# ---------------- ICON 3: cabe na sua bolsa (pouch + mini bottle) ----------------
def bolsa():
    img,d=canvas()
    ring(d,CX,CY,RING_R,RING_W)
    # pouch (necessaire) left
    px0,py0,px1,py1=96,214,244,338; rad=30
    d.rounded_rectangle([Sf(px0),Sf(py0),Sf(px1),Sf(py1)],radius=S(rad),outline=RED,width=S(MW))
    # zipper line
    poly(d,[(px0+12,244),(px1-12,244)],8)
    # zipper pull
    dot(d,px1-6,244,7); poly(d,[(px1-6,244),(px1-6,262)],7)
    # small top loop/handle
    poly(d,bez((px0+42,214),(px0+52,190),(px1-52,190),(px1-42,214),40),8,caps=True)
    # mini bottle right
    bx0,bx1=300,360; body_top=250; body_bot=340; brad=14
    d.rounded_rectangle([Sf(bx0),Sf(body_top),Sf(bx1),Sf(body_bot)],radius=S(brad),outline=RED,width=S(MW))
    # cap
    d.rounded_rectangle([Sf(bx0+12),Sf(216),Sf(bx1-12),Sf(238)],radius=S(6),outline=RED,width=S(9))
    # neck connect
    poly(d,[(bx0+16,238),(bx0+16,250)],8); poly(d,[(bx1-16,238),(bx1-16,250)],8)
    # label line
    poly(d,[(bx0+10,300),(bx1-10,300)],7)
    return finish(img,"cabe-na-bolsa")

# ---------------- ICON 4: frescor que dura (breeze + strand + sparkle) ----------------
def frescor():
    img,d=canvas()
    ring(d,CX,CY,RING_R,RING_W)
    # hair strand: wavy vertical line
    strand=sine(0,0,0,0,0)  # placeholder
    pts=[(300+30*math.sin(2*math.pi*1.15*(t/230)), 140+t) for t in range(0,241,6)]
    poly(d,pts,MW,caps=True)
    # breeze waves (airflow) to the left
    for yy in [200,258,316]:
        w=sine(120,258,yy,11,1.15,70)
        poly(d,w,9,caps=True)
    # sparkle top-right (4-point star)
    def star(cx,cy,R,r):
        pp=[]
        for k in range(8):
            ang=math.pi/2 - k*math.pi/4
            rad=R if k%2==0 else r
            pp.append((cx+rad*math.cos(ang), cy-rad*math.sin(ang)))
        d.polygon([(Sf(x),Sf(y)) for x,y in pp],fill=RED)
    star(360,168,34,12)
    star(150,348,18,7)
    return finish(img,"frescor-que-dura")

# ---------------- ICON 5: mais dias de raiz leve (calendar + light leaf) ----------------
def diasleve():
    img,d=canvas()
    ring(d,CX,CY,RING_R,RING_W)
    # calendar body
    cx0,cy0,cx1,cy1=118,160,344,368; rad=22
    d.rounded_rectangle([Sf(cx0),Sf(cy0),Sf(cx1),Sf(cy1)],radius=S(rad),outline=RED,width=S(MW))
    # header divider
    poly(d,[(cx0,206),(cx1,206)],9)
    # binder rings
    for x in [168,294]:
        poly(d,[(x,138),(x,178)],9);
    # day dots grid (2 rows x 3 cols)
    for ry in [258,318]:
        for rx in [168,231,294]:
            dot(d,rx,ry,8)
    # light leaf bottom-right overlapping
    lx,ly=330,346
    tip=(372,300); base=(300,392)
    left=bez(base,(300,330),(338,306),tip,50)
    right=bez(tip,(360,340),(338,372),base,50)
    poly(d,left,9,caps=False); poly(d,right,9,caps=False)
    # midrib
    poly(d,[base,tip],7,caps=True)
    return finish(img,"mais-dias-raiz-leve")

icons={}
icons["ritual-completo"]=ritual()
icons["cabe-na-bolsa"]=bolsa()
icons["frescor-que-dura"]=frescor()
icons["mais-dias-raiz-leve"]=diasleve()
print("generated:", list(icons))

# QA contact sheet vs reused protecao-termica, at display + 48 + 24
ref=Image.open("icon150/protecao-termica.png").convert("RGBA").resize((SIZE,SIZE),Image.LANCZOS)
order=[("protecao-termica(reuse)",ref)]+[(k,v) for k,v in icons.items()]
cell=SIZE+20
sheet=Image.new("RGBA",(len(order)*cell, cell+ SIZE//2 + SIZE//4 + 60),(255,255,255,255))
for i,(k,im) in enumerate(order):
    sheet.alpha_composite(im,(i*cell+10,10))
    im48=im.resize((SIZE//2,SIZE//2),Image.LANCZOS); sheet.alpha_composite(im48,(i*cell+10,cell))
    im24=im.resize((SIZE//4,SIZE//4),Image.LANCZOS); sheet.alpha_composite(im24,(i*cell+10,cell+SIZE//2+10))
sheet.convert("RGB").save("new_icons_qa.png")
print("qa sheet saved")
