"""Build/UPDATE the 'Pontos físicos (novo)' page (id 164178952512). Does NOT touch
the live page (132999643456). CSS-only, inline SVGs, namespaced .gebpf-*.

v2 changes: mobile carousel (scroll-snap) + swipe hint; desktop buttons stacked
vertically; section store-count removed; floor badge + in-mall directions on one
row (directions wrap aligned beside the badge); directions font A/B (Shops Jardins
13px / -1pt, others 12px / -2pt).
"""
import json, urllib.request, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
TOKEN=None
for line in open(Path(__file__).resolve().parent.parent / ".env", encoding='utf-8'):
    if line.startswith('SHOPIFY_ADMIN_ACCESS_TOKEN='):
        TOKEN=line.strip().split('=',1)[1]
API='https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01'
PAGE_ID=132999643456                    # LIVE page
PREVIEW_HANDLE='pontos-fisicos-novo'    # phone-accessible preview page (created on demand)
PREVIEW_TITLE='Pontos físicos (preview)'
MODE=sys.argv[1] if len(sys.argv)>1 else 'mockup'   # mockup (default) | preview | apply
def call(method,path,data=None):
    r=urllib.request.Request(f'{API}{path}',data=(json.dumps(data).encode() if data is not None else None),method=method,
        headers={'Content-Type':'application/json','X-Shopify-Access-Token':TOKEN})
    with urllib.request.urlopen(r) as resp:
        b=resp.read().decode()
        return resp.status,(json.loads(b) if b.strip() else {})

PIN='<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="#9a9a9a" d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/></svg>'
WA='<svg width="18" height="18" viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M16 3C9 3 3.5 8.5 3.5 15.5c0 2.4.7 4.7 1.9 6.7L3 29l7-1.8c1.9 1 4 1.6 6 1.6 7 0 12.5-5.5 12.5-12.5S23 3 16 3zm0 22.7c-1.8 0-3.6-.5-5.1-1.4l-.4-.2-4.1 1.1 1.1-4-.3-.4a10 10 0 0 1-1.6-5.3C5.5 9.9 10.2 5.3 16 5.3s10.5 4.6 10.5 10.2S21.8 25.7 16 25.7zm5.8-7.6c-.3-.2-1.9-.9-2.1-1-.3-.1-.5-.2-.7.2s-.8 1-1 1.2c-.2.2-.4.2-.7.1-1.9-.9-3.1-1.7-4.4-3.8-.3-.5.3-.5.9-1.6.1-.2 0-.4 0-.6s-.7-1.7-1-2.3c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-1.3 1.4-1.1 3.2.2 5 .9 1.3 2.6 3.4 5.6 4.6 2.6 1.1 3.1.9 3.7.8.6-.1 1.9-.8 2.2-1.5.3-.7.3-1.4.2-1.5-.1-.2-.3-.2-.6-.4z"/></svg>'
NAV='<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.7 11.3 12.7 2.3a1 1 0 0 0-1.4 0l-9 9a1 1 0 0 0 0 1.4l9 9a1 1 0 0 0 1.4 0l9-9a1 1 0 0 0 0-1.4zM14 14.5V12h-4v3H8v-4a1 1 0 0 1 1-1h5V7.5l3.5 3.5L14 14.5z"/></svg>'
ARROW='<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 4l8 8-8 8V4z"/></svg>'

STYLE='''<style>
.gebpf{--ge-red:#DF372F;--ge-red-dark:#c12d26;--ink:#161616;--muted:#6b6b6b;--line:#ececec;color:var(--ink)}
.gebpf *{box-sizing:border-box}
.gebpf-h1{font-size:clamp(30px,5vw,46px);font-weight:800;letter-spacing:-.02em;line-height:1.05;margin:0 0 10px}
.gebpf-h2{font-size:clamp(17px,2.4vw,22px);font-weight:500;color:var(--muted);margin:0 0 4px}
.gebpf-cat{margin:40px 0 0}
.gebpf-cathead{border-bottom:2px solid var(--ink);padding-bottom:10px;margin-bottom:20px}
.gebpf-cathead h2{font-size:clamp(22px,3.4vw,30px);font-weight:800;margin:0;text-transform:lowercase;letter-spacing:-.01em}
.gebpf-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:22px}
.gebpf-card{border:1px solid var(--line);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;background:#fff;transition:box-shadow .18s,transform .18s}
.gebpf-card:hover{box-shadow:0 10px 30px rgba(0,0,0,.08);transform:translateY(-2px)}
.gebpf-map{width:100%;height:184px;background:#eef1ee;border-bottom:1px solid var(--line)}
.gebpf-map iframe{width:100%;height:100%;border:0;display:block}
.gebpf-body{padding:18px 20px 20px;display:flex;flex-direction:column;flex:1}
.gebpf-eyebrow{font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--ge-red);margin-bottom:6px;display:block}
.gebpf-name{font-size:20px;font-weight:800;margin:0 0 8px;letter-spacing:-.01em}
.gebpf-addr{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;margin:0 0 12px}
.gebpf-addr svg{flex:none;margin-top:3px}
.gebpf-addr-lines{display:flex;flex-direction:column;line-height:1.4}
.gebpf-street{color:var(--ink);font-weight:700;font-size:13.5px}
.gebpf-hood{color:var(--muted)}
.gebpf-floorrow{display:flex;align-items:flex-start;gap:10px;margin-bottom:16px}
.gebpf-chip{display:flex;flex:0 0 40%;align-items:center;justify-content:center;text-align:center;background:#fbe9e8;color:var(--ge-red-dark);font-size:13px;font-weight:700;padding:6px 12px;border-radius:12px;line-height:1.25;word-break:break-word}
.gebpf-note{flex:1 1 0;min-width:0;margin:0;color:var(--ink);line-height:1.35;padding-top:4px;font-size:12px}
.gebpf-actions{display:flex;flex-direction:column;gap:10px;margin-top:auto}
.gebpf-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-size:15px;font-weight:700;padding:12px 16px;border-radius:10px;border:1.6px solid transparent;text-decoration:none;width:100%;transition:background .15s,color .15s}
.gebpf-primary{background:var(--ge-red);color:#fff !important}
.gebpf-primary:hover{background:var(--ge-red-dark)}
.gebpf-ghost{background:#fff;color:var(--ge-red) !important;border-color:var(--ge-red)}
.gebpf-ghost:hover{background:#fbe9e8}
.gebpf-swipehint{display:none;transition:opacity .25s ease}
@keyframes gebpf-nudge{0%,100%{transform:translateX(0)}50%{transform:translateX(6px)}}
@media(max-width:768px){
  .gebpf-grid{grid-template-columns:1fr;gap:16px}
  .gebpf-carousel{display:flex;grid-template-columns:none;overflow-x:auto;scroll-snap-type:x mandatory;gap:14px;padding:2px 2px 8px;-webkit-overflow-scrolling:touch;scrollbar-width:none}
  .gebpf-carousel::-webkit-scrollbar{display:none}
  .gebpf-carousel .gebpf-card{flex:0 0 92%;scroll-snap-align:start}
  .gebpf-swipehint{display:flex;align-items:center;justify-content:center;gap:7px;color:var(--ge-red);font-size:13px;font-weight:700;margin-top:12px}
  .gebpf-swipehint svg{animation:gebpf-nudge 1.15s ease-in-out infinite}
}
</style>'''

E1='https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3949.8274910617165!2d-34.907243825672175!3d-8.11904028125073!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x7ab1f427968d6cb%3A0x34787df94f76a149!2sShopping%20Recife!5e0!3m2!1spt-BR!2sbr!4v1762367099878!5m2!1spt-BR!2sbr'
E2='https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3950.151296508831!2d-34.8973235256726!3d-8.086048680847329!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x7ab1f3bec607c45%3A0xf9b44be61a236c4d!2sShopping%20RioMar%20Recife!5e0!3m2!1spt-BR!2sbr!4v1762367176089!5m2!1spt-BR!2sbr'
E3='https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3673.8082709376185!2d-43.17961462525878!3d-22.95728713967674!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x997ff850b6b019%3A0x86d4fe7f40840f69!2sShopping%20RioSul!5e0!3m2!1spt-BR!2sbr!4v1762367153126!5m2!1spt-BR!2sbr'
E4='https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3657.106264954082!2d-46.67166292523518!3d-23.564626661711102!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x94ce59d9c7638d7f%3A0x49b11c50db8a6d5a!2sShops%20Jardins!5e0!3m2!1spt-BR!2sbr!4v1762367196400!5m2!1spt-BR!2sbr'
E5='https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3657.1835275826584!2d-46.656098424669885!3d-23.561851178799532!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x94ce59001fa60d6f%3A0x88b40afd40641d4c!2sMata%20Lab!5e0!3m2!1spt-BR!2sbr!4v1782415352973!5m2!1spt-BR!2sbr'
E6='https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3950.679850225454!2d-34.90693992567367!3d-8.031906680189172!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x7ab198827a0cd23%3A0x14e9c31a3a69b917!2sMaria%20Bonita%20Beaut%C3%A9!5e0!3m2!1spt-BR!2sbr!4v1762366920470!5m2!1spt-BR!2sbr'

PROPRIAS=[
 ("Recife","Shopping Recife","Rua Padre Carapuceiro, 777","Boa Viagem","3ª etapa<br>2º piso","Quiosque próximo a Centauro e Calvin Klein.","558189432203","Oi%2C+quero+fazer+um+pedido+para+Recife%21","-8.119040,-34.907244",E1),
 ("Recife","Shopping RioMar Recife","Av. República do Líbano, 251","Pina","Piso L2","Quiosque em frente à Calvin Klein.","558189424872","Oi%2C+quero+fazer+um+pedido+para+Recife%21","-8.086049,-34.897324",E2),
 ("Rio de Janeiro","Shopping RioSul","Rua Lauro Müller, 116","Botafogo","3º piso","Quiosque em frente à Vivo.","5521973598066","Oi%2C+quero+fazer+um+pedido+para+o+Rio%21","-22.957287,-43.179615",E3),
 ("São Paulo","Shops Jardins","Rua Haddock Lobo, 1626","Jardins","2º piso","Próximo ao salão Wanderley Nunes.","5511966208929","Oi%2C+quero+fazer+um+pedido+para+S%C3%A3o+Paulo%21","-23.564627,-46.671663",E4),
]
ESPECIAL=[("São Paulo","Mata Lab Fashion · Cidade Matarazzo","Alameda Rio Claro, 260","Bela Vista",None,None,None,None,"-23.561851,-46.656098",E5)]
SALOES=[("Recife","Maria Bonita Beauté","Estr. do Arraial, 2350","Tamarineira",None,None,None,None,"-8.031907,-34.906940",E6)]

def card(s):
    city,name,street,hood,floor,note,wa,wat,dirc,embed=s
    h=['<article class="gebpf-card">']
    h.append('<div class="gebpf-body">')
    h.append(f'<span class="gebpf-eyebrow">{city}</span>')
    h.append(f'<h3 class="gebpf-name">{name}</h3>')
    h.append(f'<p class="gebpf-addr">{PIN}<span class="gebpf-addr-lines"><span class="gebpf-street">{street}</span><span class="gebpf-hood">{hood}</span></span></p>')
    if floor or note:
        h.append('<div class="gebpf-floorrow">')
        if floor: h.append(f'<span class="gebpf-chip">{floor}</span>')
        if note:
            h.append(f'<span class="gebpf-note">{note}</span>')
        h.append('</div>')
    h.append('<div class="gebpf-actions">')
    if wa: h.append(f'<a class="gebpf-btn gebpf-primary" href="https://api.whatsapp.com/send/?phone={wa}&amp;text={wat}" target="_blank" rel="noopener">{WA} peça pelo WhatsApp</a>')
    h.append(f'<a class="gebpf-btn gebpf-ghost" href="https://www.google.com/maps/dir/?api=1&amp;destination={dirc}" target="_blank" rel="noopener">{NAV} como chegar</a>')
    h.append('</div></div></article>')
    return ''.join(h)

def section(title,items):
    carousel=' gebpf-carousel' if len(items)>1 else ''
    cards=''.join(card(s) for s in items)
    hint='<div class="gebpf-swipehint">arraste para ver mais '+ARROW+'</div>' if len(items)>1 else ''
    return f'<section class="gebpf-cat"><div class="gebpf-cathead"><h2>{title}</h2></div><div class="gebpf-grid{carousel}">{cards}</div>{hint}</section>'

SCRIPT=('<script>'
 "(function(){function init(){document.querySelectorAll('.gebpf-carousel').forEach(function(c){"
 "var h=c.parentNode.querySelector('.gebpf-swipehint');if(!h)return;"
 "function u(){var e=c.scrollLeft+c.clientWidth>=c.scrollWidth-8;h.style.opacity=e?'0':'1';}"
 "c.addEventListener('scroll',u,{passive:true});window.addEventListener('resize',u);u();});}"
 "if(document.readyState!=='loading'){init();}else{document.addEventListener('DOMContentLoaded',init);}})();"
 '</script>')

BODY=(STYLE+'<div class="gebpf">'
    +'<h1 class="gebpf-h1">encontre a GE Beauty pertinho de você</h1>'
    +'<h2 class="gebpf-h2">lojas próprias e pontos de venda parceiros.</h2>'
    +section('lojas próprias',PROPRIAS)
    +section('pontos de venda parceiros',sorted(ESPECIAL+SALOES,key=lambda x:x[0]))
    +'</div>'+SCRIPT)

# always refresh the living mockup so we can iterate on it (standalone HTML doc)
MOCK=Path(__file__).resolve().parents[3] / "inputs" / "mockups" / "gebeauty-pontos-fisicos-v1.html"
doc=('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
 '<meta name="viewport" content="width=device-width,initial-scale=1">'
 '<title>GE Beauty — pontos físicos (mockup)</title>'
 "<style>body{font-family:'Helvetica Neue',Arial,sans-serif;margin:0;background:#fff}.mock-wrap{max-width:1160px;margin:0 auto;padding:32px 24px}</style>"
 '</head><body><div class="mock-wrap">'+BODY+'</div></body></html>')
MOCK.write_text(doc, encoding='utf-8')
print('MOCKUP refreshed:', MOCK, '|', len(doc), 'chars')

if MODE=='apply':
    _,r=call('PUT',f'/pages/{PAGE_ID}.json',{'page':{'id':PAGE_ID,'body_html':BODY}})
    p=r['page']; print('LIVE page PUSHED:', p['id'], '| /pages/'+p['handle'], '| body', len(p['body_html']),'chars')
elif MODE=='preview':
    _,lst=call('GET','/pages.json?limit=250&fields=id,handle')
    ex=next((pg for pg in lst.get('pages',[]) if pg['handle']==PREVIEW_HANDLE), None)
    if ex:
        call('PUT',f"/pages/{ex['id']}.json",{'page':{'id':ex['id'],'body_html':BODY}})
        print('PREVIEW page UPDATED:', ex['id'])
    else:
        _,r=call('POST','/pages.json',{'page':{'title':PREVIEW_TITLE,'handle':PREVIEW_HANDLE,'body_html':BODY,'published':True}})
        print('PREVIEW page CREATED:', r['page']['id'])
    print('preview URL: https://ge-beauty-cosmeticos.myshopify.com/pages/'+PREVIEW_HANDLE)
else:
    print('Mockup only (pass "preview" for the phone URL, "apply" to push live). BODY:', len(BODY),'chars')
