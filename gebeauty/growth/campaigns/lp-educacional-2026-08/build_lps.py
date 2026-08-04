#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generates the 5 message-matched landing pages for campaign lp-educacional-2026-08.

One template, five variants (the structure Lucas approved). Self-contained HTML,
mobile-first, no external JS/CSS, no localStorage.

Design tokens are the real brand tokens read from gebeauty/design-system/foundations.html:
  GE red #DF3630 | ink #000 | paper #FFF
  sands  #F6F5F3 #E9E7E3 #C4C0BA | warm #857D74 #3A332C
  sage   #769C8E #A7C2B0 | cream #E2DDCB #CDC5B2
  type   Italian Plate No1 (installed locally in gebeauty/.brand-assets/fonts)

Run:  python3 build_lps.py
Then: open out/<slug>.html
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from content import PAGES, STORE, FINALIZADORES  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
FREE_SHIP = 299.00
TAGLINE = "no seu tempo, do seu jeito."

ACCENTS = {
    "red":  {"tint": "#FBEAE9", "deep": "#DF3630", "band": "#DF3630", "bandink": "#FFFFFF"},
    "sage": {"tint": "#EAF1ED", "deep": "#769C8E", "band": "#769C8E", "bandink": "#FFFFFF"},
    "sand": {"tint": "#F6F5F3", "deep": "#857868", "band": "#E2DDCB", "bandink": "#3A332C"},
}


def brl(v):
    return ("R$ %.2f" % v).replace(".", ",")


CSS = """
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:"Italian Plate No1","Helvetica Neue",Arial,sans-serif;
  color:var(--ink);background:var(--paper);line-height:1.5;font-size:17px;
  -webkit-font-smoothing:antialiased}
:root{--ge-red:#DF3630;--ink:#000;--paper:#fff;--s50:#F6F5F3;--s100:#E9E7E3;
  --s200:#C4C0BA;--w700:#857D74;--w900:#3A332C;--r-sm:6px;--r-md:12px;--r-pill:999px;
  --maxw:1080px}
img{max-width:100%;display:block;height:auto}
a{color:inherit}
h1,h2,h3,p,ul,ol{margin:0}
.wrap{width:100%;max-width:var(--maxw);margin:0 auto;padding:0 20px}
.eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;
  color:var(--accent-deep)}

/* ---------- announcement + header ---------- */
.ann{background:var(--ink);color:#fff;text-align:center;font-size:13px;padding:9px 16px;
  letter-spacing:.02em}
.hdr{position:sticky;top:0;z-index:40;background:rgba(255,255,255,.94);
  backdrop-filter:blur(8px);border-bottom:1px solid var(--s100)}
.hdr .in{display:flex;align-items:center;justify-content:space-between;gap:16px;
  height:60px;max-width:var(--maxw);margin:0 auto;padding:0 20px}
.logo{display:flex;align-items:center;gap:9px;text-decoration:none;font-weight:700}
.logo .mark{width:32px;height:32px;border-radius:50%;background:var(--ge-red);color:#fff;
  display:grid;place-items:center;font-size:14px;font-weight:800;letter-spacing:-.02em}
.logo .wm{font-size:15px;letter-spacing:.01em}
.hdr .cta{display:none}
@media(min-width:720px){.hdr .cta{display:inline-flex}}

/* ---------- buttons ---------- */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;
  background:var(--ge-red);color:#fff;text-decoration:none;font-weight:700;font-size:16px;
  padding:15px 26px;border-radius:var(--r-pill);border:0;cursor:pointer;
  transition:transform .12s ease,filter .12s ease;text-align:center;line-height:1.2}
.btn:hover{filter:brightness(.93);transform:translateY(-1px)}
.btn.block{width:100%}
.btn.ghost{background:transparent;color:var(--ink);border:1.5px solid var(--ink)}
.btn.sm{padding:11px 18px;font-size:14px}
.note{font-size:13px;color:var(--w700);margin-top:10px;text-align:center}

/* ---------- hero ---------- */
.hero{background:var(--accent-tint);padding:34px 0 38px;position:relative;overflow:hidden}
.hero .bubble{position:absolute;border-radius:50%;background:rgba(255,255,255,.5);
  pointer-events:none}
.hero .b1{width:300px;height:300px;right:-110px;top:-90px}
.hero .b2{width:190px;height:190px;right:44px;bottom:-96px}
.hero .in{position:relative;z-index:2}
.hero h1{font-size:clamp(30px,8.4vw,54px);line-height:1.04;letter-spacing:-.025em;
  font-weight:800;margin:12px 0 0;max-width:16ch}
.hero .sub{font-size:clamp(16px,4.2vw,20px);color:var(--w900);margin-top:16px;max-width:44ch}
.hero .acts{margin-top:24px;display:flex;flex-direction:column;gap:10px;max-width:360px}
.trust{display:flex;flex-wrap:wrap;gap:8px;margin-top:22px;padding:0;list-style:none}
.trust li{font-size:12.5px;font-weight:600;background:#fff;border:1px solid var(--s100);
  border-radius:var(--r-pill);padding:7px 13px;color:var(--w900)}
.heroimg{margin-top:26px}
.heroimg img{border-radius:var(--r-md);width:100%}
@media(min-width:860px){
  .hero{padding:56px 0 60px}
  .hero .in{display:grid;grid-template-columns:1.05fr .95fr;gap:44px;align-items:center}
  .heroimg{margin-top:0}
}

/* ---------- sections ---------- */
section{padding:44px 0}
.sec-t{font-size:clamp(23px,5.6vw,34px);line-height:1.12;letter-spacing:-.02em;
  font-weight:800;max-width:22ch}
.lede{color:var(--w700);margin-top:12px;max-width:52ch}

/* numbered answer list: delivers the ad's promise immediately */
.steps{list-style:none;padding:0;margin:26px 0 0;display:grid;gap:2px}
.steps li{display:grid;grid-template-columns:38px 1fr;gap:14px;align-items:start;
  padding:17px 0;border-top:1px solid var(--s100)}
.steps li:last-child{border-bottom:1px solid var(--s100)}
.steps .n{width:30px;height:30px;border-radius:50%;background:var(--accent-band);
  color:var(--accent-bandink);display:grid;place-items:center;font-weight:800;font-size:14px}
.steps b{display:block;font-size:17px;margin-bottom:3px}
.steps span.d{color:var(--w700);font-size:15.5px}

/* mechanism cards */
.cards{display:grid;gap:14px;margin-top:26px}
@media(min-width:760px){.cards{grid-template-columns:repeat(3,1fr)}}
.card{background:var(--s50);border:1px solid var(--s100);border-radius:var(--r-md);padding:20px}
.card h3{font-size:17px;margin-bottom:7px}
.card p{color:var(--w700);font-size:15.5px}

/* ---------- offer block (the conversion unit) ---------- */
.offer{background:var(--ink);color:#fff}
.offer .sec-t{color:#fff}
.offer .grid{display:grid;gap:26px;margin-top:24px}
@media(min-width:880px){.offer .grid{grid-template-columns:.9fr 1.1fr;align-items:center}}
.offer img{border-radius:var(--r-md);background:#fff}
.kicker{color:var(--s200);font-size:15.5px;margin-top:12px;max-width:46ch}
.ritual{list-style:none;padding:0;margin:22px 0 0;display:grid;gap:14px}
.ritual li{display:grid;grid-template-columns:auto 1fr;gap:13px;align-items:start}
.ritual .tag{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;
  background:#fff;color:var(--ink);border-radius:var(--r-pill);padding:5px 11px;white-space:nowrap}
.ritual b{display:block;font-size:16px}
.ritual span.d{color:var(--s200);font-size:15px}
.pricerow{display:flex;align-items:baseline;gap:12px;margin-top:26px;flex-wrap:wrap}
.price{font-size:38px;font-weight:800;letter-spacing:-.03em}
.perkit{color:var(--s200);font-size:14px}
.shipbar{margin-top:18px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);
  border-radius:var(--r-md);padding:14px 16px;font-size:14.5px}
.shipbar b{color:#fff}
.track{height:6px;border-radius:var(--r-pill);background:rgba(255,255,255,.18);margin-top:10px;
  overflow:hidden}
.track i{display:block;height:100%;width:86.6%;background:var(--ge-red);border-radius:var(--r-pill)}

/* upsell */
.upsell{display:grid;grid-template-columns:84px 1fr;gap:16px;align-items:center;
  background:var(--s50);border:1px solid var(--s100);border-radius:var(--r-md);
  padding:16px;margin-top:24px}
.upsell img{width:84px;border-radius:var(--r-sm)}
.upsell h3{font-size:16px}
.upsell p{color:var(--w700);font-size:14.5px;margin-top:4px}

/* ---------- chooser (LP5) ---------- */
.filters{display:flex;flex-wrap:wrap;gap:8px;margin-top:24px}
.chip{background:#fff;border:1.5px solid var(--s200);border-radius:var(--r-pill);
  padding:10px 17px;font-size:14.5px;font-weight:600;cursor:pointer;font-family:inherit;
  color:var(--ink);transition:all .12s ease}
.chip[aria-pressed="true"]{background:var(--ink);border-color:var(--ink);color:#fff}
.fin{display:grid;gap:14px;margin-top:22px}
@media(min-width:700px){.fin{grid-template-columns:repeat(2,1fr)}}
@media(min-width:1000px){.fin{grid-template-columns:repeat(4,1fr)}}
.f{border:1px solid var(--s100);border-radius:var(--r-md);padding:18px;background:#fff;
  display:flex;flex-direction:column;transition:opacity .18s ease}
.f[hidden]{display:none}
.f.dim{opacity:.34}
.f img{width:100%;border-radius:var(--r-sm);background:var(--s50);margin-bottom:14px}
.f .para{font-size:11.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;
  color:var(--accent-deep)}
.f h3{font-size:17px;margin:7px 0 5px}
.f .pr{font-weight:700;font-size:15px}
.f p{color:var(--w700);font-size:14.5px;margin:9px 0 16px}
.f .btn{margin-top:auto}

/* ---------- proof ---------- */
.proof{background:var(--accent-tint)}
.quotes{display:grid;gap:14px;margin-top:24px}
@media(min-width:760px){.quotes{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}}
.q{background:#fff;border-radius:var(--r-md);padding:20px;border:1px solid rgba(0,0,0,.05)}
.q p{font-size:16px}
.q .who{margin-top:12px;font-size:13.5px;color:var(--w700);font-weight:600}
.srcnote{font-size:12.5px;color:var(--w700);margin-top:18px}

/* ---------- faq ---------- */
details{border-top:1px solid var(--s100);padding:17px 0}
details:last-of-type{border-bottom:1px solid var(--s100)}
summary{cursor:pointer;font-weight:700;font-size:16.5px;list-style:none;display:flex;
  justify-content:space-between;gap:16px;align-items:center}
summary::-webkit-details-marker{display:none}
summary::after{content:"+";font-size:22px;font-weight:400;color:var(--accent-deep);
  flex:0 0 auto;line-height:1}
details[open] summary::after{content:"\\2013"}
details p{color:var(--w700);margin-top:11px;max-width:62ch;font-size:15.5px}

/* medical note */
.med{background:var(--s50);border-left:3px solid var(--accent-deep);border-radius:var(--r-sm);
  padding:15px 17px;font-size:14.5px;color:var(--w900);margin-top:26px}

/* ---------- final + footer ---------- */
.final{background:var(--accent-band);color:var(--accent-bandink);text-align:center}
.final .sec-t{margin:0 auto;max-width:24ch;color:inherit}
.final .acts{margin-top:26px;display:flex;justify-content:center}
.final .btn{background:var(--ink);color:#fff}
.tag{margin-top:26px;font-size:15px;font-style:italic;opacity:.85}
footer{padding:30px 0 40px;font-size:13px;color:var(--w700);text-align:center}

/* sticky mobile buy bar */
.sticky{position:fixed;left:0;right:0;bottom:0;z-index:50;background:rgba(255,255,255,.97);
  backdrop-filter:blur(10px);border-top:1px solid var(--s100);padding:10px 16px;
  display:flex;gap:12px;align-items:center;transform:translateY(120%);
  transition:transform .22s ease;padding-bottom:calc(10px + env(safe-area-inset-bottom))}
.sticky.on{transform:translateY(0)}
.sticky .m{flex:1;min-width:0}
.sticky .m b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis}
.sticky .m span{font-size:12.5px;color:var(--w700)}
@media(min-width:720px){.sticky{display:none}}
body{padding-bottom:0}
@media(max-width:719px){body.hasbar{padding-bottom:78px}}
"""

JS = """
// Forward incoming ad params (utm_* / nemu_*) onto every store link so the hop
// from LP to checkout does not drop attribution. See growth/references/utm-conventions.md
(function(){
  var qs = window.location.search;
  if(qs && qs.length > 1){
    document.querySelectorAll('a[data-store]').forEach(function(a){
      try{
        var u = new URL(a.href);
        new URLSearchParams(qs).forEach(function(v,k){ u.searchParams.set(k,v); });
        a.href = u.toString();
      }catch(e){}
    });
  }
  // Sticky buy bar appears once the hero CTA scrolls away.
  var bar = document.querySelector('.sticky'), hero = document.querySelector('.hero .acts');
  if(bar && hero && window.matchMedia('(max-width:719px)').matches){
    document.body.classList.add('hasbar');
    new IntersectionObserver(function(es){
      bar.classList.toggle('on', !es[0].isIntersecting);
    },{rootMargin:'-10px 0px 0px 0px'}).observe(hero);
  }
})();
"""

CHOOSER_JS = """
(function(){
  var chips = document.querySelectorAll('.chip'), cards = document.querySelectorAll('.f');
  chips.forEach(function(c){
    c.addEventListener('click', function(){
      var on = c.getAttribute('aria-pressed') === 'true';
      chips.forEach(function(x){ x.setAttribute('aria-pressed','false'); });
      c.setAttribute('aria-pressed', on ? 'false' : 'true');
      var t = on ? null : c.dataset.tag;
      cards.forEach(function(k){
        k.classList.toggle('dim', !!(t && k.dataset.tags.indexOf(t) === -1));
      });
    });
  });
})();
"""


def store_link(path):
    return f"{STORE}/products/{path}"


def head(p, a):
    title = f"{p['h1']} | GE Beauty"
    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<meta name="description" content="{p['sub'][:150]}">
<meta name="robots" content="noindex,nofollow">
<!-- campaign lp-educacional-2026-08 | ad: {p['ad_post']} | hook: {p['ad_hook']} -->
<style>
:root{{--accent-tint:{a['tint']};--accent-deep:{a['deep']};--accent-band:{a['band']};
--accent-bandink:{a['bandink']}}}
{CSS}
</style>
</head>
<body>"""


def hero(p, offer):
    trust = [
        "fórmula limpa",
        "livre de crueldade animal",
        f"frete grátis acima de {brl(FREE_SHIP)}",
    ]
    lis = "".join(f"<li>{t}</li>" for t in trust)
    return f"""
<div class="ann">fórmula limpa e livre de crueldade animal. frete grátis acima de {brl(FREE_SHIP)}.</div>
<header class="hdr"><div class="in">
  <a class="logo" href="{STORE}" data-store><span class="mark">ge</span><span class="wm">GE Beauty</span></a>
  <a class="btn sm cta" href="#rotina">ver a rotina</a>
</div></header>

<section class="hero">
  <div class="bubble b1"></div><div class="bubble b2"></div>
  <div class="wrap in">
    <div>
      <span class="eyebrow">{p['eyebrow']}</span>
      <h1>{p['h1']}</h1>
      <p class="sub">{p['sub']}</p>
      <div class="acts">
        <a class="btn block" href="#rotina">começar minha rotina</a>
        <a class="btn ghost block" href="#como">entender primeiro</a>
      </div>
      <ul class="trust">{lis}</ul>
    </div>
    <div class="heroimg"><img src="{offer['image']}" alt="{offer['name']} GE Beauty" loading="eager"></div>
  </div>
</section>"""


def answer(p):
    if not p.get("answer_items"):
        return ""
    lis = ""
    for i, (t, d) in enumerate(p["answer_items"], 1):
        lis += f'<li><span class="n">{i}</span><span><b>{t}</b><span class="d">{d}</span></span></li>'
    return f"""
<section id="como"><div class="wrap">
  <h2 class="sec-t">{p['answer_title']}</h2>
  <ol class="steps">{lis}</ol>
</div></section>"""


def chooser(p):
    if not p.get("chooser"):
        return ""
    tags = [("liso", "liso"), ("ondulado", "ondulado"), ("cacheado", "cacheado"), ("fino", "fio fino")]
    chips = "".join(
        f'<button class="chip" type="button" aria-pressed="false" data-tag="{t}">{lab}</button>'
        for t, lab in tags
    )
    cards = ""
    for f in FINALIZADORES:
        cards += f"""<article class="f" data-tags="{','.join(f['tags'])}">
      <img src="{f['image']}" alt="{f['name']}" loading="lazy">
      <span class="para">{f['para']}</span>
      <h3>{f['name']}</h3>
      <span class="pr">{brl(f['price'])}</span>
      <p>{f['detail']}</p>
      <a class="btn sm" href="{store_link(f['handle'])}" data-store>escolher este</a>
    </article>"""
    return f"""
<section id="como"><div class="wrap">
  <h2 class="sec-t">comece pelo seu cabelo</h2>
  <p class="lede">toque no seu tipo de fio para ver quais finalizadores foram pensados para ele. o
  {FINALIZADORES[3]['name']} atende todos os tipos.</p>
  <div class="filters">{chips}</div>
  <div class="fin">{cards}</div>
</div></section>"""


def mech(p):
    cards = "".join(f"<div class='card'><h3>{t}</h3><p>{d}</p></div>" for t, d in p["mech"])
    return f"""
<section><div class="wrap">
  <h2 class="sec-t">{p['mech_title']}</h2>
  <div class="cards">{cards}</div>
</div></section>"""


def offer_block(p):
    o = p["offer"]
    gap = FREE_SHIP - o["price"]
    ritual = ""
    for tag, name, why in o["steps"]:
        ritual += (f'<li><span class="tag">{tag}</span>'
                   f'<span><b>{name}</b><span class="d">{why}</span></span></li>')
    ship = ""
    if gap > 0:
        pct = (o["price"] / FREE_SHIP) * 100
        ship = f"""<div class="shipbar">
        faltam <b>{brl(gap)}</b> para o frete grátis. um booster completa e ainda personaliza a rotina.
        <div class="track"><i style="width:{pct:.1f}%"></i></div></div>"""
    up = ""
    if p.get("upsell"):
        u = p["upsell"]
        up = f"""<div class="upsell">
      <img src="{u['image']}" alt="{u['name']}" loading="lazy">
      <div><h3>{u['name']}, {brl(u['price'])}</h3><p>{u['why']}</p></div>
    </div>"""
    med = f'<div class="med">{p["medical_note"]}</div>' if p.get("medical_note") else ""
    return f"""
<section class="offer" id="rotina"><div class="wrap">
  <span class="eyebrow" style="color:var(--s200)">a rotina completa</span>
  <h2 class="sec-t">{o['name']}</h2>
  <p class="kicker">{p['offer_kicker']}</p>
  <div class="grid">
    <img src="{o['image']}" alt="{o['name']}" loading="lazy">
    <div>
      <ul class="ritual">{ritual}</ul>
      <div class="pricerow"><span class="price">{brl(o['price'])}</span>
        <span class="perkit">os três produtos, tamanho full size</span></div>
      <a class="btn block" href="{store_link(o['handle'])}" data-store
         style="margin-top:18px">quero a rotina completa</a>
      {ship}
    </div>
  </div>
  {up}{med}
</div></section>"""


def proof(p):
    qs = "".join(f'<div class="q"><p>{t}</p><div class="who">@{who}</div></div>'
                 for who, t in p["proof"])
    return f"""
<section class="proof"><div class="wrap">
  <h2 class="sec-t">quem já usa</h2>
  <div class="quotes">{qs}</div>
  <p class="srcnote">comentários reais publicados no Instagram da GE Beauty.</p>
</div></section>"""


def faq(p):
    ds = "".join(f"<details><summary>{q}</summary><p>{a}</p></details>" for q, a in p["faq"])
    return f"""
<section><div class="wrap">
  <h2 class="sec-t">perguntas que vocês fizeram</h2>
  {ds}
</div></section>"""


def final(p):
    o = p["offer"]
    return f"""
<section class="final"><div class="wrap">
  <h2 class="sec-t">comece a rotina que o seu cabelo pede</h2>
  <div class="acts"><a class="btn" href="{store_link(o['handle'])}" data-store>
    quero a {o['name']}, {brl(o['price'])}</a></div>
  <p class="tag">{TAGLINE}</p>
</div></section>
<footer><div class="wrap">GE Beauty. fórmula limpa, livre de crueldade animal.</div></footer>

<div class="sticky">
  <div class="m"><b>{o['name']}</b><span>{brl(o['price'])}, três produtos full size</span></div>
  <a class="btn sm" href="{store_link(o['handle'])}" data-store>comprar</a>
</div>
<script>{JS}{CHOOSER_JS if p.get('chooser') else ''}</script>
</body></html>"""


def build(p):
    a = ACCENTS[p["accent"]]
    return "".join([
        head(p, a), hero(p, p["offer"]), answer(p), chooser(p), mech(p),
        offer_block(p), proof(p), faq(p), final(p),
    ])


# ------------------------------------------------------------------ compliance
BANNED_CHARS = {"—": "em-dash (voice.banned)", "–": "en-dash used as em-dash"}
# invented-number patterns: ratings, review counts, percentage claims, "+N clientes"
INVENTED = [
    (r"\b\d{1,3}(?:[.,]\d)?\s*%\s*(?:das|dos|de|aprova|reduz|mais|menos)", "percentage claim"),
    (r"\b\d[.,]\d\s*(?:estrelas|/\s*5)", "star rating"),
    (r"\+\s?\d{2,}\s*(?:mil\s*)?(?:clientes|avalia|reviews|pessoas)", "review/customer count"),
    (r"\b\d{1,3}\s*mil\s+(?:clientes|mulheres|pessoas)\b", "customer count"),
]
ALLOWED_NUMERIC = ["230", "299", "259", "237", "24h", "95", "75", "139", "149", "99", "40", "62"]


def audit(slug, html):
    """Voice + no-invented-numbers gate. Only scans customer-visible text."""
    issues = []
    body = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    body = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", body, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", body)
    text = re.sub(r"\s+", " ", text)

    for ch, why in BANNED_CHARS.items():
        if ch in text:
            issues.append(f"{why}: found {ch!r}")
    for pat, why in INVENTED:
        m = re.search(pat, text, re.I)
        if m:
            issues.append(f"possible invented number ({why}): {m.group(0)!r}")
    for word in ("desconto", "off", "promoção", "liquidação"):
        if re.search(r"\b" + word + r"\b", text, re.I):
            issues.append(f"discount language present, check brand gate: {word!r}")
    return issues


def main():
    os.makedirs(OUT, exist_ok=True)
    print("building landing pages -> out/\n")
    allok = True
    for p in PAGES:
        html = build(p)
        path = os.path.join(OUT, p["slug"] + ".html")
        with open(path, "w", encoding="utf-8") as f:
            f.write(html)
        issues = audit(p["slug"], html)
        status = "PASS" if not issues else "REVIEW"
        if issues:
            allok = False
        print(f"  [{status}] {p['slug']+'.html':<26} {len(html)/1024:5.1f} KB   offer {brl(p['offer']['price'])}")
        for i in issues:
            print(f"          ! {i}")
    print("\nvoice gate:", "all pages clean" if allok else "see flags above")
    print(f"pages written to {OUT}")


if __name__ == "__main__":
    main()
