---
id: gebeauty-b2b-channels
name: GE Beauty B2B retail channels (Sephora, Drogaria Iguatemi + future)
owner: shared
status: in-progress
priority: high
created: 2026-06-23
target: null
current_phase: 1-sephora-registry-gaps
next_blocker: "Sephora: CSV refreshed 2026-07-14 — all internal fields filled; remaining gaps external-owner (Anvisa 19 SKUs/Raphael, ICMS%+IPI%/contador, B2B price 10 new SKUs + dates + ativação/Lucas, Canal+Vendor+SAP+Markup/buyer). Confirms resolved 2026-07-16: GEB 111 discontinued (out), GEB 122/123/124 in now with gaps, serum GEB 126 added. Full list: gebeauty/sephora/sephora_gaps.md. Drogaria Iguatemi: counter-proposal pending (Lucas) — 40% margin + ~R$145-150k trade breaks even at ~R$7k sell-out/loja/mês."
next_owner: lucas
stakeholders:
  - GE Beauty
  - Sephora Brasil (specialty retail — onboarding)
  - Drogaria Iguatemi / Grupo DI (farmácia curada — negotiating)
working_agreement: ~/.claude/projects/c--claude/memory/feedback_cto_contract.md
---

## Why

Retail B2B channels (specialty stores, department stores, pharmacies) are a different animal
from subscription boxes: they require ongoing sellout support — co-marketing, staff training,
in-store merchandising, replenishment cadence, and promotional alignment. GE Beauty can't just
drop product and walk away. Getting in is harder, but the brand-building value and repeat volume
justify the overhead. Sephora Brasil is the first target.

Subscription box deals (B4A, Magenta) are tracked separately in
`.claude/initiatives/gebeauty-subscription-boxes.md` — those are discount-first and don't
require sellout support.

## Channels

| Channel | Type | Status |
|---------|------|--------|
| Sephora Brasil | Specialty retail | Onboarding — registry mapper built, gaps pending |
| Drogaria Iguatemi (Grupo DI) | Farmácia / curated retail | Negotiating — break-even model built, counter-proposal pending |
| TJX (TJ Maxx / Marshalls, US) | Off-price / excess-inventory export | **Parked** — blocked on FDA/MoCRA compliance; door kept open (see below) |

## B2B channel P&L / break-even — reusable methodology

Any sellout-support retail channel that asks for a **trade investment + retailer margin** is
evaluated with the same model. Tooling and GE's fiscal facts below are **reusable across
channels**; only the per-deal terms change. Built this way for Drogaria Iguatemi 2026-06-29.

**Tooling**
- `gebeauty/scripts/build_b2b_breakeven_xlsx.py` — generates the live Excel model
  (openpyxl): every driver an editable input cell; DRE + a sell-out × investment sensitivity
  grid recompute. Follow `docs/excel-conventions.md` when building/editing any `.xlsx`.
- `gebeauty/scripts/b2b_retail_pnl.py` — CLI version of the same P&L.
- Canonical Excel per channel: Drive `GEB_B2B/<categoria>/<varejista>/GE Beauty_Break-even B2B_<varejista>.xlsx`.

**P&L logic (the rationale)**
- `sell-in = sell-out × (1 − margem do varejista)`. GE invoices sell-in; consumer pays sell-out.
- **Hinge:** if the 1st order is 100% bonificado (free), GE earns margin only on paid
  **reorders** → break-even = the reorder volume whose contribution covers the fixed channel
  investment over the contract.
- **DRE order (BP):** Receita bruta (sell-in) → (−) impostos → Receita líquida → (−) CMV →
  Margem bruta → (−) frete / bonificação / trade / ativação → Resultado (pré-IRPJ/CSLL).
- **Levers to negotiate:** retailer margin + trade investment. Fix a target sell-out, solve
  the investment the channel can fund (or vice-versa). Grid = sell-out × investment, green/red.

**GE fiscal facts (reusable — confirm per deal with the accountant)**
- **PIS/COFINS = 0% on GE's B2B resale.** GE is a **reseller of monofásico cosmetics**
  (Lei 10.147/2000; NCM 3305/3307). GE's suppliers (the manufacturers) already paid the
  concentrated ~12,5% upstream — embedded in GE's product cost. Downstream reseller = alíquota
  zero, no input credit. So **no PIS/COFINS line on sell-in**.
- **ICMS ≈ 1,1% efetivo** via **COMPETE-ES atacadista** (GE fatura como atacadista no ES;
  12% de destaque, 1,1% pago). Flag: interação com ICMS-ST por produto.
- **COGS ≈ 27,5% do sell-out**, modelado em 2 linhas: **Produto 22,5% do sell-out + fee
  Boniteca 8% do sell-in** (Boniteca = comissão sobre sell-in). Custo do produto já embute
  os tributos pagos a montante.
- **IRPJ/CSLL:** GE em Lucro Real, hoje em prejuízo → imposto de renda = 0. O modelo para no
  Resultado pré-IR (correto); a contribuição do canal reduz o prejuízo 1:1. PIS/COFINS e ICMS
  são tributos sobre receita — não mudam com o prejuízo.

## TJX (TJ Maxx / Marshalls) — PARKED 2026-07-16 (thread "Business Inquiry")

Inbound from **Nancy McCafferty, Sourcing Manager, TJX South America Buying Office**
(nancy_mccafferty@tjx.com), interested in GE's textured/curly-hair treatment line for US
off-price shelves (TJ Maxx / Marshalls).

- **Legitimacy: confirmed.** TJX = Fortune 100 off-price retailer, ~$60.4B rev FY2026,
  ~5,085 stores, ~$5B beauty globally. Not a scam, not a broker. Buys outright (no consignment,
  no returns, no slotting fees). Model: "Better Brands for Less," sells 20–70% below MSRP.
- **My recommendation was Conditional GO** — but strictly as an **excess-inventory / closeout
  valve**, never as GE's US market entry with current hero SKUs (off-price debut would anchor
  the brand as discount in a virgin market with no full-price channel yet). One-pager brief:
  https://claude.ai/code/artifact/0d7c901e-1c62-4162-89f8-40ec20829928
- **Why parked (Lucas, 2026-07-16):** even the closeout path is blocked today — GE has **no
  FDA/MoCRA-compliant packaging and no US registration**. Current stock is produced for the
  Brazilian market, so nothing is legally shelf-ready in the US regardless of commercial terms.
- **Door kept open.** Lucas replied to Nancy (2026-07-16) asking whether TJX requires products
  to be fully FDA-compliant (labeling, facility registration, US Responsible Person) before
  their buyers can purchase, or whether TJX has an import/relabel pathway for goods originating
  outside the US. **Next: await Nancy's answer on who carries the compliance burden.**
- **Unpark trigger:** either (a) GE has FDA/MoCRA-compliant packaging + registration in hand for
  the relevant SKUs, or (b) Nancy confirms TJX handles compliance/relabeling on their side.

## Drogaria Iguatemi — deal state (2026-06-25, thread "GE Beauty | Next Steps")

- Contatos: Linéia Barreto (Curadoria), Patrícia Sepúlvida (Trade Mkt).
- **Pedido deles (NÃO acordado):** margem 45% "já considerando impostos"; trade R$150k/12 meses;
  1º pedido 100% bonificado (6 un + 1 tester por SKU por loja); pagamento 60/75 d da entrega.
- Introdução em **7 lojas SP**; entrega a **1 CD (Brooklin, SP)**; reposição semanal.
- **Resultado do modelo:** a 40% de margem (contraproposta) + R$7k sell-out/loja/mês + R$150k
  trade → **~break-even (−R$3,5k/ano)**. Break-even sell-out ≈ R$7.130; teto de trade ≈ R$146k.
- **Posição de contraproposta:** essencialmente alinhados a 40%; pedir folga fina (sell-out
  ~R$7,5k ou trade ~R$145k). **Próximo passo: Lucas envia a contraproposta.**
- Arquivo: `GEB_B2B/Farmácias/Drogaria Iguatemi/GE Beauty_Break-even B2B_Drogaria Iguatemi.xlsx`.

## Sephora registry tooling

`gebeauty/sephora/sephora_mapper.py` — reads products.json + sephora_enrich.json → CADASTROS CSV
`gebeauty/sephora/fetch_enrich.py` — pulls featured image + grounded store description per SKU
`gebeauty/sephora/sephora_cadastro.csv` — 27 rows (25 produtos + 2 acessórios), gaps [PENDENTE]
`gebeauty/sephora/sephora_gaps.md` — owner-assigned punch list (regenerated 2026-07-14)

### 2026-07-14 refresh (resumed after 3-week stall)
- Reconciled CSV to live catalog: **Mist line renumbered** 025/026/027 → 032/033/031 (same EANs);
  **GEB 111 (Charm Bag) discontinued** (Lucas 2026-07-16) — stays out of the set for good.
- **GEB 122/123/124 (Mayday shampoo/cond/leave-in): included now with gaps** (Lucas 2026-07-16).
  Not yet published on Shopify (no image/desc) — go in as [PENDENTE] rows, fill on go-live.
- **GEB 126 (Sérum Reparador Noturno Mayday) added 2026-07-16** — EAN backfilled into products.json
  from the Shopify DRAFT (`0631430720369`); still DRAFT so no image/desc, and needs volume + price.
  Kit GEB 125 stays out (bundle, no EAN).
- Auto-filled from live store / known facts: Descrição do Item (grounded), Link Imagem, Volumetria,
  Nome SAP EN, Validade Anvisa (3 anos all), Ponto de Inflamação (N/A for non-flammable; only
  GEB 008 aerosol pending FISPQ). Remaining gaps are all external-owner (see gaps.md).

Template in Drive: CADASTROS NOVOS - SEPHORA - 2026.xlsx (`1m5UHVFLbWhToN0uZrw-ngxIZNWnh2Aq9`)
Sephora folder (B2B Drive): `1vxTr2nm5bztebDz4qOOtizCwiLgDQcaM`

## Sephora registry gap map (as of 2026-06-24)

| Gap | Owner | Notes |
|-----|-------|-------|
| Anvisa process numbers — 20 SKUs | Raphael/ops | Known for GEB003/008/010/013/022 only |
| Aliq ICMS %, IPI %, Ponto Inflamação (GEB008 aerosol) | Fiscal team (accountant) | ICMS interestadual; Custo C/IPI + Total derivam do IPI |
| Canal, Nro Lojas, Vendor, SAP Code, Markup | Sephora buyer | Commercial setup — after initial contact |
| Sell-in price — 10 SKUs | Lucas | Mist (024/029/031/032/033) + Mayday (121/122/123/124/126) |

> **Note (2026-07-14):** map above updated after CSV refresh. Descrição, imagem, volumetria, SAP
> EN, validade Anvisa, e Ponto de Inflamação (não-inflamáveis) já preenchidos automaticamente.

Sell-in for the 15 original haircare SKUs: available from B2B cadastro (35% margin basis).
Confirm with Lucas whether to use those as the Sephora opening offer or set different terms.

## Flags to resolve before submitting

- **GEB008 NCM**: B2B file shows 3305.10.00 (xampus); B4A ficha + aerosol format suggest
  3305.90.00 (outras preparações capilares). Confirm with fiscal before Sephora SAP import.
- **Mist line category**: GEB024–029 use NCM 3307.20.10 — may be "FRAGRÂNCIAS/CORPO" at
  Sephora, not "CABELO". Confirm category assignment with buyer.

## Phases

- [x] 1. Map data sources + build sephora_mapper.py — done 2026-06-24
  - Data: products.json (EAN/dims/NCM), B2B cadastro (sell-in, 15 SKUs), B4A ficha (Anvisa, 5 SKUs)
  - 27 rows: 25 products + 2 accessories (Escova Oval, Escova Polvo)
  - All physical data pre-filled; fiscal + commercial fields pending
- [ ] 2. Fill registry gaps — owner: lucas
  - Collect Anvisa for 20 SKUs → Raphael
  - Collect ICMS-ST%, Ponto de Inflamação → accountant
  - Confirm NCM for GEB008 + category for Mist line
  - Set sell-in price for 10 newer SKUs
- [ ] 3. Regenerate CSV + upload to Drive + send to Sephora buyer — owner: cto (once gaps filled)
- [ ] 4. Sephora Vendor onboarding + contract negotiation — owner: lucas
- [ ] 5. Define sellout support plan (co-marketing, training, replenishment cadence) — owner: lucas
- [ ] 6. First order + go-live — owner: shared

## Notes

- 2026-06-24: Separated from subscription-box initiative. Retail B2B requires sellout support;
  boxes are discount-only. Different economics, different cadence.
- 2026-06-23: BLZ (Beleza na Web) cadastro (`1j3zFCV-g2vyzFrKfV7CqthtIageL5avK`) is the
  primary source for physical specs on the original 15 haircare SKUs. Newer products
  (Mist, Mayday) come from products.json only.
- 2026-06-23: Sephora registry also requires QUALIDADE fields (data de validade from
  fabricação). All GE Beauty products: 3 anos (1095 days per products.json shelf_life_days).

## Done means

- Sephora CADASTROS form fully filled (zero [PENDENTE] in critical fields)
- CSV uploaded to Sephora Drive folder and sent to buyer
- Vendor number and canal assignment received from Sephora procurement
- Sellout support plan documented before first order is placed
