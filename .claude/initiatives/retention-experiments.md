---
id: retention-experiments
name: GE Beauty retention machine — store-credit + repurchase-timing programs
owner: shared
status: in-progress
priority: high
created: 2026-07-31
target: null
current_phase: 3-prevention-nudge-design
next_blocker: 4 Prevention Nudge money/measurement decisions on hold at Lucas's explicit request ("hold these definitions for a bit longer") — credit terms (%/floor/ceiling), expiry window, whether to add a permanent whole-funnel pure-control holdout on top of per-step 5% holdouts, and re-confirming notify=true as the sole touchpoint. Not yet answered.
next_owner: lucas
stakeholders:
  - GE Beauty (existing-customer retention/repurchase)
  - Lucas (owns credit terms, holdout %, and every send/spend gate)
working_agreement: ~/.claude/projects/c--claude/memory/feedback_cto_contract.md
---

## Why

One macro-goal — increase retention of customers we already have — spanning several
mechanics that share the same evidence base (hero-product residuals, rescue cohort) and
the same architectural principle (always recompute full live eligibility, no
delta-since-last-run, so no customer/order is ever left behind even if a scheduled run
is missed). Distinct from [[gebeauty-acquisition-rescue]], which uses the same hero data
but for *new*-customer paid acquisition — this initiative is owned-channel (store credit,
email/WhatsApp nudges) and existing-customer only.

Sub-programs tracked under this one file:
1. **CD Extrema fulfillment-delay ops-goodwill credits** — reactive, already live.
2. **Prevention Nudge** — proactive, timed-by-product repurchase nudges to stop lapses
   before they happen (the opposite motion from a win-back).
3. **First-Routine Bundle Offer automation** — the existing manual rescue-cohort offer
   (buy shampoo, get máscara + travel leave-in or dry shampoo), not yet scheduled.
4. **Customer-level incrementality tracking** — a per-step SEND-vs-HOLD event log that
   spans all of the above, so lift is measurable at every stage, not just in aggregate.

## Phases

- [x] 1. CD Extrema batch-1 manifest + gated issuance (D+7 delivery gate, 30%/no floor/
      90-day expiry/notify=true) — done 2026-07-31. Script
      `gebeauty/scripts/_issue_cd_extrema_goodwill_credits.py`, branch
      `feat/cd-extrema-delay-tagging` (commits `d7d3768`, unpushed).
- [x] 2. CD Extrema daily cancellation reconciliation (claws back credit if an order is
      cancelled after issuance) — done 2026-07-31, same script, commit `e480290`
      (unpushed). Scheduled task `cd-extrema-goodwill-issuance`, cron `0 8 * * *`,
      `--execute --max-per-run 600`, wired to Lucas's machine.
- [x] 3. Hero-product / rescue-cohort evidence base captured into the repo from the
      claude.ai artifact — done 2026-07-31, `docs/retention-hero-products-study.md`
      (branch `docs/retention-hero-products-study`, commit `93e486a`, unpushed). Hero
      trio 001/002/008; rescue cohort 19,206 one-time buyers w/ no hero product.
- [~] 4. **Prevention Nudge design** — IN PROGRESS. Targeting cascade locked (Lucas,
      2026-07-31): SRBP-owner → strongest SRBP → personal-vs-population pace; no-SRBP →
      any-personal-repeat vs population pace; zero-repeat + zero-SRBP → routed to phase 5
      instead of a credit. Workflow diagrammed. BLOCKED on the 4 money/measurement
      decisions in `next_blocker` above — owner: Lucas.
- [ ] 5. **First-Routine Bundle Offer automation** — NOT STARTED. Targets the rescue
      cohort (one-time buyers, zero SRBP). Needs: (a) find and reuse whatever
      script/mechanism already runs this manually today before building anew, (b)
      confirm the ~21-day trigger delay, (c) its own record-keeping (not store credit,
      so `credit_ledger.jsonl` doesn't fit).
- [ ] 6. **Customer-level incrementality event log** — proposed/diagrammed only. Extends
      the existing `sends.jsonl` SEND-vs-HOLD convention to a multi-step schema (step +
      arm + path_reason per row) spanning all sub-programs above.
- [ ] 7. Launch Prevention Nudge + Bundle Offer as scheduled jobs on Lucas's machine,
      full-catch-up-on-miss guarantee verified end to end.

## Notes

- 2026-07-31 — Initiative file created this session, consolidating what had been pure
  chat-and-code work. Confirmed with Lucas: one file covers all of the above rather than
  splitting CD Extrema / Prevention Nudge / Bundle Offer into separate initiatives, since
  they're all facets of the same retention macro-goal.
- 2026-07-31 — Checked `.claude/initiatives/gebeauty-acquisition-rescue.md` first since
  its name and hero-product data looked like a possible match; it's the *paid-acquisition*
  sibling (new customers, LP + bundle-at-checkout), not this program. Cross-referenced,
  not merged — different mechanic, different customer base, different owner cadence.
- 2026-07-31 — Design correction from Lucas mid-session: earlier draft cascade logic
  (soonest-due product wins, ties broken by strength, 0-candidate dead ends allowed) was
  wrong. Corrected, dead-end-free cascade above is the only authoritative version — do
  not revert to the per-product-gate design if picked up cold.
- 2026-07-31 — All scheduled jobs stay wired to Lucas's own machine by his explicit
  choice (cloud migration — Lambda/EventBridge, ECS Fargate — was proposed and declined).
  The tradeoff (jobs only fire while the desktop app is open) is accepted; the
  full-catch-up-on-miss design is the mitigation.

## Done means

- Prevention Nudge triggers for every non-holdout customer with no dead ends, running as
  a scheduled job on Lucas's machine with full-catch-up-on-miss verified.
- First-Routine Bundle Offer is scheduled (not manual), reusing/extending whatever
  mechanism already exists rather than a parallel rebuild.
- A single customer-level event log shows SEND-vs-HOLD incrementality at every step
  across CD Extrema, Prevention Nudge, and the Bundle Offer.
- CD Extrema batch-1's reconciliation has run at least one full cycle with zero
  known-cancelled orders left holding an un-clawed-back credit.
