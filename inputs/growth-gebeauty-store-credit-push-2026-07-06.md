# GE Beauty — Store-Credit Reactivation Push (2-week revenue + first incrementality read)

**Status:** cohort built, spec drafted. NO issuance yet — gated on a confirm-run smoke test.
**Date:** 2026-07-06. **Window:** ~2 weeks. **Owner:** cto build / lucas money+copy approval.

## Objective (dual)
1. **Short-term revenue uplift** inside ~2 weeks.
2. **First decisive learning** for the long-term retention machine: does native store credit drive
   *incremental* repurchase (vs. a holdout), net of credit cost? (The cannibalization question.)

This is the revenue-first opener, NOT the clean 3-arm tender/conditionality experiment (code-vs-credit,
free-vs-earn) — those are the next wave.

## Mechanism
Native Shopify **store credit** (Plus plan; issue + 60-day expiry + claw-back debit all verified live).
- Credit = **20% of the customer's last paid order subtotal**, **R$120 ceiling, R$10 floor**.
- **Expiry: 60 days** from grant. **Claw-back** (`storeCreditAccountDebit`) on refund/cancel.
- Auto-applies at checkout for logged-in customers (login accepted; credit already redeems on GE today).

## Cohort (built — `review-repurchase-machine/out/store-credit-push-2026-07-06/cohort.xlsx`)
Due-to-refill = any purchased target product inside its empirical refill window (0.75x–2x median gap),
not lapsed beyond, **not already holding store credit** (131 excluded), valid mobile, credit ≥ R$10.
Anchor = the customer's most-due product.

| | Count |
|---|--:|
| Cohort total | 16,359 |
| **SEND** | **14,666** |
| **HOLD (10%)** | **1,693** |
| Skipped < R$10 floor | 215 |

- **Max credit exposure (SEND): R$668,040** (ceiling, redemption-gated — not cash out).
- Avg credit/SEND: **R$45.55**; at R$120 ceiling: 233 (2%).

## Holdout
10% deterministic (md5 by phone). This is the **incrementality instrument** — the deciding metric is
**incremental repurchase vs. holdout, net of credit cost**, not raw redemption (a due-now cohort rebuys
anyway). Do not shrink or skip it.

## Channel + cadence (Zoko WhatsApp)
- **Touch 1 (now):** grant + delight. "Você tem R$X de crédito na sua conta, válido por 60 dias."
  Login-carrying link so credit is visible at checkout.
- **Touch 2 (~day 10-12):** mid-window nudge. "Você deve estar acabando — use seus R$X."
- **Touch 3 (~day 50):** expiry warning (fires outside the 2-week window; measured at later readout).

## Metrics
- **Leading (daily):** delivered / read / click / login-success / add-to-cart / redemption-started.
- **Primary:** incremental repurchase rate vs. holdout, net of credit cost.
- **Economic:** redemption AOV vs. credit value (flag arms where AOV < ~2x credit).

## Feasibility — CLEARED
Shopify Plus; `storeCreditAccountCredit` (creditAmount/expiresAt/notify) + `storeCreditAccountDebit`
verified; 60-day expiry already in production; 131 customers have issued+redeemed credit today.
Soft item: confirm customer-account type (classic vs new/OTP) for login friction — optimization, not a gate.

## Guardrails / kill
- Claw-back on refund/cancel (keeps 60-day-from-grant exact).
- Don't double-issue to existing holders (excluded). Their prior credit expires ~Jul 19 — optional free
  expiry-nudge for adjacent in-window revenue.
- Fatigue: suppress overlap with the review-repurchase pilot (no double-messaging).
- Ops-kill if login/redemption fails at scale (customers can't see credit = broken promise).
- Money: no total cap (Lucas's call); bound-if-desired lever = tighten due-window to first-half.

## Smoke test (confirm-gated, before any bulk)
`review-repurchase-machine/out/store-credit-push-2026-07-06/smoke-test.xlsx` — issue to 3 customers,
verify credit posts + correct 60-day expiry + auto-applies at checkout, then release the full SEND.
