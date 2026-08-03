# Session Handoff — 2026-08-03

**Target surface:** Claude Cowork — written self-contained. Cowork does NOT auto-load this repo's Claude memory, and cannot reach the Google Drive `G:` mount. Everything you need is in this file plus two repo files it names (both in the connected folder, so you *can* open them): the B2B initiative and the Excel generator.

## What this session actually produced

A **reusable toolkit for modeling GE Beauty B2B channel deals** — three general frameworks, plus one live application. The frameworks are the point; **Drogaria Iguatemi is just the first use case** that exercised them. Read the pillars first, the use case last.

- **Pillar 1 — B2B channel P&L / break-even methodology** (works for any retailer that asks for trade $ + a margin)
- **Pillar 2 — GE Beauty fiscal facts** (apply to every B2B deal: how PIS/COFINS, ICMS, and income tax actually land)
- **Pillar 3 — Excel modeling conventions** (how Lucas wants spreadsheets built so he can take them over)
- **Use case — Drogaria Iguatemi break-even** (numbers + counter-proposal state)

Durable homes in the repo (open these; they outlast this handoff):
- Pillars 1 & 2 → `.claude/initiatives/gebeauty-b2b-channels.md` (section "B2B channel P&L / break-even — reusable methodology")
- Pillar 3 → `docs/excel-conventions.md`
- Tooling → `gebeauty/scripts/build_b2b_breakeven_xlsx.py` (Excel generator) and `gebeauty/scripts/b2b_retail_pnl.py` (CLI)

---

## Pillar 1 — B2B channel P&L / break-even methodology

Any sellout-support retail channel (pharmacy, specialty, department store) that asks for a **trade investment + retailer margin** is evaluated the same way. Only the per-deal terms change.

- **sell-in = sell-out × (1 − margem do varejista).** GE invoices the retailer at sell-in; the consumer pays sell-out at the shelf.
- **The hinge:** if the 1st order is **100% bonificado (free)**, GE earns margin only on paid **reorders**. Break-even = the reorder volume whose contribution covers the fixed channel investment over the contract term.
- **DRE order (matches the BP):** Receita bruta (sell-in) → (−) impostos → Receita líquida → (−) CMV → Margem bruta → (−) frete / bonificação / trade / ativação → **Resultado** (pré-IRPJ/CSLL).
- **Two negotiable levers:** retailer **margin** and trade **investment**. Fix a target sell-out and solve for the investment the channel can fund (or vice-versa). Present it as a **sell-out × investment sensitivity grid**, green (≥0) / red (<0).
- **Closed-form Resultado** (annual, one product line/blended):
  `Resultado = sell_out × lojas × meses × [ (1−margem)(1−ICMS−PIS−feeBoniteca) − Produto% ] − frete×pedidos − bonificação − trade − ativação`
- **Useful outputs to always compute:** break-even sell-out (given a trade $), break-even/affordable trade (given a target sell-out), and an "affordable trade by sell-out" table. These map directly onto the negotiation.

## Pillar 2 — GE Beauty fiscal facts (apply to every B2B deal — confirm per deal with the accountant)

**PIS/COFINS — the big one.** It's a tax on **revenue, not profit**, so a loss never reduces it. Which rate applies depends on regime:
- **Cumulativo** (Lucro Presumido): PIS 0.65% + COFINS 3.0% = **3.65%** of revenue, no input credits.
- **Não-cumulativo** (Lucro Real): PIS 1.65% + COFINS 7.6% = **9.25%** gross, but you **credit** ~9.25% on inputs → net = 9.25% × (revenue − creditable inputs).
- **Monofásico** (Lei 10.147/2000; cosmetics NCM 33.03–33.07): the tax for the whole chain is **concentrated at the manufacturer/importer** (~PIS 2.2% + COFINS 10.3% = **12.5%**), and **every reseller downstream sells at 0%**.
- **GE's actual position: reseller of monofásico cosmetics.** GE buys finished goods from its manufacturers, who already paid the concentrated ~12.5% (embedded in GE's product cost). So **GE's PIS/COFINS on any B2B resale = 0%** — no output tax, no input credit. ➜ **No PIS/COFINS line on sell-in.** (This corrected an earlier 9.25% assumption and added ~R$33k/yr of contribution to the Iguatemi model. Ignore any pre-correction −R$36k/−R$40k figures.)

**ICMS.** Interstate ES→SP nominal is 12%. GE bills as an **ES atacadista under COMPETE-ES** → 12% de destaque, **1.1% efetivo pago**. (An INVEST-ES *indústria* path would be ~3.6% via a 70% presumed credit, but GE is the reseller/atacadista, so 1.1%.) Flag ICMS-ST interaction per product with the accountant.

**Income tax (IRPJ ~25% + CSLL 9%).** GE is on **Lucro Real and currently at a loss** → income tax = **0**, and it accrues prejuízo fiscal (carryforward, ≤30%/yr offset later). The model therefore **stops at pre-income-tax Resultado** — correct. Every R$ of channel contribution reduces the company loss 1:1 with no tax drag right now.

**COGS anchor (two lines).** Model COGS as **Produto = % of sell-out** + **fee Boniteca = % of sell-in** (a commission on the sale). For Iguatemi: Produto 22.5% of sell-out, Boniteca 8% of sell-in — from Lucas's example R$95 shelf → R$52.25 sell-in → ~R$26.5 product cost. The product cost already embeds the upstream taxes (monofásico PIS/COFINS + IPI).

## Pillar 3 — Excel modeling conventions (how Lucas works; repo-wide)

Full doc: `docs/excel-conventions.md`. Essentials:
- **HARD RULE — formula localization.** `.xlsx` stores formulas in **English tokens** + comma args; Excel *renders* them in Lucas's pt-BR (`SOMASE`, `SE`, `;`) automatically. **Always author English via openpyxl; NEVER write literal Portuguese** (`SOMASE`) into the file — Excel rejects it as `#NOME?`. Pure arithmetic is locale-independent. If a formula/chart comes back empty in Lucas's Excel, suspect a literal-PT-token bug.
- **House style** (from the GE Beauty BP): Calibri, brand-red `#DF3630` headers, pale-fill `#FFF2CC` editable inputs, accounting `#,##0`, canonical DRE line order. No merged cells. No black fills.
- **Modeling philosophy:** *every driver is an editable input cell — "variables to play with"*; formulas reference them, never bury a driver as a literal. Sensitivity grids **wire the median row/col to an input** so they re-center when the input changes.
- **Delivery workflow:** generator writes to a **staging path** → verify by recomputing independently in Python → copy the canonical file to the **shared Drive**. Recompute always (no LibreOffice headless available).
- **Filing:** Drive naming `GE Beauty_<descrição>.xlsx`; B2B home `GEB_B2B/<categoria-de-canal>/<varejista>/`.

## Use case — Drogaria Iguatemi break-even (the applied instance)

Curated SP pharmacy chain (Grupo DI). Deal terms from Gmail thread **"GE Beauty | Next Steps"** (contacts Linéia Barreto / Patrícia Sepúlvida), latest 2026-06-25. All pre-April-2026 history is out of date per Lucas.

**Their ask (NOT agreed):** margem 45% "já considerando impostos" · trade **R$150k/12mo** · 1º pedido 100% bonificado (6 un + 1 tester/SKU/loja) · pagamento 60/75d da entrega · **7 lojas SP** · entrega a **1 CD (Brooklin, SP)** · reposição semanal.

**Final model result at 40% margin (Lucas's counter):** gross margin 54.5%, contribution 53.4% of sell-in; fixed non-trade ≈ R$41.9k (frete R$26k + bonificação R$15.9k).

| Scenario (40% margin) | Resultado |
|---|---|
| R$7k sell-out/store/mo + **R$150k** trade (their ask) | **−R$3.5k (≈ break-even)** |
| R$7k sell-out + **R$100k** trade | **+R$46.5k (profit; break-even sell-out drops to R$5,274 → ~33% cushion)** |
| R$7k sell-out + R$146.5k trade | R$0 (exact break-even) |

Break-even sell-out @ R$150k trade = **R$7,131/store/mo**. Margin sensitivity @ R$7k/R$150k: 30% → +R$50k · 35% → +R$23k · **40% → −R$3.5k** · 45% (their ask) → −R$30k. **Net read:** aligned at 40% margin; the live negotiating range is **R$100k–R$150k trade** (R$100k = profit-with-cushion, R$150k = break-even).

## Key decisions (why, so they aren't re-litigated)

1. **PIS/COFINS = 0%** (reseller of monofásico) — decisive; see Pillar 2. Discard any 9.25%-based Resultado.
2. **COGS split into two lines** (Produto on sell-out, Boniteca on sell-in) — each fee on its correct base.
3. **Sensitivity grid:** X = trade investment (median col wired to the investment input), Y = sell-out (median row wired to the sell-out input), margin pinned to its input cell.
4. **Model stops at pre-income-tax Resultado** — GE at a loss → IRPJ/CSLL = 0; adding an income-tax line would be wrong.
5. **Excel authored EN, rendered PT** — non-negotiable (Pillar 3).

## What's pending

- **Lucas sends the counter-proposal to Iguatemi** (owner: Lucas). Analysis is done; message not drafted. Likely anchor: **40% margin + R$100k–R$145k trade**.
- **Accountant confirmation** (does not block): GE's NCMs are in the Lei 10.147 monofásico anexo; ICMS-ST treatment. Both only refine tax lines.
- Reusing the toolkit for the **next channel** (Sephora is mid-onboarding in the same initiative; future pharmacies go under `GEB_B2B/Farmácias/`).

## Modified files (state)

- `.claude/initiatives/gebeauty-b2b-channels.md` — **canonical.** Holds Pillars 1 & 2 (reusable methodology + fiscal facts) and the Iguatemi deal state. Open first.
- `gebeauty/scripts/build_b2b_breakeven_xlsx.py` — **complete.** Generates the Excel model with the final locked assumptions.
- `gebeauty/scripts/b2b_retail_pnl.py` — **complete.** CLI version.
- `docs/excel-conventions.md` — **complete.** Pillar 3.
- Canonical Excel deliverable → GEB_B2B Google Drive (`GE Beauty_Break-even B2B_Drogaria Iguatemi.xlsx`) — **not in repo, not reachable from Cowork.** Regenerate from the script.

## Current state — how to verify / iterate (Cowork-ready, POSIX)

No network, no Drive needed:

```bash
# from the connected-folder root:
python gebeauty/scripts/build_b2b_breakeven_xlsx.py   # writes the .xlsx to the staging path in the script
python gebeauty/scripts/b2b_retail_pnl.py             # prints the P&L / scenarios to stdout
```

Sanity check (no Excel): plug into the Pillar-1 formula with lojas=7, meses=12, ICMS=0.011, PIS=0, Boniteca=0.08, Produto=0.225, frete=500, pedidos=52, bonificação≈15,932 → at margem=0.40, sell_out=7000, trade=150000 you should get **−3,537** ✓.

## Recommended next steps (priority order)

1. **Draft the counter-proposal message** (PT) to Patrícia/Linéia off the chosen anchor (40% margin + R$100k–R$145k trade).
2. If a **client-facing proposal doc** is wanted, note the repo has a SEPARATE toolchain for that (`/b2b-proposta` skill + `gebeauty/scripts/_b2b_proposta.py`, `_b2b_excel_dashboard.py`) reading a different "Dashboard simulator" — do NOT confuse it with this break-even model.
3. Once terms are agreed, update the initiative and move the channel from "Negotiating" to onboarding.

## Context the next session needs (self-contained)

- **Two different B2B Excel tools exist.** This session's deliverable is the **break-even/P&L** model (`build_b2b_breakeven_xlsx.py`). The repo also has a richer **B2B Dashboard/Proposta** simulator (`_b2b_excel_dashboard.py`, `/b2b-proposta`) for client proposals — different artifact, don't mix them.
- **Path convention:** GE operational code is at **`gebeauty/…` at repo root** (the old `sandbox/gebeauty/…` layout was relocated). The `Desktop/nami-works` checkout this work was authored in no longer exists; the canonical repo is the connected folder.
- **Cowork limits:** no Google Drive `G:` mount, no auto-loaded Claude memory. Durable knowledge is in this handoff + the two repo files it names.
- **Working tree is very dirty** (100s of files from other sessions on `main`). Never `git add .` — stage only files you intentionally change.
- **Fiscal facts are "confirm per deal with the accountant"** — reusable across future pharmacy/retail channels, but not settled law.
