"""Build a self-contained expandable HTML page from the FAQ markdown files
(12 catalog SKUs + 2 pilot). Local review artifact for Lucas. No deps."""
import glob, re, html, sys
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
PILOT = HERE.parent / "2026-07-06_faq-pilot" / "faq-primer-cachos-mayday.md"

# claim tokens to highlight per SKU (the flags Lucas must confirm)
FLAG = {
    "101": ["até 24h", "até 230°C"],
    "021": ["até 12h"],
    "120": ["até 230°C"],
    "024": ["até 72h"],
}

def parse(text):
    """Yield (title, sku, url, [(q,a)]) per product block."""
    blocks = re.split(r"^## ", text, flags=re.M)
    for b in blocks:
        m = re.match(r"(.+?)\s*\((GEB\s*\d+)\)\s*[—-]\s*(\S+)", b)
        if not m:
            continue
        title, sku, url = m.group(1).strip(), m.group(2).replace(" ", ""), m.group(3).strip()
        sku_num = re.sub(r"\D", "", sku)
        qas = []
        for qm in re.finditer(r"\*\*\d+\.\s*(.+?)\*\*\s*\n(.+?)(?=\n\*\*\d+\.|\Z)", b, flags=re.S):
            q = qm.group(1).strip()
            a = " ".join(l.strip() for l in qm.group(2).strip().splitlines() if l.strip())
            if q and a and not a.startswith("##"):
                qas.append((q, a))
        if qas:
            yield title, sku, sku_num, url, qas

prods = {}
for f in list(glob.glob(str(HERE / "faq-GEB*.md"))) + [str(PILOT)]:
    for title, sku, num, url, qas in parse(Path(f).read_text(encoding="utf-8")):
        prods[num] = (title, sku, url, qas)

order = sorted(prods, key=lambda n: int(n))

def esc(s):
    return html.escape(s)

def mark(a, num):
    for tok in FLAG.get(num, []):
        a = a.replace(tok, f'<mark class="flag">{tok}</mark>')
    return a

full_url = lambda u: u if u.startswith("http") else "https://www.gebeauty.com.br" + u

nav = "\n".join(
    f'<a class="chip" href="#p{num}">{esc(prods[num][0])} <span>{prods[num][1]}</span></a>'
    for num in order
)

sections = []
total_q = 0
for num in order:
    title, sku, url, qas = prods[num]
    total_q += len(qas)
    items = "\n".join(
        f'''<details>
  <summary>{esc(q)}</summary>
  <div class="ans">{mark(esc(a), num)}</div>
</details>''' for q, a in qas
    )
    flagged = " <span class='pf'>claim a confirmar</span>" if num in FLAG else ""
    sections.append(f'''<section id="p{num}" class="prod">
  <div class="phead">
    <h2>{esc(title)}</h2>
    <div class="meta"><span class="sku">{sku}</span> · <a href="{full_url(url)}" target="_blank" rel="noopener">ver PDP</a> · {len(qas)} perguntas{flagged}</div>
  </div>
  {items}
</section>''')

HTML = f'''<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GE Beauty — FAQ do catálogo (revisão)</title>
<style>
:root{{--red:#DF372F;--ink:#1a1a1a;--muted:#6b6b6b;--line:#ececec;--bg:#faf8f6;--card:#fff;--flag:#fff2b8;}}
*{{box-sizing:border-box}}
body{{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg);line-height:1.55}}
header{{background:var(--card);border-bottom:3px solid var(--red);padding:28px 24px 20px}}
.wrap{{max-width:860px;margin:0 auto;padding:0 20px}}
h1{{margin:0 0 6px;font-size:26px;letter-spacing:-.4px}}
.sub{{color:var(--muted);font-size:14px;margin:0}}
.status{{display:inline-block;margin-top:12px;background:#fdeceb;color:var(--red);font-weight:600;font-size:12px;padding:5px 12px;border-radius:999px;letter-spacing:.3px}}
.controls{{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0 4px}}
.btn{{border:1px solid var(--line);background:var(--card);border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer}}
.btn:hover{{border-color:var(--red);color:var(--red)}}
.search{{flex:1;min-width:180px;border:1px solid var(--line);border-radius:8px;padding:8px 12px;font-size:14px}}
.nav{{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 8px}}
.chip{{text-decoration:none;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:999px;padding:6px 12px;font-size:12.5px;white-space:nowrap}}
.chip span{{color:var(--muted);font-weight:600}}
.chip:hover{{border-color:var(--red);color:var(--red)}}
main{{padding:8px 0 60px}}
.prod{{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px 22px;margin:18px 0;scroll-margin-top:16px}}
.phead{{border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:6px}}
h2{{margin:0;font-size:19px;color:var(--red);text-transform:capitalize}}
.meta{{font-size:12.5px;color:var(--muted);margin-top:4px}}
.meta a{{color:var(--muted)}}
.sku{{font-weight:700;color:var(--ink)}}
.pf{{background:var(--flag);color:#7a5b00;border-radius:6px;padding:2px 8px;font-weight:600;font-size:11.5px}}
details{{border-bottom:1px solid var(--line);padding:2px 0}}
details:last-child{{border-bottom:none}}
summary{{cursor:pointer;padding:13px 28px 13px 0;font-weight:600;font-size:15px;list-style:none;position:relative}}
summary::-webkit-details-marker{{display:none}}
summary::after{{content:"+";position:absolute;right:4px;top:11px;font-size:20px;color:var(--red);font-weight:400;transition:transform .15s}}
details[open] summary::after{{content:"\\2212"}}
.ans{{padding:0 0 15px;color:#333;font-size:14.5px}}
mark.flag{{background:var(--flag);padding:0 3px;border-radius:3px}}
.hidden{{display:none!important}}
footer{{color:var(--muted);font-size:12px;text-align:center;padding:24px}}
</style></head>
<body>
<header><div class="wrap" style="padding:0">
  <h1>FAQ do catálogo GE Beauty</h1>
  <p class="sub">{len(order)} produtos · {total_q} perguntas · fundamentado no catálogo ao vivo + avaliações Loox por SKU · voz GE (ingrediente como prova, honesto nas objeções)</p>
  <span class="status">RASCUNHO — aguardando aprovação antes de publicar</span>
  <div class="controls">
    <input class="search" id="q" placeholder="Buscar pergunta ou produto...">
    <button class="btn" onclick="allOpen(true)">Expandir tudo</button>
    <button class="btn" onclick="allOpen(false)">Recolher tudo</button>
  </div>
  <nav class="nav">{nav}</nav>
</div></header>
<main class="wrap">
{''.join(sections)}
</main>
<footer>Rascunho local para revisão · content-director · 2026-07-07 · destaques em amarelo = claims a confirmar (24h / 12h / 230°C / 72h)</footer>
<script>
function allOpen(o){{document.querySelectorAll('details').forEach(d=>d.open=o)}}
const q=document.getElementById('q');
q.addEventListener('input',()=>{{
  const t=q.value.toLowerCase().trim();
  document.querySelectorAll('.prod').forEach(sec=>{{
    let any=false;
    const pt=sec.querySelector('h2').textContent.toLowerCase();
    sec.querySelectorAll('details').forEach(d=>{{
      const txt=(d.textContent||'').toLowerCase();
      const hit=!t||txt.includes(t)||pt.includes(t);
      d.classList.toggle('hidden',!hit);
      if(hit)any=true;
      if(t&&hit)d.open=true;
    }});
    sec.classList.toggle('hidden',!any);
  }});
}});
</script>
</body></html>'''

out = HERE / "faq-catalog-review.html"
out.write_text(HTML, encoding="utf-8")
print("wrote", out, "|", len(order), "products,", total_q, "questions")
