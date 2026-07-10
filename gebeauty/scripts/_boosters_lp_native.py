"""Boosters LP - NATIVE-section page template, SELL-FIRST + refinements (2026-07-08 v2).

Order: hero(slideshow banner) -> chooser(theme section: sections/boosters-chooser.liquid) ->
promo(icons-with-title: frete gratis / 6x sem juros / compra segura, from metaobjects.icones) ->
5x featured-product (3 benefits + Loox badge + native add-to-cart + per-card descricao accordion;
single #ecede9 tint so the image bg blends into the card; media_size small like the primers) ->
kit featured-product -> icons-with-title (clean beauty) -> rich-text education -> faq -> close.

Refinements this pass:
- chooser is a real editable theme section (not hardcoded custom-liquid).
- single tint #ecede9 (image bg ~#eaece8 blends; drops the pink alternation that showed a white block).
- media_size small + variant_picker to match the primers' cards.
- descricao_longa_com_abas accordion INSIDE each product card (replaces the bottom aggregate collapsible).
- promo icons reinforce free delivery + payment options.
"""
import os, json, requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
D=os.environ["SHOPIFY_SHOP_DOMAIN"]; T=os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]; V=os.environ.get("SHOPIFY_API_VERSION","2026-01")
REST=f"https://{D}/admin/api/{V}"; H={"X-Shopify-Access-Token":T,"Content-Type":"application/json"}
SC=Path(r"C:/Users/LUCASG~1/AppData/Local/Temp/claude/c--claude/0823b26b-fda8-4dcd-b164-b799bf85aa82/scratchpad")
CHOOSER_SRC=SC/"boosters-chooser.liquid"
KIT_URL="/products/kit-boosters"
TINT="#ecede9"
LOOX_BADGE="shopify://apps/loox-reviews/blocks/loox-trust-badge/5c3b337f-fd14-4df5-b1d6-80ec13e6e28e"
STAR_RATING=('<div class="loox-rating" data-id="{{ section.settings.product.id }}" ''data-rating="{{ section.settings.product.metafields.loox.avg_rating }}" ''data-raters="{{ section.settings.product.metafields.loox.num_reviews }}"></div>''<style>#shopify-section-{{ section.id }} .loox-rating{margin:4px 0 10px;}</style>')

def lpstyle(anchor):
    return ("<span id=\"%s\" style=\"position:relative;top:-96px;display:block;height:0\"></span>" % anchor +
      "<style>"
      "#shopify-section-{{ section.id }} .product{background:%s !important;border-radius:20px;overflow:hidden;padding:24px;align-items:flex-start;}" % TINT +
      "#shopify-section-{{ section.id }} .product-media-container,#shopify-section-{{ section.id }} .product__media-wrapper,#shopify-section-{{ section.id }} .product__media,"
      "#shopify-section-{{ section.id }} .product__info-container,#shopify-section-{{ section.id }} .media{background:transparent !important;}"
      "#shopify-section-{{ section.id }} .product__info-wrapper{align-self:flex-start;}"
      "#shopify-section-{{ section.id }} .product__title{font-weight:700 !important;}"
      "#shopify-section-{{ section.id }} .product__view-details{display:none !important;}"
      "#shopify-section-{{ section.id }} .button{border-radius:40px !important;}"
      "#shopify-section-{{ section.id }} .icon-with-text__item img{width:60px !important;height:auto !important;}"
      "#shopify-section-{{ section.id }} #price-{{ section.id }},#shopify-section-{{ section.id }} .product__info-container > .no-js-hidden{display:none !important;}"
      "@media(min-width:750px){#shopify-section-{{ section.id }} .icon-with-text__item img{width:80px !important;}}"
      "</style>")

DESC=json.loads((SC/"descricao_html.json").read_text(encoding="utf-8"))

# tabs-component JS (compact copy of theme's sections/tabs.liquid behaviour; guarded define)
_TABJS = ("<script>document.addEventListener(\"DOMContentLoaded\",function(){"
  "if(customElements.get('tabs-component'))return;"
  "class T extends HTMLElement{connectedCallback(){this.tabs=this.querySelectorAll('.tab');"
  "this.contents=this.querySelectorAll('.content');"
  "this.tabs.forEach(function(t){t.addEventListener('click',function(){this.h(t)}.bind(this))}.bind(this));"
  "if(this.tabs[0])this.tabs[0].click();}"
  "h(c){this.tabs.forEach(function(t){t.classList.remove('active')});c.classList.add('active');"
  "var id=c.getAttribute('data-tab');this.contents.forEach(function(x){x.style.display='none'});"
  "var el=this.querySelector('[data-content=\"'+id+'\"]');if(el)el.style.display='block';}}"
  "customElements.define('tabs-component',T);});</script>")

def tabs_component(handle):
    """Replicate the PDP tabs (theme .tabs-component markup + section-tabs.css) below the card."""
    d=DESC.get(handle,{})
    tabsrc=[("como combinar","passo_a_passo"),("resultado","resultado"),("saiba mais","o_que_e")]
    items=[(lab,d.get(key,"").strip()) for lab,key in tabsrc]
    items=[(lab,html) for lab,html in items if html]
    if not items: return ""
    btns="".join(f'<div class="tabs-component__tab tab" data-tab="tab{i+1}">{lab}</div>' for i,(lab,_) in enumerate(items))
    panes="".join(f'<div class="tabs-component__content content rte" data-content="tab{i+1}">{html}</div>' for i,(_,html) in enumerate(items))
    css=("<style>"
      "#shopify-section-{{ section.id }} .gbtabs{margin-top:18px;}"
      "#shopify-section-{{ section.id }} .tabs-component__content ul li{background:url('{{ \"icon-star.svg\" | asset_url }}') no-repeat center left;background-size:2rem;padding:1rem 0 1rem 2.8rem;}"
      "</style>")
    return ("{{ 'section-tabs.css' | asset_url | stylesheet_tag }}"
      f'<div class="gbtabs"><tabs-component class="tabs-component">'
      f'<div class="tabs-component__tabs"><div class="tabs-component__tabs-wrapper">{btns}</div></div>'
      f'<div class="tabs-component__contents">{panes}</div>'
      f'</tabs-component></div>' + css + _TABJS)

def featured(handle, anchor, with_benefits=True, txt=None):
    blocks={"lpstyle":{"type":"custom_liquid","settings":{"custom_liquid":lpstyle(anchor)}},
            "title":{"type":"title","settings":{"heading_size":"h2"}}}
    order=["lpstyle","title"]
    if with_benefits:
        blocks["benefits"]={"type":"icon-with-text","settings":{"layout":"horizontal",
          "icon_1":"none","image_1":"{{ section.settings.product.metafields.custom.imagem_beneficio_em_destaque_1.value }}","heading_1":"{{ section.settings.product.metafields.custom.beneficio_em_destaque_1.value }}",
          "icon_2":"none","image_2":"{{ section.settings.product.metafields.custom.imagem_beneficio_em_destaque_2.value }}","heading_2":"{{ section.settings.product.metafields.custom.beneficio_em_destaque_2.value }}",
          "icon_3":"none","image_3":"{{ section.settings.product.metafields.custom.imagem_beneficio_em_destaque_3.value }}","heading_3":"{{ section.settings.product.metafields.custom.beneficio_em_destaque_3.value }}"}}
        blocks["stars"]={"type":"custom_liquid","settings":{"custom_liquid":STAR_RATING}}
        order+=["benefits"]
    if txt:
        blocks["txt"]={"type":"text","settings":{"text":txt,"text_style":"body"}}; order.append("txt")
    blocks["variant"]={"type":"variant_picker","settings":{"picker_type":"button"}}
    blocks["price"]={"type":"price","settings":{}}
    blocks["buy"]={"type":"buy_buttons","settings":{"show_dynamic_checkout":False,"show_gift_card_recipient":False}}
    order+=(["variant","price","stars","buy"] if with_benefits else ["variant","price","buy"])
    if with_benefits:
        blocks["acc"]={"type":"custom_liquid","settings":{"custom_liquid":tabs_component(handle)}}; order.append("acc")
    return {"type":"featured-product","blocks":blocks,"block_order":order,
      "settings":{"product":handle,"color_scheme":"","secondary_background":False,"media_size":"small",
        "constrain_to_viewport":True,"media_fit":"contain","media_position":"left","image_zoom":"none",
        "hide_variants":False,"enable_video_looping":False,"padding_top":8,"padding_bottom":8}}

def richtext(heading, text, btn=None, link=None, align="center", full=False):
    b={"h":{"type":"heading","settings":{"heading":heading,"heading_size":"h2"}},
       "t":{"type":"text","settings":{"text":"<p>"+text+"</p>"}}}
    order=["h","t"]
    if btn:
        b["btn"]={"type":"button","settings":{"button_label":btn,"button_link":link,"button_style_secondary":False,"button_label_2":"","button_link_2":"","button_style_secondary_2":False}}
        order.append("btn")
    return {"type":"rich-text","blocks":b,"block_order":order,
      "settings":{"desktop_content_position":"center","content_alignment":align,"color_scheme":"","full_width":full,"padding_top":28,"padding_bottom":28}}

def icon_mo(h): return "{{ metaobjects.icones[\"%s\"].imagem.value }}" % h
def icon_tx(h): return "{{ metaobjects.icones[\"%s\"].texto.value }}" % h

BOOSTERS=[("booster-antifrizz","antifrizz"),("booster-fortificante","fortificante"),
          ("booster-hidratante","hidratante"),("booster-definicao","definicao"),("booster-antioxidante","antioxidante")]

sections={}; order=[]
sections["hero"]={"type":"slideshow","blocks":{"s1":{"type":"slide","settings":{
    "image":"shopify://shop_images/guia-pratico-web_fb3598b3-67f3-47a4-ad68-235167c76334.png","image_mb":"shopify://shop_images/guia-pratico-mobile_b30ad9b0-499e-4070-bf9d-905d0c2755fd.png",
    "heading":"","heading_size":"h1","subheading":"","button_label":"","link":"","link_title":"",
    "button_style_secondary":False,"box_align":"middle-center","show_text_box":False,"text_alignment":"center",
    "image_overlay_opacity":0,"color_scheme":"","text_alignment_mobile":"center"}}},"block_order":["s1"],
  "settings":{"layout":"full_bleed","full_width":True,"slide_height":"adapt_image","slider_visual":"counter","auto_rotate":False,
    "show_pause":True,"change_slides_speed":5,"image_behavior":"none","show_text_below":True,"accessibility_info":"Boosters GE Beauty",
    "border_radius_top_left":20,"border_radius_top_right":20,"border_radius_bottom_right":20,"border_radius_bottom_left":20}}
order.append("hero")

# "o que são os boosters?" — 4 beige pills, editable theme section, placed right after the hero
sections["oquesao"]={"type":"boosters-oquesao",
  "blocks":{f"p{i}":{"type":"ponto","settings":{"texto":t}} for i,t in enumerate([
    "<p>são <strong>concentrados</strong> capilares de <strong>alta performance</strong></p>",
    "<p><strong>potencializam o cuidado</strong> de acordo com <strong>cada momento</strong></p>",
    "<p>atendem <strong>diversas necessidades</strong> de forma <strong>personalizada</strong></p>",
    "<p>podem ser <strong>combinados</strong> ou usados <strong>sozinhos</strong></p>"],1)},
  "block_order":[f"p{i}" for i in range(1,5)],
  "settings":{"heading":"o que são os boosters?","padding_top":32,"padding_bottom":20}}
order.append("oquesao")

# promo strip = EXACT copy of the PDP "Quebras de objeção" icons-with-title section
def _mo(h): return "{{ metaobjects.icones[\""+h+"\"] }}"
def _img(h): return "{{ metaobjects.icones[\""+h+"\"].imagem.value }}"
def _txt(h): return "{{ metaobjects.icones[\""+h+"\"].texto.value }}"
def _lnk(h): return "{{ metaobjects.icones[\""+h+"\"].link.value }}"
sections["promo"]={"type":"icons-with-title","name":"Quebras de objeção",
  "blocks":{
    "icon_HbMAMM":{"type":"icon","source":_mo("compra-segura"),"settings":{"icon":_img("compra-segura"),"title":_txt("compra-segura"),"underline":False,"link_url":_lnk("compra-segura")}},
    "icon_DAtbBz":{"type":"icon","source":_mo("compre-em-ate-6-x-sem-juros"),"settings":{"icon":_img("compre-em-ate-6-x-sem-juros"),"title":_txt("compre-em-ate-6-x-sem-juros"),"underline":False,"link_url":""}},
    "icon_YPUN9G":{"type":"icon","source":_mo("oferta-frete"),"settings":{"icon":_img("oferta-frete"),"title":_txt("oferta-frete"),"underline":False,"link_url":""}}},
  "block_order":["icon_HbMAMM","icon_DAtbBz","icon_YPUN9G"],
  "settings":{"color_scheme":"background-1","padding_top":12,"padding_bottom":12}}
order.append("promo")

# punchline as a section heading (same hierarchy as "o que são os boosters?"), no buttons
sections["punchline"]={"type":"boosters-headline",
  "settings":{"heading":"um para cada necessidade. conheça:","padding_top":24,"padding_bottom":8}}
order.append("punchline")

for h,anchor in BOOSTERS:
    sections[f"{anchor}_buy"]=featured(h,anchor); order.append(f"{anchor}_buy")

# kit (dark card, convenience framing — no savings: singles sum == kit price)
sections["kit"]=featured("kit-boosters","kit",with_benefits=False,
  txt="os cinco boosters juntos, a rotina completa para o que o seu cabelo precisa em qualquer dia.")
order.append("kit")

sections["trust"]={"type":"icons-with-title",
  "blocks":{"i1":{"type":"icon","settings":{"icon":"shopify://shop_images/noun-organic-3801980_1.svg","title":"fórmula limpa","underline":False}},
            "i2":{"type":"icon","settings":{"icon":"shopify://shop_images/icon-nao-testado-em-animais.svg","title":"não testado em animais","underline":False}},
            "i3":{"type":"icon","settings":{"icon":"shopify://shop_images/icon-vegano.svg","title":"produto vegano","underline":False}},
            "i4":{"type":"icon","settings":{"icon":"shopify://shop_images/icon-100-reciclavel.svg","title":"embalagens recicláveis","underline":False}}},
  "block_order":["i1","i2","i3","i4"],"settings":{"color_scheme":"","padding_top":20,"padding_bottom":8}}
order.append("trust")

sections["education"]=richtext("como usar",
  "Pingue na dose que você já usa (shampoo, máscara ou leave-in) ou aplique puro como finalizador. Poucas gotas já entregam o resultado.",
  align="center"); order.append("education")

sections["faq"]={"type":"faq",
  "blocks":{
    "q1":{"type":"question","settings":{"question":"Posso misturar mais de um booster?","answer":"<p>Pode e deve. Os boosters foram feitos para conversar entre si. Combine na mesma dose quando o cabelo pedir mais de uma coisa, como brilho e definição ou força e hidratação.</p>"}},
    "q2":{"type":"question","settings":{"question":"Quantas gotas devo usar?","answer":"<p>Nossos boosters são altamente concentrados, algumas gotas já fazem toda a diferença. Comece com 3 a 5 e ajuste pela textura e pelo comprimento.</p>"}},
    "q3":{"type":"question","settings":{"question":"Posso usar todos os dias?","answer":"<p>Sim. Misturados na sua rotina de sempre, são de uso diário. Usados puros como finalizador, aplique conforme a necessidade do dia.</p>"}},
    "q4":{"type":"question","settings":{"question":"Funciona em qualquer tipo de cabelo?","answer":"<p>Sim. Liso, ondulado, cacheado ou crespo: você escolhe o booster pela necessidade, não pela textura.</p>"}}},
  "block_order":["q1","q2","q3","q4"],
  "settings":{"title":"perguntas rápidas","title_bold":True,"heading_size":"h2","heading_alignment":"center","show_search_filter":False,"color_scheme":"","padding_top":24,"padding_bottom":8}}
order.append("faq")

sections["close"]=richtext("a rotina é sua. os boosters completam.",
  "Você conhece o seu cabelo melhor do que ninguém. Escolha o booster para o que ele precisa hoje, ou leve o kit completo e tenha todos à mão. No seu tempo, do seu jeito.",
  "montar meu kit", KIT_URL, align="center", full=True); order.append("close")

template={"sections":sections,"order":order}

def main():
    tid=next(t for t in requests.get(f"{REST}/themes.json",headers=H).json()["themes"] if t["role"]=="main")["id"]
    print("MAIN theme:",tid)
    # upload the editable heading section; retire the old chooser section
    r=requests.put(f"{REST}/themes/{tid}/assets.json",headers=H,json={"asset":{"key":"sections/boosters-headline.liquid","value":(SC/"boosters-headline.liquid").read_text(encoding="utf-8")}})
    print("headline section PUT:",r.status_code, (r.json().get("asset",{}) or {}).get("key") if r.ok else r.text[:400]); r.raise_for_status()
    requests.delete(f"{REST}/themes/{tid}/assets.json",headers=H,params={"asset[key]":"sections/boosters-chooser.liquid"})
    r=requests.put(f"{REST}/themes/{tid}/assets.json",headers=H,json={"asset":{"key":"sections/boosters-oquesao.liquid","value":(SC/"boosters-oquesao.liquid").read_text(encoding="utf-8")}})
    print("oquesao section PUT:",r.status_code, (r.json().get("asset",{}) or {}).get("key") if r.ok else r.text[:400]); r.raise_for_status()
    r=requests.put(f"{REST}/themes/{tid}/assets.json",headers=H,json={"asset":{"key":"templates/page.guia-boosters.json","value":json.dumps(template,ensure_ascii=False)}})
    print("template PUT:",r.status_code, (r.json().get("asset",{}) or {}).get("key") if r.ok else r.text[:500]); r.raise_for_status()
    (SC/"page_guia_boosters_v2.json").write_text(json.dumps(template,ensure_ascii=False,indent=1),encoding="utf-8")
    print("sections:",len(sections),"| order:",order)

if __name__=="__main__":
    main()
