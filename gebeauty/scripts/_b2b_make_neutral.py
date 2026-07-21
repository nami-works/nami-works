"""Derive a NEUTRAL, share-safe product portfolio from the B2B sales deck.
Strips the wholesale sales-pitch sections + neutralizes pitchy copy, so it can go
to partner brands (that want to buy products or use them in campaigns/marketing).
Source: inputs/mockups/gebeauty-b2b-portfolio-v3.html
Output: inputs/mockups/gebeauty-portfolio-neutral-v1.html
"""
import re
from pathlib import Path

MOCK = Path(__file__).resolve().parents[1].parent / "inputs" / "mockups"
src = (MOCK / "gebeauty-b2b-portfolio-v3.html").read_text(encoding="utf-8")
html = src

# 1) remove the sales-pitch + placeholder sections (flat, non-nested)
REMOVE_IDS = ["diferencial", "marca", "fundadora", "mercado", "parceria", "contato"]
for sid in REMOVE_IDS:
    new, n = re.subn(r'<section[^>]*id="' + sid + r'"[\s\S]*?</section>\s*', "", html)
    print(f"remove #{sid}: {'OK' if n == 1 else 'MISS ('+str(n)+')'}")
    html = new

# 2) neutralize copy (old -> new). Report any miss.
REPL = [
    (r'<title>[\s\S]*?</title>', '<title>GE Beauty · Portfólio de Produtos</title>'),
    ('<h1 class="gbb-rv">Beleza capilar<br><span class="thin">que a sua cliente</span><br>já procura.</h1>', ''),
    ('Apresentação de portfólio para parceiros de varejo. Cinco linhas, um cuidado completo, do dia a dia ao tratamento intensivo.',
     'Cinco linhas, um cuidado completo, do dia a dia ao tratamento intensivo. Conheça os produtos GE Beauty.'),
    ('para ampliar a prateleira de maior recompra.', 'para o cabelo e o corpo.'),
    ('<h2 class="gbb-rv">Adicione a GE Beauty ao seu portfólio de haircare premium.</h2>',
     '<h2 class="gbb-rv">Fale com a GE Beauty.</h2>'),
    ('Receba a tabela de atacado, condições comerciais e a proposta de sortimento ideal para o seu canal.',
     'Para compras, campanhas ou parcerias de marketing, entre em contato com o nosso time.'),
    ('>Solicitar acesso e condições<', '>Entrar em contato<'),
    (' Condições de atacado sob proposta comercial.', ''),
    ('PVS = preço sugerido de venda ao consumidor. Condições de atacado, sortimento e logística sob proposta comercial.',
     'PVS = preço sugerido de venda ao consumidor.'),
    ('Bruma perfumada para cabelo e corpo. Fragrância que permanece e brilho sem peso. A categoria de maior apelo sensorial e recompra do portfólio.',
     'Bruma perfumada para cabelo e corpo. Fragrância que permanece e brilho sem peso.'),
    ('Os heróis da marca em formato de bolsa. Ideais para presentear, experimentar e girar no PDV com baixo investimento por unidade.',
     'Os heróis da marca em formato de bolsa. Ideais para presentear e experimentar.'),
    # partner version: move price off the card face, into the expandable detail
    ('<div class="gbb-meta"><div class="gbb-pvs">${money(p.pvs)}</div><span class="gbb-more">',
     '<div class="gbb-meta"><span class="gbb-more">'),
    ('<div class="gbb-detail-in"><p>${p.note}</p>',
     '<div class="gbb-detail-in"><div class="gbb-pvs det">${money(p.pvs)}</div><p>${p.note}</p>'),
    ('.gbb-detail-in{padding:14px 17px 16px}',
     '.gbb-detail-in{padding:14px 17px 16px}.gbb-pvs.det{text-align:left;margin:0 0 10px}'),
    # partner cover: no H1, portfolio image stretches full width below the text
    ('</style>',
     '#capa{display:block;min-height:auto;padding:88px 0 0}'
     '#capa .gbb-cover-grid{display:block;max-width:none;padding:0}'
     '#capa .gbb-cover-text{max-width:var(--maxw);margin:0 auto;padding:0 28px 34px}'
     '#capa .gbb-cover-art{width:100%}'
     '#capa .gbb-cover-art img{position:static;width:100%;height:auto;object-fit:contain;'
     '-webkit-mask-image:none;mask-image:none;border-radius:0}</style>'),
]
for old, new in REPL:
    if old.startswith('<title'):
        html, n = re.subn(old, new, html)
    else:
        n = html.count(old)
        html = html.replace(old, new)
    label = old[:48].replace("\n", " ")
    print(f"repl [{label}...]: {'OK x'+str(n) if n else 'MISS'}")

out = MOCK / "gebeauty-portfolio-neutral-v1.html"
out.write_text(html, encoding="utf-8")
print(f"\nwrote {out.name}  ({len(html)} bytes, was {len(src)})")
