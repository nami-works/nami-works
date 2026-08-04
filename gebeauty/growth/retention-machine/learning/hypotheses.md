# Hypotheses backlog — retention machine

Things we intend to test as the learning phase matures. Each: statement · rationale ·
test design · metric · status. Registered here so they're not lost; promote to a live
experiment (arms in `sends.jsonl`) when we run them.

---

## H-TIMING-01 — Personalized send-time beats fixed afternoon (Lucas, 2026-07-06)

**Statement.** Sending the WhatsApp ~15 min *before* a customer's habitual purchase
time-of-day (bucketed into half-hour chunks) cuts through the noise and lifts redemption,
vs. a fixed early-afternoon send.

**Rationale (Lucas).** If someone usually buys at 1PM, they're likely on their phone /
browsing Instagram around then. A good offer arriving at that same time competes better for
attention. Key nuance: this is about **attention/reachability**, not purchase-habit — so the
weak observational signal below does NOT refute it; only a causal test can.

**Prior evidence (2026-07-06).** Observational per-person timing habit is weak: weekday modal
share 47% vs 43% random (3+ orders); hour-block 65% vs 63% random. Population afternoon peak
(13h–17h BRT) is strong but is a universal pattern, not personal. So the personalized arm is
fighting a weak habit signal — the test decides if attention-timing wins anyway.

**LIVE FROM DAY 1 (Lucas, 2026-07-06).** Run the timing split on the very first sends of BOTH
cohorts (still-active + reactivation/inactive) so the data isn't distorted by starting mid-flight.
Not postponed.

**PAW** = each customer's modal 30-min purchase slot (from order timestamps). **PAW send = 15 min
before that slot** (e.g. slot 13:30 → 13:15). **Control = land 13h–14h BRT**.

**The split (per Lucas), for N to send:**
- **PAW arm = exactly N/2**, drawn ONLY from customers whose PAW is inside **9h–21h**.
- **Control arm = the other N/2 = (remaining in-window customers) + (ALL out-of-window customers)**,
  all sent 13h–14h.
- Assignment **within the in-window pool is randomized** (deterministic by phone hash) so PAW vs
  control is unbiased. Out-of-window customers always go to control (they can't be in PAW).

**Analysis.** Causal PAW effect = **PAW arm vs the control arm's IN-WINDOW members** (both randomly
drawn from the in-window pool → apples-to-apples). Out-of-window control members are a **separate
stratum** (all 13–14h; not part of the A/B, but their redemption reveals if late-hour buyers are
reachable at all).

**Scheduler.** Half-hourly job fires PAW sends 15 min before each :00/:30 slot, plus a 13h–14h
control batch. Log `timing_arm` (PAW/control), `paw_slot`, `in_window`, `send_slot` per customer.

**Metric.** Primary: redemption / reactivation rate A vs B. Secondary: **Zoko read rate**
(directly tests "cut through the noise"). Log `send_slot` (the 30-min chunk), `arm`,
`purchase_slot` per customer.

**Needs.** Per-customer purchase-slot (have it), a **half-hourly send scheduler** (fires each
:00/:30 minus 15 min), Zoko read data.
**Status.** Registered, not run.

---

## H-WEEKDAY-01 — Weekday-snap of the push
**Statement.** Landing the push on a preferred weekday (Fri–Sun) lifts redemption.
**Prior.** Population weekday spread only ~13% (Sáb vs Qui); per-person weekday near-random
(4pp over chance). **Low priority** — likely noise once hour is controlled. Test only if
H-TIMING-01 shows day effects. Status: registered, deprioritized.

## H-EXPIRY-01 — Optimal expiry duration
**Statement.** There's an expiry length that maximizes redemption net of cost/urgency.
**Test.** Vary expiry across waves (cohorts too small to split within a wave), accumulate in
the log. Status: registered; learn cross-wave.

## H-MECHANISM-01 — Credit vs. review for the 2nd purchase (<60d one-timers)
**Statement.** For recent one-timers, one of {store credit, review-ask} converts the 2nd
purchase better. **Test.** Holdout / credit / review, measured on 2nd-purchase conversion.
Spec: `inputs/growth-gebeauty-second-purchase-test-2026-07-06.md`. Status: designed, not run.

## H-CROSS-TEXTURE-01 — Loyalty-gated "rediscover your natural texture" cross-sell (Lucas, 2026-07-06)
**Statement.** For **loyal straight-hair** customers (own Primer Liso, high frequency/tenure),
deliberately recommend **Booster Definição** (a curl-definition product) with the *"redescubra /
abrace sua textura natural"* framing — an invitation to explore their natural texture. This is a
real GE punch-line for Booster Definição.
**Why gated.** Site-wide it would alienate customers not ready for the provocation (why the
hair-type guard excludes curl→straight by default). But for *loyal* customers it's a premium,
insider invitation, not a mismatch. So the guard's exclusion becomes a **deliberate, loyalty-gated
exception**.
**Design.** Among straight-hair customers, gate on loyalty (5+ orders OR long tenure); for those,
override the guard to recommend Booster Definição with the natural-texture copy. Measure
conversion **and** sentiment (opt-outs / complaints must stay flat — this is a provocation).
**Status.** Registered, future improvement (after the base recommender ships).

## H-CALENDAR-01 — Double-date sale-event confound (Lucas, 2026-07-07)
**Alert.** The reactivation wave fired 07-06 and its strong day-1 read (0.51% SEND, R$15.7k, 63
redemptions) lands on **07-07 (7/7)** — an emerging Brazilian "double-date" online sales event
(dd=mm). General elevated spend propensity may be inflating results.
**What's already controlled.** The SEND-vs-HOLD holdout nets out *general* calendar uplift — both
arms live through 7/7, so the measured **lift** is largely robust. Early corroboration: HOLD = 0
buyers day-1 (if 7/7 alone drove buying, HOLD would also move — small n, not conclusive).
**Residual risk.** A **credit × sale-day interaction** (credit converts better when people are
already in buying mode) would inflate the lift *magnitude* vs an ordinary day → overestimate of
everyday effectiveness.
**Confirm/refute.** Compare this wave's lift to future waves fired on ordinary (non-double-date)
days; watch whether HOLD buying rises on 7/7. **Action: none now, just monitor.**

## H-SALEDAY-PUSH-01 — Landing the WhatsApp on the sale day (Lucas, 2026-07-07)
**Statement.** A WhatsApp reminder that lands *on* a double-date event (7/7) drives disproportionately
higher redemption than one sent on an ordinary day.
**Test (zero incremental cost — these non-redeemers get WhatsApp anyway; we only randomize WHEN).**
Reactivation SEND, **non-redeemers**, valid mobile, in the early high-converting bands (60–120d).
Randomize 50/50 (deterministic by GID hash):
- **Arm T (today):** push now, on 7/7.
- **Arm C (scheduled):** push 07-11 (the normal 2-days-before-expiry slot, an ordinary day).
**Metric.** Primary = **redemption within 48h of each push** (controls for T's longer runway to the
07-13 expiry); secondary = total redemption by expiry. Never touch the email HOLD arm; PAW timing
deferred to keep this single-variable. **Status: designed, awaiting go.**

## H-RECENCY-01 — When is reactivation most effective (core question)
The recency band with the best incremental lift. Measured continuously by
`measure_reactivation.py` (per-band SEND vs HOLD). Status: live (≥60d wave).
