# Session Handoff — 2026-08-03

**Target surface:** Claude Cowork — written self-contained (Cowork does NOT auto-load this repo's Claude memory, and cannot reach the Google Drive `G:` mount). Everything you need to resume is in this file plus two repo files it points to (both live in the connected folder, so you *can* open them): the initiative and the Excel generator.

---

## What this initiative is

Evaluate and negotiate a **B2B trade deal with Drogaria Iguatemi (Grupo DI)** — a curated São Paulo pharmacy/perfumery chain (drogariaiguatemi / mydiscover / nuspace). This session built a **break-even / P&L model** to size the deal and shape GE Beauty's counter-proposal. Channel category on the B2B side: **Farmácias**. It's tracked in the B2B-channels initiative alongside Sephora.

**Source of the deal terms:** Gmail thread **"GE Beauty | Next Steps"** in Lucas's inbox (drogariaiguatemi.com.br), latest messages 2026-06-25. Contacts: **Linéia Barreto** (Coordenadora de Curadoria), **Patrícia Sepúlvida** (Coordenadora de Trade Marketing). (Ignore anything from the 2023 round — Lucas ruled all pre-April-2026 interactions out of date.)

## What was done

- Built a **percentage-driven channel P&L / break-even simulator** as a live Excel workbook (openpyxl), styled to the GE Beauty BP, with every driver as an editable input and a **sell-out × investment sensitivity grid** (green/red conditional formatting). Generator: `gebeauty/scripts/build_b2b_breakeven_xlsx.py`. CLI twin: `gebeauty/scripts/b2b_retail_pnl.py`.
- Delivered the workbook to the shared drive as `GE Beauty_Break-even B2B_Drogaria Iguatemi.xlsx` (under `GEB_B2B/…/Drogaria Iguatemi/`). **Cowork cannot reach that drive** — regenerate from the script instead (see Current state).
- Iterated the model through several corrections (see Key decisions) landing on the **final locked model** below.
- Wired the **reusable rationale** (methodology + fiscal facts + deal state) into the initiative file `.claude/initiatives/gebeauty-b2b-channels.md` so it survives across sessions.
- Established/updated `docs/excel-conventions.md` (how to build .xlsx for Lucas) — the generator follows it.

## The FINAL locked model (self-contained — this is the whole thing)

- **sell-in = sell-out × (1 − margem do varejista).** GE invoices the retailer at sell-in; the consumer pays sell-out.
- **The hinge:** the 1st order is **100% bonificado (free)**, so GE earns margin only on paid **reorders**. Break-even = the reorder volume whose contribution covers the fixed channel investment over the 12-month contract.
- **DRE (BP order):** Receita bruta (sell-in) → (−) impostos → Receita líquida → (−) CMV → Margem bruta → (−) frete / bonificação / trade / ativação → **Resultado** (pré-IRPJ/CSLL).

**Cost/tax lines (all locked with Lucas):**

| Line | Value | Base |
|---|---|---|
| Retailer margin (their ask) | 45% | — |
| **COGS — Produto** | **22.5%** | of **sell-out** |
| **COGS — fee Boniteca** | **8%** | of **sell-in** (comissão) |
| ICMS (COMPETE-ES atacadista) | **1.1%** | of sell-in |
| **PIS/COFINS** | **0%** | reseller of monofásico — see below |
| Frete ao CD | R$500/pedido × 52/ano = **R$26k/yr** | fixed |
| Bonificação (1º pedido) | ≈ **R$15.9k** | Produto% of free units (6 un + 1 tester/SKU × 15 SKUs × 7 lojas) |

At 40% margin: **gross margin 54.5%**, **contribution margin 53.4%** of sell-in.

**Deal parameters:** 7 SP stores · 12-month horizon · deliver to **1 CD (Brooklin, SP)** · weekly replenishment · payment 60/75 days from delivery · trade package **R$150k/12mo** (their ask).

## Key decisions (the "why", so they aren't re-litigated)

1. **PIS/COFINS = 0% — the decisive correction.** GE is a **RESELLER** of monofásico cosmetics (buys finished goods from its manufacturers; NCM 3305/3307 under Lei 10.147/2000). The concentrated PIS/COFINS (~12.5%) is paid **upstream by the manufacturer** and is already embedded in GE's product cost; downstream resellers sell at **alíquota zero** (no output tax, no input credit). So there is **no PIS/COFINS line on the sell-in**. ⚠️ Earlier drafts used 9.25% — **any −R$36k / −R$40k Resultado figures are stale; ignore them.** This single fix added ~R$33k/yr of contribution.
2. **ICMS ≈ 1.1%** via **COMPETE-ES atacadista** (GE bills as an ES wholesaler: 12% de destaque, 1.1% efetivo pago). Flag ICMS-ST interaction per product with the accountant.
3. **Lucro Real, currently at a loss:** income tax (IRPJ/CSLL) = 0, so the model **stops at pre-income-tax Resultado** (correct). PIS/COFINS and ICMS are revenue taxes — the loss does NOT reduce them. Channel contribution reduces the company loss 1:1.
4. **COGS split into two lines** (Produto on sell-out, Boniteca on sell-in) instead of one blended figure — each fee applied to its correct base.
5. **Sensitivity grid axes:** X = trade **investment** (median column wired to the investment input), Y = **sell-out** (median row wired to the sell-out input); margin pinned to the single margin input. Green ≥ 0 / red < 0.
6. **Excel formula localization (hard rule):** author **English** function tokens via openpyxl (`SUMIF`, comma args); Excel renders them in Lucas's pt-BR (`SOMASE`, `;`) automatically. **Never write literal Portuguese tokens** — Excel rejects them as `#NOME?`. (See `docs/excel-conventions.md`.)

## The numbers (final basis — use these)

**At 40% margin (Lucas's counter) — headline results:**

| Scenario | Resultado do canal |
|---|---|
| R$7k sell-out/store/mo + **R$150k** trade (their ask amount) | **−R$3,537 (≈ break-even)** |
| R$7k sell-out + **R$100k** trade | **+R$46,463 (profit)** |
| R$7k sell-out + R$146,463 trade | R$0 (exact break-even) |

**Break-even levers @ 40% margin:**
- Break-even **sell-out** (holding R$150k trade) = **R$7,131/store/mo**. (Holding R$100k trade → drops to **R$5,274**, a ~33% cushion under R$7k.)
- Break-even **trade** (holding R$7k sell-out) = **R$146,463**.
- Affordable trade by sell-out: R$6k → R$119.6k · R$7k → R$146.5k · R$8k → R$173.4k · R$9k → R$200.3k.

**Margin sensitivity @ R$7k sell-out + R$150k trade:** 30% → +R$50k · 35% → +R$23k · **40% → −R$3.5k** · 45% (their ask) → −R$30k · 50% → −R$57k.

**Net read for the counter-proposal:** at **40% margin** the deal is viable — their full **R$150k breaks even at a realistic R$7k/store/mo sell-out**, and it's clearly profitable at **R$100k** trade (+R$46k, with downside cushion). The live negotiating range is **R$100k–R$150k trade at 40% margin**; every R$25k conceded on trade costs ~R$25k of the R$46k buffer.

## What's pending

- **Lucas sends the counter-proposal to Iguatemi** (owner: Lucas). The analysis is done; the message isn't drafted yet. Likely anchor: **40% margin + R$100k–R$145k trade** (profit-with-cushion → thin-cushion).
- **Accountant confirmation** (does not block the counter): (a) GE's exact NCMs are in the Lei 10.147 monofásico anexo; (b) ICMS-ST treatment. Both only refine the tax lines.
- Optional: set the model to a chosen scenario (e.g. investment input = R$100k) and re-save the canonical Excel.

## Modified files (state)

- `.claude/initiatives/gebeauty-b2b-channels.md` — **complete/canonical.** Already contains the reusable "B2B channel P&L / break-even methodology", the GE fiscal facts, and the "Drogaria Iguatemi — deal state" section. Open this first; it's the durable home.
- `gebeauty/scripts/build_b2b_breakeven_xlsx.py` — **complete.** Generates the Excel model with the final locked assumptions above.
- `gebeauty/scripts/b2b_retail_pnl.py` — **complete.** CLI version of the same P&L.
- `docs/excel-conventions.md` — **complete.** House style + the formula-localization rule.
- The canonical **Excel deliverable** lives on the GEB_B2B Google Drive (file name `GE Beauty_Break-even B2B_Drogaria Iguatemi.xlsx`) — **not in the repo, not reachable from Cowork.** Treat the generator as the source of truth and regenerate.

## Current state — how to verify / iterate (Cowork-ready, POSIX)

The model regenerates with no network and no Drive access:

```bash
# from the connected-folder root:
python gebeauty/scripts/build_b2b_breakeven_xlsx.py     # writes the .xlsx to the staging path in the script
python gebeauty/scripts/b2b_retail_pnl.py               # prints the P&L / scenarios to stdout
```

To sanity-check a scenario without Excel, the Resultado formula is:
`Resultado = sell_out × lojas × meses × [ (1−margem)(1−ICMS−PIS−Boniteca) − Produto ] − frete×pedidos − bonificação − trade − ativação`
With lojas=7, meses=12, ICMS=0.011, PIS=0, Boniteca=0.08, Produto=0.225, frete=500, pedidos=52, bonificação≈15,932: at margem=0.40, sell_out=7000, trade=150000 → **−3,537** ✓ (matches the model).

## Recommended next steps (priority order)

1. **Draft the counter-proposal message** (PT) to Patrícia/Linéia off the chosen anchor (40% margin + R$100k–R$145k trade). This is the immediate deliverable Lucas is heading toward.
2. If Lucas wants a client-facing proposal document, note the repo has a **separate** B2B proposal toolchain (`/b2b-proposta` skill + `gebeauty/scripts/_b2b_proposta.py`, `_b2b_excel_dashboard.py`) that reads a **different** "Dashboard simulator" — do NOT confuse it with this break-even model.
3. Once terms are agreed, register the outcome in the initiative and move the channel from "Negotiating" to onboarding.

## Context the next session needs (self-contained)

- **Don't confuse two B2B Excel tools.** This session's deliverable is the **break-even/P&L** model (`build_b2b_breakeven_xlsx.py`). The repo also has a richer **B2B Dashboard/Proposta** simulator (`_b2b_excel_dashboard.py`, `/b2b-proposta`) used to generate client proposals from live prices — a different artifact.
- **Path convention:** GE Beauty operational code is at **`gebeauty/…` at the repo root** (the old `sandbox/gebeauty/…` layout was relocated). Use `gebeauty/scripts/…`.
- **Excel is authored EN, rendered PT** (see Key decision 6). If a chart/formula ever comes back empty in Lucas's Excel, suspect a literal-PT-token bug.
- **Cowork limits:** no Google Drive `G:` mount and no auto-loaded Claude memory. Everything durable is either in this handoff or in the two repo files it names.
- **Working tree is very dirty** (100s of files from other sessions on `main`). Do NOT `git add .` or sweep them — stage only files you intentionally change.
- **Fiscal facts are "confirm per deal with the accountant"** — reusable across future pharmacy/retail channels, but not to be asserted as settled law.
