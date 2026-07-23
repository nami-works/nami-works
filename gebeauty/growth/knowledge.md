# GE Beauty CGO — Knowledge Base

The growth office's memory: confirmed findings, insights, and open hypotheses. Append
here over time. `/growth-office` and `/growth-analyst` read this at setup so the office
accumulates knowledge instead of relearning it each session.

**How to add an entry:** one insight per line — the claim, its confidence, the source,
and the so-what. Keep numbers dated (they age). Route the rest: doctrine/rules → the
charter; analysis outputs → `module-a/`; agency accountability → the challenge register;
skill-specific (voice, segments) → that skill's `references/`. In a live session you can
just tell `/growth-office` "add this to the growth knowledge" and it files + commits it.

**Entries stay brand/business-agnostic** — the general insight + external examples, never
our own current policies, config, thresholds, coupon/discount schemes, or point-in-time
metric values (those age and conflict with the live source of truth; they live in the
operational layer — the store, CLAUDE.md, initiatives, the scorecard — and are referenced,
not copied).

Confidence tags: **[confirmed]** (verified in data + agreed), **[measured]** (in data,
not yet agreed), **[estimate]** (platform-attributed or modeled), **[hypothesis]** (untested).

---

## Confirmed findings (as of 2026-07-22)

- **Product gross margin ~82-85%** of revenue [confirmed] — real per-SKU landed COGS
  (B2B break-even study, Lucas-confirmed product-cost-only). Source: `module-a/cost-basis.json`.
- **Contribution before media = 42% of total revenue** [confirmed] — structure: freight
  revenue +5%; costs COGS 22% + tax 12% + payment 3.95% + freight 17% + fulfillment 3%.
  **NOTE: freight + fulfillment UNDER REVISION (new fulfiller) — net line pending Lucas.**
- **Max CAC ~R$68/new order** to hold the 10% net floor [confirmed, pre-delivery-revision].
- **AOV ~R$209 blended / R$203 new** [measured, 30d, giveaway-excluded]. The travel-size
  giveaway ("pague só o frete") = ~16% of paid orders, near-all new; a tripwire cohort,
  excluded from baseline (payback is the 2nd purchase, measured separately).
- **First-order economics are NOT near breakeven** [confirmed] — kills the original H2
  fear. New-order gross contribution ~R$136-167 vs ~R$50 CAC. The real constraint is
  marginal CAC + fixed-cost absorption, not per-purchase profitability.
- **Repeat rate 15.8%** (84% one-and-done); **time-to-2nd median 63 days** [measured,
  13mo, all-channel]. → replenishment flow at day ~45-60 is the top zero-discount lever.
- **12-mo contribution LTV ~R$169; LTV:CAC 3.4 (paid) / 6.0 (blended)** [estimate].

## Meta (paid acquisition), 30d ending ~2026-07-20 [estimate — platform-attributed]

- Spend ~R$82k @ 4.46 ROAS, **down from 5.29 as spend ramped +38%** — real diminishing
  returns; steer by marginal, not blended.
- **96% of spend is prospecting** (cold). Paid CAC ~R$49 (Meta-attributed estimate, NOT
  yet measured — Module A v1 media layer will measure it).
- **Creative-testing tax:** ~30% of spend in below-breakeven Primer tests while proven
  7+ ROAS creatives (Validados, review) are starved. See challenge register F1/F2.

## Google Ads (paid), 30d ending ~2026-07-23 [measured — first live pull, v21 API]

- **H1 ANSWERED — Google is overwhelmingly a HARVESTER, not an acquirer.** [measured]
  R$32.6k spend / ~R$215k value (blended 6.6x ROAS), but the headline ROAS is manufactured:
  - `[SEARCH] MARCA` (branded) = **R$13.3k, 41% of spend, 10.1x ROAS** — pure brand harvesting.
  - `[PMAX] FUN VEND` = R$17.5k (54%), 3.9x — shopping + retargeting, mostly warm.
  - `[PMAX] PROMOCIONAL TOPO` = R$1.9k (6%), 7.4x.
  - Inside `search_term_view` (privacy-truncated, understates totals): non-branded = only
    **R$4.0k at 2.8x ROAS** — the sole clearly-incremental acquisition spend, ~12% of budget
    at a quarter of the headline efficiency.
  - **Caveats:** PMax won't split brand vs non-brand (R$19.4k opaque); term-split is
    directional, campaign table is solid. Tool: `module-a/google_ads_fetch.py --days 30`.
  - **Next test:** brand-search **holdout / geo-experiment** — pause `MARCA` in a matched
    region 2-3wk, measure sales that survive via organic. Branded-search incrementality is
    typically low; that R$13.3k/mo may be subsidizing near-free sales.

## Open hypotheses / questions

- **Marginal CAC / incrementality unproven** [hypothesis] — platform ROAS overstates true
  effect; run a Meta Conversion Lift before any big ramp.
- **PDP vs LP on COLD traffic** [hypothesis] — the agency's "PDP wins" read is confounded
  (warm-PDP vs cold-LP, co-resident ads). The real open question is LP vs PDP on cold
  prospecting, run as a clean single-variable A/B. See the WhatsApp/CheckCommerce thread.
- **Cohort LTV drift** [measured, needs isolation] — recent cohorts show lower early LTV,
  partly giveaway-cohort dilution; needs a giveaway-excluded cohort re-run to confirm.
- **Delivery economics** [in flux] — being rebuilt under a new fulfiller; gates all net-margin work.

## Best practices & playbooks (external — ideas to apply, NOT our measured data)

Digested from the `growth` email label via `/digest`. Source ref = the dedup key.

- **Acquisition Treadmill Ratio (ATR) = current-month new-customer revenue ÷ total revenue.**
  [best-practice · DTC Newsletter 2026-07-02] Above ~50% the base erodes as fast as you
  acquire (a treadmill, not a flywheel); healthy brands sit ~20% new / ~80% repeat+cohorts.
  **Action: compute a clean monthly ATR on the scorecard (treadmill if >50%); repeat is the floor.**
- **Promotions are a system, not a panic button — and most offer tools aren't discounts.**
  [best-practice · Nik Sharma 2026-02-22] 12-tool spectrum (GWP, bundles, free-ship
  thresholds, VIP/early access, subscribe&save all beat % off) + a promo calendar (4-6
  major moments/yr + monthly non-discount soft promos + quarterly loyalty), never reactive
  sales. Reinforces our value-add-over-discount guardrail. Method → `references/promotions-system.md`.
- **Creative velocity is the #1 paid-scaling constraint → crowdsource a UGC engine.**
  [best-practice · Northbeam UGC Flywheel Pt.1 2026-07-16] Top accounts ship ~90 creatives/
  cycle; the bottleneck is scalable UGC, not media ops. In-platform data mistracks ~50% and
  biases to last-click → needs view-through attribution. Matches our creative-fatigue read +
  Lucas's priority flag (2026-07-21). Method → `references/ugc-flywheel.md`. **Action: stand
  up a UGC pipeline feeding the agency (Module C).**
- **Pop-ups: ask a question before the email (Zeigarnik micro-commitment).**
  [best-practice · The Inbox Newsletter 2026-02-18] Quiz/question-first pop-ups beat "enter
  your email" — higher opt-in AND segmentation captured at entry for a tailored welcome
  flow. GE already runs an Octane quiz. **Action: apply to the on-site pop-up; wire the
  segmentation into the welcome flow.**

### In-flight experiments (surfaced via digest)
- **Cart-abandon: hide the discount, make them click to reveal** [The Inbox 2026-04-29] —
  GE is A/B testing this with the team (not a new idea; logged so it isn't re-digested).
