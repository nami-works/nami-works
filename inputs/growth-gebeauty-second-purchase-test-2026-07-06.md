# GE Beauty — Second-Purchase Conversion Test (<60-day one-timers)

**Status:** designed. Depends on `ZOKO_API_KEY` (WhatsApp) + copy approval. NOT the reactivation
wave — that's the ≥60d store-credit send (firing now). This targets the opposite end: recent
buyers, before they churn.

## Why this is the highest-leverage test we can run
Only **20% of GE customers ever place a 2nd order** (80% one-and-done). Nearly all retained value
lives in that 20%. So the single biggest lever is the **1st → 2nd purchase conversion** — winning
it *before* a recent buyer joins the 80%. And because ~only 6% of customers repurchase within 60
days naturally, **cannibalization here is LOW** — a nudge to a recent one-timer is largely
incremental, not a give-away. (This corrects an earlier assumption that recent buyers = high
cannibalization; the churn rate says otherwise.)

## Question to answer
**What converts a one-timer into a repeater, and when?** Store credit vs. review-ask, across
timing bands, measured on 2nd-purchase conversion net of cost. Output = the "welcome / 2nd-order"
targeting rule for the future automatic campaign.

## Population
One-time buyers (`order_count == 1`), last order **< 60 days** ago, bought a target retail product,
valid mobile. **N = 2,975** (0–30d: 1,721 · 31–59d: 1,254). Disjoint from the ≥60d reactivation
wave, so no double-messaging.

## Arms (randomized, balanced within each timing band)
| Arm | ~N | Treatment |
|---|--:|---|
| **A0 Holdout** | ~446 (15%) | no touch. Baseline 2nd-purchase rate — the load-bearing control. |
| **A1 Store credit** | ~1,264 | issue store credit (notify OFF) + WhatsApp *thank-you / gift-toward-next* nurture (NOT reactivation framing). Expiry **21 days** (they need time to reach a repurchase trigger; no overdue-urgency). |
| **A2 Review-ask** | ~1,264 | WhatsApp review-for-reward (Loox `?ref=review` + tiered photo/video). Fresh experience → review + earned coupon. |

Bigger holdout (15%) than the reactivation wave — the incremental read *is* the deliverable here.

## Timing bands (the "when" axis)
Log + balance across **0–30d** and **31–59d**. Hypothesis: the **review** ask works early (experience
is fresh); the **credit** nudge works later (closer to a repurchase consideration). The arm × band
grid reveals the optimal timing per mechanism.

## Channel
**WhatsApp (Zoko)** for both arms — decouples from the store-credit notification email (no
single-template conflict, and per-recipient delivered/read/clicked tracking). Credit arm issues
store credit with **notify OFF** and drives via the WhatsApp message, not the email.

## Metrics
- **Primary:** 2nd-purchase conversion rate (one-timer places order #2), SEND arm vs HOLDOUT, per
  arm × timing band, **net of incentive cost**.
- **Secondary:** reviews collected (A2), incremental revenue, credit redemption, days-to-2nd-order.
- **Decision rule:** the arm × band with the best net incremental 2nd-purchase lift becomes the
  welcome-track rule; if review ≈ credit on conversion, review wins (it also builds the corpus).

## Instrumentation (same learning log)
New wave in `retention-machine/learning/sends.jsonl` (`wave: 2026-07-XX-active2nd`), `arm` A0/A1/A2,
`timing_band`, `order_count`/`is_repeat` (filter to one-timers). `measure_reactivation.py` extended
to compute 2nd-purchase conversion per arm × band. Feeds the same accumulating training set.

## Cost
Credit arm liability ~R$31k (≈1/3 of one-timers × 20%/cap120/floor10). Low, and expected to be
mostly incremental given the churn rate.

## Dependencies / sequencing
- `ZOKO_API_KEY` (WhatsApp send + engagement) — not yet provided.
- Copy: A1 "gift-toward-next" WhatsApp + A2 review WhatsApp (adapt existing drafts; NOT reactivation).
- Runs independently of the reactivation email (different channel) — no template swap needed.
- Suppress against any customer already messaged in the reactivation wave (none overlap by recency,
  but enforce the cross-wave fatigue guard anyway).
