"""Derive a NEUTRAL, share-safe product portfolio from the B2B sales deck.
Strips the wholesale sales-pitch sections + neutralizes pitchy copy, so it can go
to partner brands (that want to buy products or use them in campaigns/marketing).
Source: inputs/mockups/gebeauty-b2b-portfolio-v6.html
Output: inputs/mockups/gebeauty-portfolio-neutral-v1.html
"""
import re
from pathlib import Path

MOCK = Path(__file__).resolve().parents[1].parent / "inputs" / "mockups"
src = (MOCK / "gebeauty-b2b-portfolio-v6.html").read_text(encoding="utf-8")
html = src

# 1) remove the sales-pitch + placeholder sections (flat, non-nested)
# "fundadora" reports MISS(0) as of v6 -- the section is commented out /
# unbuilt pending Camila Coutinho's quote+portrait (see handoff §11), not an
# error. Kept in the list so removal fires automatically once it's restored.
REMOVE_IDS = ["diferencial", "marca", "fundadora", "mercado", "parceria", "contato"]
for sid in REMOVE_IDS:
    new, n = re.subn(r'<section[^>]*id="' + sid + r'"[\s\S]*?</section>\s*', "", html)
    print(f"remove #{sid}: {'OK' if n == 1 else 'MISS ('+str(n)+')'}")
    html = new

html, _nf = re.subn(r'<footer class="gbb-foot">[\s\S]*?</footer>\s*', "", html)
print(f"remove footer: {'OK' if _nf == 1 else 'MISS(' + str(_nf) + ')'}")

# 2) neutralize copy (old -> new). Report any miss.
REPL = [
    (r'<title>[\s\S]*?</title>', '<title>GE Beauty · Portfólio de Produtos</title>'),
    ('<h1 class="gbb-rv">Beleza<br><span class="thin">que a cliente</span><br>já procura.</h1>', ''),
    ('Apresentação de portfólio para parceiros de varejo. Cinco linhas, um cuidado completo, do dia a dia ao tratamento intensivo.',
     'Cinco linhas, um cuidado completo, do dia a dia ao tratamento intensivo. Conheça os produtos GE Beauty.'),
    # NOTE: v3-era CTA/#contato copy swaps ("para ampliar a prateleira...",
    # "Adicione a GE Beauty...", "Solicitar acesso e condições", the PVS
    # disclaimer) are gone as of v6 — that content lived entirely inside the
    # #contato section, already deleted by the REMOVE_IDS pass above. No-op
    # entries removed rather than left as permanent MISS noise.
    ('Bruma perfumada para cabelo e corpo. Fragrância que permanece e brilho sem peso. A categoria de maior apelo sensorial e recompra do portfólio.',
     'Bruma perfumada para cabelo e corpo. Fragrância que permanece e brilho sem peso.'),
    ('Os heróis da marca em formato de bolsa. Ideais para presentear, experimentar e girar no PDV com baixo investimento por unidade.',
     'Os heróis da marca em formato de bolsa. Ideais para presentear e experimentar.'),
    # partner version: move price off the card face, into the expandable detail
    # v5+ moved from an inline expand-card to a quick-view modal (gmPvs already
    # shows price on open) — so "move price off the card face" now means just
    # dropping it from the card template; the modal keeps it, unchanged.
    ('<div class="gbb-meta"><div class="gbb-pvs">${money(p.pvs)}</div><span class="gbb-more" aria-hidden="true">',
     '<div class="gbb-meta"><span class="gbb-more" aria-hidden="true">'),
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
