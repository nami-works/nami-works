import json, urllib.request, os, re
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path("c:/claude/gebeauty/.env"))
TOKEN=os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]; DOMAIN=os.environ["SHOPIFY_SHOP_DOMAIN"]; VER=os.environ.get("SHOPIFY_API_VERSION","2026-01")
URL=f"https://{DOMAIN}/admin/api/{VER}/graphql.json"
def gql(q,v=None):
    body=json.dumps({"query":q,**({"variables":v} if v else {})}).encode()
    req=urllib.request.Request(URL,data=body,headers={"Content-Type":"application/json","X-Shopify-Access-Token":TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode())
q='''query($c:String){products(first:250,after:$c,query:"product_type:product OR product_type:acessorio"){pageInfo{hasNextPage endCursor} nodes{title description productType featuredImage{url} metafield(namespace:"custom",key:"finalidade"){value} variants(first:20){nodes{sku barcode}}}}}'''
img_sku={};img_bc={};desc_sku={};desc_bc={};c=None
def firstsent(t):
    t=re.sub(r"\s+"," ",(t or "").strip())
    if not t: return ""
    # take up to 2 sentences, cap ~180 chars
    parts=re.split(r"(?<=[.!?])\s+",t)
    out=""
    for s in parts:
        if len(out)+len(s)>180 and out: break
        out=(out+" "+s).strip()
        if len(out)>=90: break
    return out[:180]
while True:
    d=gql(q,{"c":c}); pr=d["data"]["products"]
    for n in pr["nodes"]:
        img=(n.get("featuredImage") or {}).get("url")
        fin=(n.get("metafield") or {}).get("value") if n.get("metafield") else None
        raw=n.get("description") or fin or ""
        ds=firstsent(raw)
        for v in n["variants"]["nodes"]:
            s=(v.get("sku") or "").strip(); b=(v.get("barcode") or "").strip()
            if s and img: img_sku.setdefault(s,img)
            if b and img: img_bc.setdefault(b,img)
            if s and ds: desc_sku.setdefault(s,ds)
            if b and ds: desc_bc.setdefault(b,ds)
    if pr["pageInfo"]["hasNextPage"]: c=pr["pageInfo"]["endCursor"]
    else: break
out={"img_by_sku":img_sku,"img_by_barcode":img_bc,"desc_by_sku":desc_sku,"desc_by_barcode":desc_bc}
Path("c:/claude/gebeauty/sephora/sephora_enrich.json").write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding="utf-8")
print("img sku",len(img_sku),"desc sku",len(desc_sku))
