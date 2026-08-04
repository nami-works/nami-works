# Meta account audit, and what it changes in `lp-educacional-2026-08`

Read 2026-07-31 from ad account **606199920079315 (`GE_Beauty`, BRL)**, window Jul 1 to 30 2026. Read-only, nothing was changed. Reproduce the margin table with `account_audit.py`.

Account has 7 ad accounts; the other six are read-only integration accounts (Zoko, Klaviyo, Hexagon, order updates) or USD shells with no buying. `GE Beauty (Read-Only)` 1506262694402667 is not MCP-enabled yet.

Resolved: `gebeauty` · model `dtc-purchase` · gate = 10% net floor per purchase after media AND marginal CAC under R$68 · BRL.

## Headline

R$99,116 spent, 2,322 purchases, blended CPA **R$42.69**, platform ROAS 3.75. Meta opportunity score 78.

Two caveats that change how every number below reads:

1. **CPA is not CAC.** R$42.69 is cost per purchase, including repeat buyers. The R$68 ceiling is per *new customer*. Wherever returning customers sit in the mix, true CAC is higher, so any campaign near its max CPA is already effectively over the ceiling. Splitting new from returning needs Module A.
2. **Platform purchase values run about 20% high** per the manifest note on `revenue/profit`. The margin verdicts below are therefore optimistic. Treat them as a ranking, not an audited P&L. `growth-analyst` owns the audited call.

## Margin-true verdict per campaign

`maxCPA` is the media cost per purchase that still lands exactly on the 10% floor at that campaign's AOV.

| campaign | spend | AOV | CPA | maxCPA | net% | ROAS | LPV→ATC | status | verdict |
|---|---|---|---|---|---|---|---|---|---|
| [CS] [REGULAR] [CONVERSAO] [ABO] [MISTO] | 40,488 | 187 | 41.15 | 68.98 | 24.0% | 4.56 | 21.8% | ACTIVE | clears |
| [CS] Novos Vídeos, Teste de criativos | 15,185 | 184 | 39.14 | 67.38 | 24.4% | 4.71 | 39.0% | ACTIVE | clears |
| [CS] Primer Liso, Teste de criativos | 9,484 | 222 | 95.80 | 87.29 | 6.4% | 2.32 | **7.0%** | ACTIVE | **below floor** |
| [CS] Primer Cachos, Teste de criativos | 8,635 | 211 | 67.46 | 81.32 | 16.2% | 3.13 | 16.9% | ACTIVE | clears, at ceiling |
| [GE] MIST-LAUNCH, Hooks ABO | 7,102 | 205 | 645.65 | 78.33 | -249.7% | 0.32 | 10.5% | PAUSED | below floor |
| [CS] Primer Cachos, Coloquial Estático | 3,174 | 271 | 126.96 | 110.76 | 4.4% | 2.13 | 24.1% | PAUSED | below floor |
| [CS] Primer Cachos, Institucional | 2,747 | 232 | 91.56 | 92.48 | 10.4% | 2.54 | 29.1% | PAUSED | floor ok, CAC over |
| [CS] Primer Liso, Institucional | 2,176 | 222 | 127.97 | 87.12 | -7.3% | 1.74 | 31.7% | PAUSED | below floor |
| [CS] Primer Liso, Coloquial Estático | 2,023 | 216 | 183.90 | 84.15 | -33.3% | 1.18 | 23.3% | PAUSED | below floor |
| [GE] primeira-rotina-r95, TESTE | 1,584 | 126 | **21.70** | 36.63 | 21.2% | 5.80 | **53.5%** | ACTIVE | clears |
| [GE] [GANHE MINI] [NOVOS] | 1,508 | **25** | 3.40 | **-16.31** | -64.1% | 7.36 | 60.8% | PAUSED | below floor, see note |
| [CS] Primer Cachos, Review | 1,320 | 208 | 48.89 | 79.77 | 24.0% | 4.26 | 38.2% | PAUSED | clears |
| [CS] Novos Vídeos, Validados | 1,169 | 211 | **26.57** | 81.21 | **34.4%** | 7.93 | 26.9% | ACTIVE | clears, best |
| [CS] Primer Liso, Review | 1,009 | 217 | 32.54 | 84.50 | 32.5% | 6.67 | 63.3% | PAUSED | clears |
| [GE] MIST, TESTE | 929 | 146 | 929.46 | 47.43 | -556.1% | 0.16 | 12.7% | **ACTIVE** | **below floor** |
| [CS] Body & hair mist, Lançamento | 381 | 316 | 95.31 | 119.53 | 17.7% | 3.32 | 10.6% | ACTIVE | floor ok, CAC over |
| [CS] PRIMER LISO INTACTO, Teste | 203 | 166 | 40.54 | 57.78 | 19.8% | 4.10 | 28.3% | PAUSED | clears |

---

## Finding 1. The Primer Liso leak is a destination problem, and it is the biggest fixable number in the account

Ad-level funnel inside `[CS] Primer Liso | Teste de criativos | ABO`:

| ad | CTR | LPV | cost/LPV | ATC | LPV→ATC | CPA |
|---|---|---|---|---|---|---|
| Ad05 Carol Bassi | **10.93%** | 2,094 | R$0.36 | 52 | **2.5%** | 68.41 |
| Ad03 Antonella Braga | 8.67% | 694 | R$0.54 | 9 | **1.3%** | 92.84 |
| Ad1 Rafa Ribs UGC | 8.05% | 597 | R$0.45 | 4 | **0.7%** | 267.33 |
| Ad01 Mari Gonzalez | 7.02% | 621 | R$0.57 | 21 | 3.4% | 88.66 |
| Ad02 Antonella Braga | 5.55% | 402 | R$0.74 | 8 | 2.0% | 148.69 |

Now the same metric inside `[GE] primeira-rotina-r95`:

| ad | CTR | LPV | ATC | LPV→ATC | CPA | ROAS |
|---|---|---|---|---|---|---|
| pr95_D_ritual-menos100 | 1.71% | 152 | 106 | **69.7%** | 16.00 | 6.31 |
| pr95_J_capilar-95 | 1.61% | 115 | 72 | 62.6% | 19.85 | 6.96 |
| pr95_F_experiencia-menos100 | 1.54% | 114 | 67 | 58.8% | 20.02 | 7.04 |
| pr95_I_experiencia-95 | 1.77% | 126 | 66 | 52.4% | 16.11 | **9.28** |
| pr95_H_completo-95 | 1.68% | 140 | 71 | 50.7% | 12.42 | 8.45 |
| pr95_B_presente | 1.41% | 91 | 34 | 37.4% | 52.55 | 1.99 |

The coiffeur and influencer creative buys landing-page views at **R$0.36 to R$0.57**, which is exceptional, and then converts them at 1 to 3 percent. The routine offer converts comparable traffic at 37 to 70 percent. That is a 20x to 50x gap sitting entirely *downstream of the click*.

The creative is not the problem. Carol Bassi at 10.93% CTR is the best hook in the account. The 2,094 landing page views she bought for R$752 produced 52 add-to-carts. At the pr95 conversion rate that same traffic would have produced roughly a thousand.

This is the single strongest validation of the landing-page work, and it says the LP set should not be scoped only to the five educational posts.

## Finding 2. Stop buying acquisition on the mist

Combined mist spend R$8,413 for 12 purchases, about R$701 per purchase against a max CPA near R$47. `[GE] MIST · TESTE` is **still ACTIVE** at ROAS 0.16.

This is condemned twice over: worst acquisition economics in the account, and per `growth/docs/retention-hero-products-study.md` mist is the weakest retaining first category at 13.6%. It is a bad first purchase and a bad customer. Keep the mist as an AOV filler and a cross-sell to existing customers, not as an acquisition vehicle.

## Finding 3. The best legitimate campaign in the account is starved

`[CS] Novos Vídeos | Validados`: ROAS 7.93, CPA R$26.57, net 34.4%, headroom to R$81 max CPA. It spent R$1,169 in thirty days on a R$12.58 daily budget. This is the graduated-winners campaign and it is the highest net-margin campaign on the board. Step it up, and per doctrine step deliberately (20 to 30 percent, re-read, never scale inside learning).

## Finding 4. GANHE MINI is not the winner it appears to be

ROAS 7.36 and CPA R$3.40 look spectacular until you see AOV of **R$24.99**, which is below the price of any single product. That is the aggressive "pague só o frete" class of mechanic your cohort-isolation rule already covers, and Module A already excludes 699 such orders by default. At R$25 the order is structurally under water before any media is spent; max CPA is negative R$16.31.

Correctly paused. If it returns, tag the cohort at creation and judge it on second purchase and hero trial, never on first-order ROAS.

## Finding 5. Pipes in campaign names are corrupting Nemu attribution

`growth/references/utm-conventions.md`, golden rule 3: Nemu encodes `{{campaign.name}}|{{campaign.id}}`, and a `|` inside the name breaks the `name|id` split. It is the one thing Nemu's docs explicitly warn against.

**13 of 17 campaigns have pipes in their names**, including every Primer and Novos Vídeos campaign. Only the bracket-style names are safe (`[CS] [REGULAR] [CONVERSAO] [ABO] [MISTO]`, `[GE] [GANHE MINI] ...`).

This is free to fix and it protects every number the LP test will be judged on. Rename to the bracket convention before launching `lp-educacional-2026-08`.

## Finding 6. Test hygiene

`[CS] Novos Vídeos | Teste de criativos` ran at frequency 4.05 across thirty days. A test should read cheap and early. Paying for four exposures per person while still deciding inflates cost and biases the read toward fatigue. Widen the audience or shorten the window.

Two active ads with spend and zero purchases: `Ad2 Vídeo | Primer Liso [Marlandeiro]` (R$322, 14 ATC) and `Ad1 Vídeo | Primer Liso [Sophia Fernandes]` (R$219, 4 ATC).

## Finding 7. Meta's own recommendations, filtered through the doctrine

Opportunity score 78. Two to take, two to decline.

**Take.** Reels fullscreen 9:16 with audio, estimated 8% lower cost per result. Cheap production fix, no strategic cost.

**Take with a correction.** Auction overlap flagged across the ten `primeira-rotina` ad sets, estimated 26% lower cost per add-to-cart. Meta's fix is to merge them, which would destroy the hook test. The right fix is fewer concurrent cells, four or five rather than ten, so each still gets a fair ABO read without ten cells bidding against each other.

**Decline for now.** Advantage+ audience on the main campaign. It deliberately delivers beyond your targeting, which muddies the ABO read while hooks are still being validated. Revisit after graduation to CBO.

**Decline.** Advantage+ creative standard enhancements (visual touch-ups, text overlays, flexible media) across ten ad sets. It auto-alters creative, and the manifest is explicit that copy must never sit over the GE logo or the products. Auto-overlays can violate that rule without anyone approving it.

---

## What this changes in `lp-educacional-2026-08`

The five pages stand. The account data changes their scope, their price framing, and where the budget comes from.

**Change 1, widen the scope to the influencer traffic.** The five pages were built for five educational posts. The R$9,484 Primer Liso campaign is a larger and more urgent leak, and it is the same failure mode: strong hook, wrong destination. Route the coiffeur and escova creative to a routine landing page. `qual-finalizador.html` is the closest fit already, since it sells the routine with a finalizador included, but a dedicated escova/coiffeur page is probably worth its own variant.

**Change 2, test the entry price framing.** My pages lead with the routine at R$259. The account's best acquisition hook leads with R$95 and "menos de 100", and lands an AOV of R$125.85 at a CPA of R$21.70. My own model says a genuine R$95 single-product order fails the floor (max CPA R$18.21), so that hook only works *because the page moves the basket up*. That is a real and useful subtlety. Worth an A/B: routine-price-first versus entry-price-first with the routine as the upsell on the page. Do not ship the R$95 hook without the basket-building page behind it.

**Change 3, adopt the winning hook vocabulary.** Among the pr95 hooks, ritual, experiência, completo and capilar all came in under R$20 CPA; presente came in at R$52.55. The routine and ritual framing wins on real money. The pages already lead on rotina, so this is confirmation rather than a change, and it is a reason not to soften that language.

**Change 4, fund the test from what is already wasted.** The active below-floor spend (`MIST · TESTE` plus the below-floor portion of Primer Liso) is more than enough to fund five ABO cells without asking for new budget.

**Change 5, rename before launching.** Bracket convention, no pipes, or the LP test will be measured through a broken Nemu split.

## Recommended actions, in order

Every item below is a change to a live ad account and needs your approval. I have changed nothing.

| # | action | why | reversible |
|---|---|---|---|
| 1 | Pause `[GE] MIST · TESTE` | ROAS 0.16, CPA R$929 vs maxCPA R$47, still spending | yes |
| 2 | Rename all campaigns to drop `|` | protects Nemu attribution for every future read | yes |
| 3 | Redirect Primer Liso traffic to a routine LP | 2.5% vs 53.5% LPV→ATC on comparable traffic | yes |
| 4 | Step up `[CS] Novos Vídeos | Validados` 20 to 30% | best net margin in the account, starved at R$12.58/day | yes |
| 5 | Cut the two zero-purchase active Primer Liso video ads | R$541 spent, no purchases | yes |
| 6 | Reduce `primeira-rotina` concurrent cells from 10 to 4 or 5 | kills auction overlap without killing the hook test | yes |
| 7 | Graduate pr95 hooks D, H, I, J to CBO | all under R$20 CPA, proven in ABO | yes |
| 8 | Confirm the R$68 ceiling and split new vs returning in Module A | every verdict above assumes CPA is a proxy for CAC | n/a, analysis |

Item 8 gates items 4 and 7. Do not scale on a ceiling nobody has re-derived this month.
