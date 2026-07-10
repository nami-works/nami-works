# Lending / mútuo — review playbook

## What this covers
Straight loans GE takes or gives: `contrato de mútuo`, CCB-styled instruments, intercompany
loans (esp. BLOG/Garotas Estúpidas ↔ GE), and bank credit lines. Distinct from
[receivables-financing](receivables-financing.md) (which sells/discounts receivables) — here cash
is lent against a promise to repay, no receivables change hands. When GE is the **borrower**,
"favorable" = low rate, no/limited guarantees, flexible repayment, narrow default triggers.

## Red-flag checklist (Brazil-tuned)
1. **Rate + unit** — confirm the remuneratory rate states a time unit ("ao mês"); a bare "X%" can be
   argued as flat-for-the-period. Separate remuneratory from moratory (mora % + multa %).
2. **"Líquido" wording** — net-of-tax means the borrower grosses up: bears **IOF/crédito** (~0.38% +
   ~0.0082%/day) and any IRRF. Real cost > stated rate. Quantify it.
3. **Maturity shape** — bullet vs amortizing. A short bullet creates refinance/liquidity risk; check it
   lines up with the cash source meant to repay it.
4. **Prepayment** — is early payoff free and penalty-free? (Favorable to a borrower; lets you stop interest.)
5. **Guarantees** — aval, fiança, `devedor solidário`, collateral. For intercompany, none is the norm and
   the win; flag any personal guarantee.
6. **Acceleration (`vencimento antecipado`)** — how broad are the triggers, is there notice, is there a
   cure period? Watch **cross-default** that reaches affiliates/controllers and *any* third-party contract.
7. **Assignment** — can the lender assign the credit (and disclose your data) without notice? For a
   related-party loan that defeats the flexibility; restrict it.
8. **Set-off (`compensação`)** — unilateral, across the economic group? Lender-favorable.
9. **Instrument label** — a "Cédula de Crédito Bancário" issued to a non-financial lender is mislabeled
   (CCBs run to financial institutions); usually still stands as mútuo + título executivo extrajudicial.
10. **Related-party hygiene** — arm's-length terms for tax/transfer-pricing; does the single contract
    capture the full intercompany exposure or just a slice?

## Locked lessons
- A bullet intercompany loan is cheap and flexible but only safe if prepayment is free AND the repayment
  cash source clears the maturity date — otherwise it's refinance risk dressed as a bridge.
- "Líquido" shifts the tax burden to the borrower; the sticker rate understates cost.
- Cross-default + free-assignment clauses quietly convert a friendly related-party loan into third-party risk.

## BR-law anchors
Código Civil arts. 586+ (mútuo), 333 & 1425 (vencimento antecipado), CPC 784 (título executivo) ·
IOF/crédito on loans · related-party/transfer-pricing scrutiny.

## Deals seen
- **2026-06 — BLOG (Garotas Estúpidas) → GE, R$450k** · bullet 10/08/2026, 1.3% "líquidos", no guarantees,
  free prepayment; downsides = hard ~52-day balloon, 10% late multa, broad cross-default + free assignment.
  GE's BATNA to Ghia. See `deals/2026-06_blog-mutuo-450k.md`.
