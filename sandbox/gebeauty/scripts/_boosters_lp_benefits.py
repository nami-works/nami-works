"""Boosters LP sell-first: populate custom.beneficio_em_destaque_1/2/3 (text) +
custom.imagem_beneficio_em_destaque_1/2/3 (transparent icons) on all 5 boosters.
Uploads the 1 new 'oleosidade' icon; reuses existing transparent library icons for the rest.
Fixes Fortificante's WhatsApp-JPG benefit images. Idempotent (metafieldsSet + skip-by-alt).
"""
import os, io, json, time, requests
from pathlib import Path
from dotenv import load_dotenv
from PIL import Image

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
D=os.environ["SHOPIFY_SHOP_DOMAIN"]; T=os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]; V=os.environ.get("SHOPIFY_API_VERSION","2024-10")
U=f"https://{D}/admin/api/{V}/graphql.json"; H={"X-Shopify-Access-Token":T,"Content-Type":"application/json"}
SC=Path(r"C:/Users/LUCASG~1/AppData/Local/Temp/claude/c--Users-Lucas-Guimar-es-Desktop-nami-works/0823b26b-fda8-4dcd-b164-b799bf85aa82/scratchpad")
OLE_URL="https://pikaso.cdnpk.net/private/production/4817801533/render.png?token=exp=1783814400~hmac=251cbeb7b700332b19921be754a3fe21d4e842f5b350dc2e712e90fdfa5f8fdc"

def gql(q,v=None):
    r=requests.post(U,headers=H,json={"query":q,"variables":v or {}}).json()
    if "errors" in r: raise RuntimeError(json.dumps(r["errors"],ensure_ascii=False))
    return r["data"]

def norm(png,size=420,margin=0.08):
    im=Image.open(io.BytesIO(png)).convert("RGBA"); bb=im.split()[3].getbbox()
    if bb: im=im.crop(bb)
    assert im.split()[3].getextrema()[0]==0, "not transparent"
    side=max(im.size); pad=int(side*margin)
    c=Image.new("RGBA",(side+2*pad,side+2*pad),(0,0,0,0))
    c.paste(im,((c.width-im.width)//2,(c.height-im.height)//2),im)
    c=c.resize((size,size),Image.LANCZOS); b=io.BytesIO(); c.save(b,"PNG"); return b.getvalue()

def existing(alt):
    d=gql('query($q:String!){files(first:5,query:$q){nodes{... on MediaImage{id alt}}}}',{"q":f"alt:'{alt}'"})
    for n in d["files"]["nodes"]:
        if n and n.get("alt")==alt: return n["id"]
    return None

def upload(data,fn,alt):
    hit=existing(alt)
    if hit: print(f"  [skip] {alt}"); return hit
    su=gql('''mutation($i:[StagedUploadInput!]!){stagedUploadsCreate(input:$i){stagedTargets{url resourceUrl parameters{name value}}userErrors{message}}}''',
           {"i":[{"filename":fn,"mimeType":"image/png","httpMethod":"POST","resource":"FILE"}]})
    t=su["stagedUploadsCreate"]["stagedTargets"][0]
    requests.post(t["url"],data=[(p["name"],p["value"]) for p in t["parameters"]],files={"file":(fn,data,"image/png")}).raise_for_status()
    fc=gql('''mutation($f:[FileCreateInput!]!){fileCreate(files:$f){files{id}userErrors{message}}}''',
           {"f":[{"originalSource":t["resourceUrl"],"contentType":"IMAGE","alt":alt}]})
    if fc["fileCreate"]["userErrors"]: raise RuntimeError(json.dumps(fc["fileCreate"]["userErrors"]))
    fid=fc["fileCreate"]["files"][0]["id"]
    for _ in range(30):
        n=gql('query($id:ID!){node(id:$id){... on MediaImage{fileStatus}}}',{"id":fid})["node"]
        if n["fileStatus"]=="READY": print(f"  [up] {alt} -> {fid}"); return fid
        time.sleep(2)
    raise RuntimeError("not ready")

# icon MediaImage ids (existing transparent library + my 3 generated booster icons)
IC={
 "antifrizz":"gid://shopify/MediaImage/43792288579904",
 "fortificante":"gid://shopify/MediaImage/43792290185536",
 "antioxidante":"gid://shopify/MediaImage/43792291627328",
 "hidratacao":"gid://shopify/MediaImage/41609321775424",
 "cachos":"gid://shopify/MediaImage/41610642358592",
 "brilho":"gid://shopify/MediaImage/41609336422720",
 "termica":"gid://shopify/MediaImage/41609342583104",
 "pluma":"gid://shopify/MediaImage/41609300738368",
}

def main():
    IC["oleosidade"]=upload(norm(requests.get(OLE_URL).content),"booster-oleosidade-icone-lp.png","booster oleosidade icone lp")
    # (benefit_text, icon_key) x3 per booster
    B={
     "booster-antifrizz":[("menos frizz e volume","antifrizz"),("proteção térmica","termica"),("brilho e maciez","brilho")],
     "booster-fortificante":[("fios mais fortes","fortificante"),("controla a oleosidade","oleosidade"),("brilho sem pesar","pluma")],
     "booster-hidratante":[("hidratação profunda","hidratacao"),("maciez e leveza","pluma"),("brilho sem pesar","brilho")],
     "booster-definicao":[("definição até 12h","cachos"),("textura e movimento","pluma"),("protege da umidade","termica")],
     "booster-antioxidante":[("proteção sol e poluição","antioxidante"),("cor que dura","brilho"),("hidratação preservada","hidratacao")],
    }
    for h,items in B.items():
        gid=gql('query($h:String!){productByHandle(handle:$h){id}}',{"h":h})["productByHandle"]["id"]
        sets=[]
        for i,(txt,ic) in enumerate(items,1):
            sets.append({"ownerId":gid,"namespace":"custom","key":f"beneficio_em_destaque_{i}","type":"single_line_text_field","value":txt})
            sets.append({"ownerId":gid,"namespace":"custom","key":f"imagem_beneficio_em_destaque_{i}","type":"file_reference","value":IC[ic]})
        r=gql('''mutation($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){metafields{key}userErrors{field message}}}''',{"m":sets})
        if r["metafieldsSet"]["userErrors"]: raise RuntimeError(json.dumps(r["metafieldsSet"]["userErrors"],ensure_ascii=False))
        print(f"  [benefits] {h}: {[t for t,_ in items]}")
    print("DONE")

if __name__=="__main__":
    main()
