"""Re-crop the 4 GENERATED booster icons tight to the artwork (remove the transparent
border so they fill the canvas like the pre-existing icon-150 icons, ~1.0 fill), re-upload,
re-point the benefit metafields (imagem_beneficio_em_destaque_* + icone_lp), delete the old files.
Fixes: generated icons rendering ~13% smaller than pre-existing inside the icon-with-text block.
"""
import os, io, json, time, requests
from pathlib import Path
from dotenv import load_dotenv
from PIL import Image

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
D=os.environ["SHOPIFY_SHOP_DOMAIN"]; T=os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]; V=os.environ.get("SHOPIFY_API_VERSION","2026-01")
U=f"https://{D}/admin/api/{V}/graphql.json"; H={"X-Shopify-Access-Token":T,"Content-Type":"application/json"}

def gql(q,v=None):
    r=requests.post(U,headers=H,json={"query":q,"variables":v or {}}).json()
    if "errors" in r: raise RuntimeError(json.dumps(r["errors"],ensure_ascii=False))
    return r["data"]

# old generated icons: alt -> (MediaImage id, benefit wiring)
OLD={
 "booster antifrizz icone lp":"gid://shopify/MediaImage/43792288579904",
 "booster fortificante icone lp":"gid://shopify/MediaImage/43792290185536",
 "booster antioxidante icone lp":"gid://shopify/MediaImage/43792291627328",
 "booster oleosidade icone lp":"gid://shopify/MediaImage/43833896960320",
}

def img_url(mid):
    n=gql('query($id:ID!){node(id:$id){... on MediaImage{image{url}}}}',{"id":mid})["node"]
    return n["image"]["url"]

def tight(png):
    im=Image.open(io.BytesIO(png)).convert("RGBA")
    bb=im.split()[3].getbbox()
    im=im.crop(bb)                      # trim ALL transparent border -> fill 1.0
    side=max(im.size)
    c=Image.new("RGBA",(side,side),(0,0,0,0))
    c.paste(im,((side-im.width)//2,(side-im.height)//2),im)   # square, centered, no margin
    b=io.BytesIO(); c.save(b,"PNG"); return b.getvalue()

def upload(data,fn,alt):
    su=gql('''mutation($i:[StagedUploadInput!]!){stagedUploadsCreate(input:$i){stagedTargets{url resourceUrl parameters{name value}}userErrors{message}}}''',
           {"i":[{"filename":fn,"mimeType":"image/png","httpMethod":"POST","resource":"FILE"}]})
    t=su["stagedUploadsCreate"]["stagedTargets"][0]
    requests.post(t["url"],data=[(p["name"],p["value"]) for p in t["parameters"]],files={"file":(fn,data,"image/png")}).raise_for_status()
    fc=gql('''mutation($f:[FileCreateInput!]!){fileCreate(files:$f){files{id}userErrors{message}}}''',
           {"f":[{"originalSource":t["resourceUrl"],"contentType":"IMAGE","alt":alt}]})
    if fc["fileCreate"]["userErrors"]: raise RuntimeError(json.dumps(fc["fileCreate"]["userErrors"]))
    fid=fc["fileCreate"]["files"][0]["id"]
    for _ in range(40):
        n=gql('query($id:ID!){node(id:$id){... on MediaImage{fileStatus}}}',{"id":fid})["node"]
        if n["fileStatus"]=="READY": return fid
        time.sleep(2)
    raise RuntimeError("not READY: "+fid)

def pgid(h): return gql('query($h:String!){productByHandle(handle:$h){id}}',{"h":h})["productByHandle"]["id"]

def main():
    newid={}
    for alt,mid in OLD.items():
        raw=requests.get(img_url(mid)).content
        data=tight(raw)
        fill=Image.open(io.BytesIO(data)).split()[3].getbbox()
        newid[alt]=upload(data,alt.replace(" ","-")+"-v2.png",alt+" v2")
        print(f"  re-cropped+uploaded {alt} -> {newid[alt]}")

    af=newid["booster antifrizz icone lp"]; fo=newid["booster fortificante icone lp"]
    ao=newid["booster antioxidante icone lp"]; ole=newid["booster oleosidade icone lp"]
    sets=[
      # benefit-strip images actually shown on the LP
      {"ownerId":pgid("booster-antifrizz"),"namespace":"custom","key":"imagem_beneficio_em_destaque_1","type":"file_reference","value":af},
      {"ownerId":pgid("booster-fortificante"),"namespace":"custom","key":"imagem_beneficio_em_destaque_1","type":"file_reference","value":fo},
      {"ownerId":pgid("booster-fortificante"),"namespace":"custom","key":"imagem_beneficio_em_destaque_2","type":"file_reference","value":ole},
      {"ownerId":pgid("booster-antioxidante"),"namespace":"custom","key":"imagem_beneficio_em_destaque_1","type":"file_reference","value":ao},
      # keep the legacy single icone_lp consistent too
      {"ownerId":pgid("booster-antifrizz"),"namespace":"custom","key":"icone_lp","type":"file_reference","value":af},
      {"ownerId":pgid("booster-fortificante"),"namespace":"custom","key":"icone_lp","type":"file_reference","value":fo},
      {"ownerId":pgid("booster-antioxidante"),"namespace":"custom","key":"icone_lp","type":"file_reference","value":ao},
    ]
    r=gql('''mutation($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){metafields{key}userErrors{field message}}}''',{"m":sets})
    if r["metafieldsSet"]["userErrors"]: raise RuntimeError(json.dumps(r["metafieldsSet"]["userErrors"],ensure_ascii=False))
    print(f"  re-wired {len(sets)} metafields to tight icons")

    # delete old files
    dead=list(OLD.values())
    r=gql('mutation($ids:[ID!]!){fileDelete(fileIds:$ids){deletedFileIds userErrors{message}}}',{"ids":dead})
    print("  deleted old:",r["fileDelete"]["deletedFileIds"])
    print("DONE")

if __name__=="__main__":
    main()
