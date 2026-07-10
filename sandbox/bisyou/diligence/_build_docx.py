# -*- coding: utf-8 -*-
from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

NAVY = RGBColor(0x11, 0x24, 0x3f); GREY = RGBColor(0x5b, 0x66, 0x77)
doc = Document(); st = doc.styles['Normal']; st.font.name = 'Calibri'; st.font.size = Pt(10.5)


def shade(cell, hexfill):
    tcPr = cell._tc.get_or_add_tcPr(); sh = OxmlElement('w:shd')
    sh.set(qn('w:val'), 'clear'); sh.set(qn('w:color'), 'auto'); sh.set(qn('w:fill'), hexfill); tcPr.append(sh)


def box(kind, runs):
    colors = {'verdict': ('11243f', 'EAF1FA'), 'gold': ('c79a3a', 'FDF8EE'),
              'risk': ('b23b3b', 'FCF1F1'), 'good': ('1f7a3f', 'F0F8F2')}
    bar, fill = colors[kind]
    t = doc.add_table(rows=1, cols=1); t.style = 'Table Grid'
    c = t.rows[0].cells[0]; shade(c, fill); p = c.paragraphs[0]
    for text, bold in runs:
        r = p.add_run(text); r.bold = bold; r.font.size = Pt(10)
    tcPr = c._tc.get_or_add_tcPr(); borders = OxmlElement('w:tcBorders')
    for edge in ('top', 'bottom', 'right'):
        e = OxmlElement('w:' + edge); e.set(qn('w:val'), 'single'); e.set(qn('w:sz'), '4'); e.set(qn('w:color'), 'D4DAE3'); borders.append(e)
    el = OxmlElement('w:left'); el.set(qn('w:val'), 'single'); el.set(qn('w:sz'), '24'); el.set(qn('w:color'), bar); borders.append(el)
    tcPr.append(borders); doc.add_paragraph()


def h1(t):
    p = doc.add_paragraph(); r = p.add_run(t); r.bold = True; r.font.size = Pt(22); r.font.color.rgb = NAVY
def h2(t):
    p = doc.add_paragraph(); r = p.add_run(t); r.bold = True; r.font.size = Pt(14); r.font.color.rgb = RGBColor(255, 255, 255)
    pPr = p._p.get_or_add_pPr(); sh = OxmlElement('w:shd'); sh.set(qn('w:val'), 'clear'); sh.set(qn('w:fill'), '11243F'); pPr.append(sh)
def h3(t):
    p = doc.add_paragraph(); r = p.add_run(t); r.bold = True; r.font.size = Pt(11.5); r.font.color.rgb = NAVY
def para(t): doc.add_paragraph(t)
def meta(t):
    p = doc.add_paragraph(); r = p.add_run(t); r.font.size = Pt(9); r.font.color.rgb = GREY
def bullets(items, ordered=False):
    for it in items: doc.add_paragraph(it, style='List Number' if ordered else 'List Bullet')
def table(rows, numcols=()):
    t = doc.add_table(rows=len(rows), cols=len(rows[0])); t.style = 'Table Grid'
    for ri, row in enumerate(rows):
        for ci, val in enumerate(row):
            cell = t.rows[ri].cells[ci]; cell.text = ''; p = cell.paragraphs[0]; r = p.add_run(str(val)); r.font.size = Pt(9)
            if ri == 0: r.bold = True; shade(cell, 'EEF2F7')
            if ci in numcols: p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    doc.add_paragraph()


h1("Bisyou — Should we take it on?")
meta("Confidential investment memo (v2). Prepared by Claude (CTO/CFO) for Lucas Guimarães (CEO), NAMI Works / GE Beauty · 14 June 2026.")
box('gold', [("Revision v2 — incorporates your review (C1–C7): ", True), ("no GE-Bisyou cross-sell and no Camila (brands independent, only operational structure shared); Boniteca finances inventory, paid M+2 after sale, so no working-capital outlay; 2026 reframed as a 4-month run-rate; cost-base \"Ours\" broken down; freight corrected (charged-to-customer ≠ cost-to-ship, \"doubles cost\" retracted); channel-collapse evidence surfaced with its limits.", False)])

h2("1. Recommendation at a glance")
box('verdict', [("CONDITIONAL GO. ", True), ("Pursue to a term sheet, inside the gates below. The thesis is narrower than v1: with no demand synergy (no cross-sell, no Camila), the entire case is an operational cost-arbitrage — take Bisyou's own revenue and run it on a far lighter cost base than the current owners can. Downside is genuinely capped; upside is real but modest and hinges on whether we can acquire Bisyou's customers efficiently on its own brand.", False)])
para("Big picture. Bisyou loses ~R$3M/yr at a run-rate and was profitable in only one of five years — the cost of buying customers always ate its ~80% margin. The licensing structure hands us the operation with no debt, no labour, no legacy payables, and (Boniteca finances stock) no working capital. On our cost base — no debt service, lean shared overhead, marketing as variable CPA not fixed retainers — the same revenue flips to roughly R$1M EBITDA. The own-site business is durable (32% of orders repeat). The bet is no longer 'use GE's audience'; it is 'run lean and acquire with discipline where the incumbents couldn't.'")
h3("The gates (all must hold, or we pass)")
bullets([
 "Royalty ≤ ~5–8% of NET revenue, no fixed minimum. On gross, or with a minimum, the math breaks.",
 "We can run standalone acquisition at ≤ ~35% of net revenue. The new crux: with no cross-sell crutch, the upside depends on marketing efficiency. Break-even is ~39%; owners ran 48% (recent) and 32% (their one good year). Prove it with a small paid test before committing.",
 "May/June own-site revenue is stabilising, not still sliding. We don't have these two months yet; forward-looking diligence gate.",
 "License term long enough and cheap enough to exit pre-purchase; plus clean ANVISA, trademark, no live litigation.",
 "We cap the leadership attention committed. The real cost is bandwidth pulled off GE Beauty, not cash."], ordered=True)
table([["Metric", "Value"],
 ["Their current burn (2026 run-rate)", "−R$3.0M"],
 ["Est. EBITDA on our base (illustrative)", "~R$1.0M"],
 ["Break-even marketing (% of net)", "~39%"],
 ["Break-even net revenue (vs ~R$7.6M run-rate)", "~R$4.2M"]], numcols=(1,))

h2("2. What is actually on the table")
para("Big picture. A brand-licensing and operational takeover, not an acquisition. We run Bisyou and pay a royalty, with an option to buy later (~year five). We take the operation, not the balance sheet. The two brands stay independent on the demand side — only the operational machine is shared.")
h3("Structure (clean handover)")
bullets([
 "No liabilities transferred: no labour liabilities, no bank debt, none of the ~R$1.9M legacy payables.",
 "Supply unchanged: made by Boniteca (same manufacturer as GE). Fee is a 10%→5% regressive success fee, paid only after sale.",
 "No working-capital outlay (corrected): Boniteca finances the inventory; we pay ~M+2 after the sale (June sales paid 5th business day of August). We pay only after the cash is in — no ~R$1M stock pre-funding.",
 "Marketing today: influencer contracts cancelled; Meta/Google agency to Nov-2026 (~R$60k/mo media + R$6.5k service, break fee)."])
h3("Who we are dealing with")
para("Cap table: Disruptive Participações S/A 76%, Ivan Pinheiro 12%, Carolina Viudes 12%. A financial holder controlling 76% and licensing out operations is a mild negative-selection signal — price the royalty and purchase strike as the call option this is.")

h2("3. The brand's financial reality")
para("Big picture. Bisyou scaled to ~R$15M in 2024 and made money in exactly one year. In 2025 it swung to a R$1.8M net loss. The four months of 2026 we have (Jan–Apr) run well below 2025.")
table([["R$ (Contábil view)", "2021", "2022", "2023", "2024", "2025"],
 ["Gross revenue", "2.47M", "6.40M", "9.81M", "15.44M", "14.79M"],
 ["Gross margin", "77.5%", "82.4%", "84.5%", "85.2%", "80.2%"],
 ["Commercial spend (mktg)", "0.91M", "2.34M", "3.14M", "4.45M", "5.20M"],
 ["Net profit / (loss)", "(0.20M)", "(0.22M)", "(0.40M)", "0.62M", "(1.78M)"]], numcols=(1, 2, 3, 4, 5))
box('gold', [("On 2026 (your C4): ", True), ("we have only 4 actual months (Jan–Apr). The '−46% vs 2025 / ~R$3M burn' is an annualised run-rate, not a confirmed full-year — treat as directional. Within those months advertising ran ~48% of net revenue and the company still lost ~R$300k/month: a paid-acquisition spiral.", False)])

h2("4. What broke — and what the evidence does and doesn't prove")
para("Big picture. The collapse is concentrated in TikTok Shop, driven by one viral product (Bio Estimulador). The own-site channel held up far better. But — your C1 — here is what the data does and does not prove.")
table([["Gross revenue by channel", "nov/25", "dez/25", "jan/26", "fev/26", "mar/26", "abr/26", "Trend"],
 ["TikTok Shop", "965k", "573k", "174k", "90k", "128k", "76k", "−92%"],
 ["Shopify (own site)", "1,312k", "987k", "562k", "476k", "909k", "597k", "−54%, bouncing"],
 ["B2B (DPSP)", "74k", "26k", "59k", "2k", "0", "0", "dead"]], numcols=(1, 2, 3, 4, 5, 6))
para("What the data supports: TikTok collapsed hardest (−92%), single-item impulse (1.0 item/order), one SKU drove it (Bio Estimulador 10,610→406 units). Shopify is multi-item (~2.8) and 32% of orders repeat — structurally more durable.")
box('risk', [("What it does NOT prove (conceded): ", True), ("the P&L logs marketing as a single line, NOT split by channel. So I cannot prove the Shopify base is independent of the influencer/paid bloat. Your read — bloat lifted all channels — is the safer assumption. The own-site base may itself shrink as paid spend normalises. That is why the case is built on a break-even revenue (~R$4.2M net) well under the run-rate, not on the run-rate holding.", False)])

h2("5. The durable core (order-by-order)")
para("Big picture. We reconstructed all 89,648 invoice lines into 45,626 orders. The own-site business is a considered, repeat-purchase business — a real asset, even if its size is uncertain.")
table([["Channel", "Mean AOV", "Items/order", "Character"],
 ["Shopify (own site)", "R$200", "~2.8", "Considered baskets / kits"],
 ["TikTok Shop", "R$90–148", "1.0", "Single-item viral impulse"]], numcols=(1, 2))
box('good', [("Retention is real. ", True), ("Over six months, 32% of own-site orders came from repeat customers (16.5% of customers). TikTok is one-and-done. Genuine brand equity — but with no cross-sell, monetising it still needs Bisyou's own acquisition engine feeding new customers in.", False)])
meta("Own-site destination mix: Southeast 57% (SP 37%, MG 10%, RJ 8%), South 15%, Northeast 17%, Centre-West 8%, North 3%.")

h2("6. Why this works for NAMI — purely operational")
para("Big picture. There is NO demand synergy. The edge is entirely cost structure: owners ran a heavy fixed base and rented growth at retainer prices; we run a light base and buy growth at variable, performance prices. Same revenue, very different bottom line.")
h3("The cost base we would carry — with the build-up (your C5)")
table([["Line", "Theirs (2026 ann.)", "Ours", "Build-up / why different"],
 ["Debt service", "~1.5M", "0", "No debt assumed in the licence"],
 ["Working capital (stock)", "funded by them", "0", "Boniteca finances; we pay M+2 after sale"],
 ["Administrative", "~1.6M", "~0.3M", "Shopify+apps ~110k; bookkeeping in our finance fn ~120k; misc ~70k"],
 ["People", "~1.1M", "~0.95M", "1 brand/ops lead (~220k) + allocated CX/mktg-ops/fulfilment on shared team (~730k)"],
 ["Advertising", "~3.2M fixed (48% of net)", "variable", "CPA/affiliate via Flywheel tooling; pay on performance. Illustrated 25% of net"]], numcols=(1, 2))
h3("The genuine synergies (operational only)")
bullets([
 "Same manufacturer (Boniteca) and distributor model we already run; Boniteca also finances the stock.",
 "Shared fulfilment, admin platform (Omnify) and finance/ops team — marginal cost of a second brand is low.",
 "The Flywheel affiliate/CPA engine as the variable-cost marketing model (tooling and discipline — NOT GE's audience)."])
h3("The prize, in numbers (illustrative — Shopify standalone run-rate)")
table([["Illustrative annual pro-forma", "R$"],
 ["Net revenue (Shopify run-rate)", "~7.6M"],
 ["Gross profit (80%)", "~6.1M"],
 ["Selling + logistics + card (~17%)", "(1.30M)"],
 ["Variable marketing / CPA (25% of net)", "(1.91M)"],
 ["Lean fixed (people ~0.95M + admin ~0.30M)", "(1.25M)"],
 ["Royalty (8% of net)", "(0.61M)"],
 ["Estimated EBITDA", "~R$1.0M (14%)"]], numcols=(1,))
table([["Sensitivity (net R$7.6M, 8% royalty)", "Mktg 20%", "Mktg 25%", "Mktg 30%"],
 ["EBITDA", "~R$1.42M", "~R$1.04M", "~R$0.66M"]], numcols=(1, 2, 3))
box('gold', [("The asymmetry, restated honestly. ", True), ("The brand that loses them ~R$3M/yr could earn us ~R$0.7–1.4M/yr — entirely from cost structure, no demand synergy assumed. Break-even marketing is ~39% of net (they ran 48% recent, 32% good year); break-even revenue ~R$4.2M net vs ~R$7.6M run-rate. Revenue can nearly halve, or marketing run far less efficiently than their best, and we still clear. That margin of safety is the case.", False)])

h2("7. The risks, and where the trap lives")
box('risk', [("1. Standalone acquisition efficiency (new #1). ", True), ("With no cross-sell, everything rides on buying Bisyou's customers at ≤ ~35% of net. The incumbents ran 48%. If we can't beat that materially, EBITDA evaporates. Mitigant: paid test before committing.", False)])
box('risk', [("2. The own-site base keeps sliding / is spend-dependent. ", True), ("Mar (R$909k)→Apr (R$597k) dipped, and per §4 we can't prove Shopify is independent of the old bloat. May/June is the tell.", False)])
box('risk', [("3. The royalty is set wrong. ", True), ("On gross, or with a minimum, transfers fragility to us. Still unstated — we hold the pen.", False)])
box('risk', [("4. Attention cost. ", True), ("A three-person team; every hour on Bisyou is an hour off GE Beauty.", False)])
box('risk', [("5. Product / inventory risk (not working capital). ", True), ("Boniteca carries the stock, so no cash outlay — but some SKUs are liquids/glass (água micelar, sabonete) with breakage and shelf-life exposure; demand on slow SKUs uncertain.", False)])

h2("8. Cost-to-serve: freight, corrected")
para("Your C7 was right and I've corrected it. The '59% shipped free / R$6.52' figure is what Bisyou CHARGED its customers (a pricing choice), NOT its cost to ship. I conflated the two and wrongly claimed Unilog would 'double' their cost. Their actual J&T/R3 cost is not in the data, so that comparison cannot be made yet.")
para("What we can compute is our own cost-to-ship. We priced every one of the 44,969 reconstructed orders against GE's Unilog B2C table (origin: Serra/ES filial), by destination and basket:")
table([["Cost to ship via GE's Unilog contract", "Value"],
 ["Blended cost-to-ship per order", "~R$26"],
 ["As % of AOV", "~17%"],
 ["Implied annual freight @ ~84k orders/yr", "~R$2.2M"]], numcols=(1,))
meta("Full per-order calc, summary and rate-table assumptions in Bisyou-Unilog-Freight-Cost.xlsx. UF-level representative rates; exact CEP→GEOCOM mapping would refine within a UF. No weight data, so cubed weight inferred from basket size (SE bands near-flat 0.25–2 kg).")
box('gold', [("Freight conclusion now: ", True), ("our cost-to-ship is ~R$26/order; whether that beats what Bisyou pays J&T/R3 today is OPEN until we see one month of their carrier invoices. Don't assume a saving or a loss. The real fulfilment synergy is warehousing/pick-pack; the carrier is chosen on the actual quote.", False)])

h2("9. Deal terms and negotiation levers")
bullets([
 "Royalty: cap at single digits of NET, no minimum; tie step-ups to revenue we rebuild.",
 "Purchase option: fix the strike now and low — we rebuild the equity during the licence.",
 "Marketing-efficiency proof: structure a short paid test / earn-in to validate ≤35%-of-net acquisition before deep commitment.",
 "Agency: decide inherit-vs-break-fee on the Meta/Google contract (to Nov-2026); don't commit to its R$60k/mo minimum beyond our plan.",
 "Dead channels are upside, not value: don't pay for DPSP/B2B (dead) or the TikTok peak.",
 "Clean reps: ANVISA active with dates, trademark uncontested, no live litigation, access at closing."])

h2("10. Verdict and next steps")
box('verdict', [("CONDITIONAL GO. ", True), ("The verdict survives your corrections, but the reasoning changed: downside is LOWER than v1 (no working capital, no debt, clean licence); upside is NARROWER (no demand synergy — pure operational arbitrage). It holds because the cost structure tolerates a near-halving of revenue or marketing far less efficient than the incumbents' best. It fails if the royalty is greedy, the own-site base is still in free-fall, or we cannot prove standalone acquisition under ~35% of net.", False)])
h3("Immediate next steps")
bullets([
 "Ask Ivan for May/June own-site revenue and one month of actual J&T/R3 carrier invoices.",
 "Get the royalty terms and purchase-option strike from Edson, in writing.",
 "Design a small standalone paid-acquisition test to validate the ≤35%-of-net marketing gate before committing.",
 "Confirm ANVISA / trademark / litigation reps before any term sheet."], ordered=True)

meta("Sources: Bisyou Road Show deck; trial balances Jan–Apr 2026; relatorio faturamento_GE.xlsx (45,626-order reconstruction); GE Unilog B2C freight table. Working papers in sandbox/bisyou/diligence/. Pro-forma figures illustrative and assumption-driven; internal decision-making only.")

doc.save("Bisyou-Investment-Memo.docx")
print("saved docx v2")
