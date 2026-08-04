# GE Beauty — Review Collection + Repurchase Machine

A self-contained, stateful engine that turns proven-happy buyers into reviews and repeat
purchases. **Depends on no session context.** Every run pulls live data, reads its rules
from `config.json`, persists progress to `state.json`, and emits Zoko-ready send lists.
Any session (or a cron) can run it cold.

## Design principles
- **Live-pull, not cached:** Shopify order history + Loox review corpus fetched each run.
- **Stateful:** per-customer stage + timestamps in `state.json` (gitignored). Reminders and
  fatigue guards work across runs because state persists, not because a session remembers.
- **Config-driven:** windows, floors, cadences, reward tiers, allocation rules all in
  `config.json`. No magic numbers in code.
- **Idempotent + fatigue-safe:** re-running the same day changes nothing; nobody is messaged
  twice inside the cooldown; one message per customer per run.
- **Measurable:** deterministic 10% holdout; Loox review-created webhook (or corpus diff)
  measures lift per cohort.

## Data sources
| Source | Use | Status |
|---|---|---|
| Shopify Admin bulk (orders + line items + customer name/phone) | purchase history, eligibility, refill timing | ready |
| Loox Merchant API (`/product-reviews`) | who reviewed what (by `customerId`) + corpus counts | ready (creds in `gebeauty/.env`) |
| Zoko engagement (delivered/read/clicked per broadcast) | Stage 1 "interacted" reminder targeting | **dependency** |
| Shopify discount usage OR store-credit balance | Stage 2 "earned reward but unused" detection | **dependency (reward model)** |

## Eligibility (per customer × product)
Bought it, not returned (order not cancelled/refunded), past the min usage window. Advocate
(repeat) is the strongest signal. Excludes: already reviewed that product (Loox `customerId`),
active `assinatura` for it, no valid mobile.

## Empirical refill window
Per product, derived from the median 1st→2nd repurchase gap (recomputed each run). Refill-due
= last purchase between ~0.75× and ~2× that median. (Cachos ~139d, Liso ~174d, Mist ~63d, etc.)

## Review-ask allocation (one product per customer)
Priority order, among eligible products the customer bought:
1. **Repeat-of-same-product** — if they bought a product 2+ times, ask about that one
   (most repurchases wins; tie → most recent). Truest "loved it" signal.
2. **Thinnest corpus** — else the eligible product furthest below the review floor
   (level-up-to-floor, default 150). Tie → most recent.
3. Single-product buyers: no choice.

## State machine (per customer)
```
              initial ask (Stage A)
                     │
      ┌──────────────┼───────────────────────────┐
      │ no review    │ reviewed (Loox)            │ no engagement, cooldown exceeded
      ▼              ▼                            ▼
 interacted?    earned reward code          (drop / exhausted)
  │ yes              │ used?
  ▼                  ├─ yes → DONE (converted)
 Stage B remind      └─ no  → Stage C: one-tap reorder w/ code (repurchase nudge)
 (nudge review)

  lapsed (no purchase past 2× refill window) ─────► Stage D: cashback reactivation
```

## Send streams (outputs per run, one Zoko list each)
- **A. Initial ask** — eligible, never contacted. Review-for-reward; product = allocation.
- **B. Interacted reminder** — asked ≥`remind_interacted_days` ago, engaged (opened/clicked)
  but no review. *(needs Zoko engagement; fallback = all non-reviewers, coarser.)*
- **C. Earned-but-unused reorder** — reviewed + got a reward code, unused ≥`remind_unused_days`.
  One-tap reorder link with code pre-applied. *(needs reward-code usage data.)*
- **D. Win-back** — lapsed past 2× refill window, no repurchase. Store-credit/cashback
  reactivation (reuses `cashback_generate.py` / `apply_store_credit.py`). Separate offer.

## Outputs
`out/<YYYY-MM-DD>/stream-{A,B,C,D}.xlsx` — First Name · Phone (E.164) · Product · Segment ·
Review Link (`?ref=review`) · Reorder Link (code pre-applied, Stream C) · Holdout · reason.
Plus `out/<date>/summary.md` and a refreshed `state.json`.

## Measurement
10% deterministic holdout (md5 by phone). Lift = review-creation rate and repurchase rate,
send vs holdout, read from the Loox corpus diff + Shopify orders on the next run.

## Run model
`python engine.py` (manual) or scheduled. Each run: pull → compute → advance state → emit.
Cooldown (`min_days_between_messages`) prevents cross-stream fatigue.

## Open dependencies (gate Streams B & C and win-back offer type)
1. **Zoko engagement export/API** — enables B (remind only those who engaged). Without it, B
   degrades to "remind all non-reviewers."
2. **Loox reward model** — is the photo/video reward a *unique-per-customer discount code* or a
   *shared code* or *store credit*? Determines how we detect "earned but unused" (Stream C) and
   how the reorder link pre-applies it.
3. **Win-back offer** — confirm Stream D reuses the BEAUTYBACK store-credit reactivation.

## Config
See `config.json`. Change rules there, never in code.

## Credit ledger — the record of what was actually credited
`learning/credit-ledger.jsonl` (PII, gitignored) is the canonical append-only ledger of every
store-credit event: wave issues, expiry extensions, keeper-rule corrections, manual credits.
It consolidates what used to live only in the per-script idempotency state files — those files
remain the re-run guards, but the ledger is what you read to answer "what have we issued, to
whom, and what's still live."

**Hard convention: any script or session that credits or debits a customer's store-credit
account appends one row** — including one-off manual credits issued straight through the API:

```python
from credit_ledger import append_event
append_event(event="issue", source="manual", customer_gid=gid, amount=138.64,
             ts="2026-07-16T17:30:33Z", expires_at="2026-09-05T02:59:59Z", notes="why")
```

`python credit_ledger.py` prints the summary (counts + BRL totals per source/event, unexpired
issues). `--backfill` idempotently re-imports the four state files + known manual credits —
safe to re-run anytime. The ledger tracks the issuance side only; redemptions and expiry burn
live in Shopify.
