# GE Beauty CGO — Knowledge Base

The growth office's memory: confirmed findings, insights, and open hypotheses. Append
here over time. `/growth-office` and `/growth-analyst` read this at setup so the office
accumulates knowledge instead of relearning it each session.

**How to add an entry:** one insight per line — the claim, its confidence, the source,
and the so-what. Keep numbers dated (they age). Route the rest: doctrine/rules → the
charter; analysis outputs → `module-a/`; agency accountability → the challenge register;
skill-specific (voice, segments) → that skill's `references/`. In a live session you can
just tell `/growth-office` "add this to the growth knowledge" and it files + commits it.

Confidence tags: **[confirmed]** (verified in data + agreed), **[measured]** (in data,
not yet agreed), **[estimate]** (platform-attributed or modeled), **[hypothesis]** (untested).

---

## Cost-model rebuild (2026-07-22) — supersedes the old %-of-revenue structure

The unit-economics model was rebuilt to be discount/GWP-correct. **Costs now split into two buckets** (`params.json`):
- **Absolute R$/order** (fixed under discount/GWP): COGS (per-SKU landed, `cost-basis.json`), freight, fulfillment, packaging.
- **Ad-valorem %** (scale with price): tax 12%, payment 3.95%, **Boniteca** (tier % on *qualifying* cosmetic revenue).

Key changes: (1) **COGS is bottom-up ~14.9%** (Raphael landed cost, study−R$2 handling; the 1.48× plug is retired — it double-counted Boniteca, which was inside the old top-down 22%). (2) **Boniteca is its own line** — monthly flat-cliff fee (10% tier at <R$500k/mo), ad-valorem on qualifying revenue; **auto-tier projector BUILT** (`module-a/boniteca_projector.py`, current-month **in-month velocity** [projected full = this-MTD(day D) ÷ avg over CLEAN reference months of (MTD-at-D ÷ full); ref = Apr+May 2026 — **June excluded, end-June mist launch back-loaded it**] + future seasonal-YoY modes, writes `resolved_pct` to params) — data-gated on `--build-history` (Omie+POS qualifying-revenue series). (3) **Freight + fulfillment + packaging are ABSOLUTE R$/order**, not %-of-rev (a discount can't silently shrink a fixed cost). Freight = Sélia R$20.43/order today (Unilog R$27.19 at cutover; ~R$250k/yr pricier — flag). Fulfillment R$6.00 (picking R$3.90 + ~R$2.10 rough storage). Packaging tiered R$3/5/6.50 by units (placeholder). **Placeholders to firm up:** fulfillment storage (Sélia Logística invoice), packaging BOM, Boniteca history backfill.

- **CGO GATE — `module-a/offer_breakeven.py`** [tool]: every campaign/offer runs through it before launch. Input `{lines (sku/qty/price or discount_pct/gift), shipping (free|passthrough|flat), freight (avg|exact cep)}` → contribution, breakeven price floor, **CAC ceilings** (breakeven + at 10% floor), floor pass/fail. Absolute+ad-valorem model, exact weight×zone freight. `python offer_breakeven.py --example`. Importable: `from offer_breakeven import evaluate_offer`.
- **Worked example** [measured 2026-07-22]: new-customer *shampoo R$95 + free full máscara + free travel leave-in, free ship* → contribution **−R$4.74 to SP** on the full model (COGS 41.25 + freight 22.84 + fulfil 6.00 + box 5.00 + tax 11.40 + pay 3.75 + Boniteca 9.50). **Underwater, zero CAC room** — breakeven needs shampoo ≈R$101 or (better) charge shipping / downgrade the máscara gift to travel size. Free shipping + a full-size gift + 10% Boniteca is what sinks it.

## Confirmed findings (as of 2026-07-22)

- **Product gross margin ~82-85%** of revenue [confirmed] — real per-SKU landed COGS
  (B2B break-even study, Lucas-confirmed product-cost-only). Source: `module-a/cost-basis.json`.
- ~~**Contribution before media = 42% of total revenue** — COGS 22% + tax 12% + payment 3.95% + freight 17% + fulfillment 3%.~~ **[SUPERSEDED 2026-07-22 — see "Cost-model rebuild" below. Now ~51% blended; the old 22% COGS double-counted Boniteca and freight was a flawed %-of-rev.]**
- ~~**Max CAC ~R$68/new order** to hold the 10% net floor.~~ **[SUPERSEDED 2026-07-22 — recompute via `module-a/kpi_sweep.py` on the rebuilt model.]**
- **AOV ~R$209 blended / R$203 new** [measured, 30d, giveaway-excluded]. The travel-size
  giveaway ("pague só o frete") = ~16% of paid orders, near-all new; a tripwire cohort,
  excluded from baseline (payback is the 2nd purchase, measured separately).
- **First-order economics are NOT near breakeven** [confirmed] — kills the original H2
  fear. New-order gross contribution ~R$136-167 vs ~R$50 CAC. The real constraint is
  marginal CAC + fixed-cost absorption, not per-purchase profitability.
- **Repeat rate 15.8%** (84% one-and-done); **time-to-2nd median 63 days** [measured,
  13mo, all-channel]. → replenishment flow at day ~45-60 is the top zero-discount lever.
- **12-mo contribution LTV ~R$169; LTV:CAC 3.4 (paid) / 6.0 (blended)** [estimate].

## Time-to-first-purchase — the deliberation window [measured 2026-07-31]

Measured to set the audience floor on the `primeira-rotina-r95` 63%-off offer (a discount
should only reach people who have demonstrated they will NOT convert at full price).

- **Deliberator p75 = 36 days; p50 = 14; p90 = 58** [measured, Klaviyo]. Cohort = profiles
  created Feb 2026, observed 61-89 days, n=2,406 purchasers of which **523 deliberators**.
  Script: `campaigns/lp-educacional-2026-08/klaviyo_signup_to_first_order.py`.
- **Two populations hide in the naive number.** 78.3% of "signups" are the checkout itself
  creating the Klaviyo profile, so they never deliberated and sit at 0 days. Only the 21.7%
  whose profile predates their first order are a real consideration window. Always split.
- **Conversion grinds, it does not cliff.** Cumulative share of deliberators converted:
  34% by day 7, **51% by day 14**, 70% by day 30, 91% by day 60. Marginal conversion stays
  17-21% in every window from day 7 to day 60. There is no natural cutoff before ~45 days.
- **Consequence:** a 14-day floor is too early — half the pool still converts at full price
  unaided. Floor set to **45 days** (81.6% converted by then), see the r95 audience spec.

### ⚠️ Shopify `daysToConversion` is right-censored — do NOT quote its p75
`Order.customerJourneySummary.daysToConversion` caps its lookback at **30 days**, and values
under a day collapse to 1.0. A naive read gives **p75 = 1.0 day**, which is a measurement
artifact, not behaviour. It hides **30% of deliberator first purchases** (those at 30+ days,
including 9% landing between days 60 and 89). Shopify is fine for "did they convert fast";
it cannot measure a deliberation window. Script + censoring test:
`campaigns/lp-educacional-2026-08/time_to_first_purchase.py`.

Also note: a naive percentile over a recent window is **right-truncated** (a profile created
3 days before the window ends cannot show a 90-day delay). Use a fixed signup cohort with a
uniform observation horizon, as the Klaviyo script does.

### Nemu cannot answer this (checked 2026-07-31)
Nemu has the right primitives (`first`-click model, `Infinite` attribution window, dashboard
4967 defaults to `eventClick: first`) but its API surface exposes **value and count metrics
only, no timing field**. `customers-get-insights.average_purchase_retrieval` (7.86 days) is
repeat cadence, time BETWEEN purchases, not time TO first purchase. Timing would need the
Nemu UI or a CSV export. Nemu is also click-based, so it still cannot see an ad impression
that was never clicked; true impression-to-purchase belongs to the (still unproven) Meta
incrementality work.

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
    at ¼ the headline efficiency.
  - **Caveats:** PMax won't split brand vs non-brand (R$19.4k opaque); term-split is
    directional, campaign table is solid. Tool: `module-a/google_ads_fetch.py --days 30`.
  - **Next test:** brand-search **holdout / geo-experiment** — pause `MARCA` in a matched
    region 2-3wk, measure sales that survive via organic. Branded-search incrementality is
    typically low; that R$13.3k/mo may be subsidizing near-free sales.

## Measurement stack — the office's instrumentation (2026-07-27)

Doctrine: **no single tool is truth — triangulate.** Three layers, each with a home:

- **Cockpit + Brazil/PIX signal + MTA → Nemu** (`claude.ai Nemu` MCP, dashboard "Atribuição geral",
  id 4967, ~12mo history). Brazil-native attribution (Tray/Nuvemshop/Yampi + PIX/boleto aware),
  9 attribution models (first/last/assisted/markov/linear/u-shaped/…), **reconciles ad-platform
  claims to actual store revenue** (docs flag platform revenue "~20% high"). 30d read cross-validated
  our own pulls exactly (spend R$115.9k = Meta R$82.9k + Google R$33.0k; blended ROAS 4.14 net —
  *below* the platforms' self-reported blend = de-dup working). **This replaces the need to buy
  Triple Whale** (US tools are PIX-blind). Default model on the dashboard = first-click.
- **PIX FACT [measured, 30d, 2026-07-27]:** PIX = **31.6% of revenue / 36.8% of orders** (R$151.7k,
  1,309 orders); credit card only 58.7% rev / 42.6% orders; "other" 9.7%/20.6% (low ticket); boleto 0.
  → ~37% of orders are async-payment (PIX) that ad pixels structurally under-see in-session. This is
  the signal gap Nemu closes, and the *opposite* error to the Google harvester (deflation vs inflation).
- **Margin-true profit + the 10% net floor → Module A, NOT Nemu.** Nemu's "profit R$306k / 63.8% margin"
  = revenue − ad spend − tax only; it EXCLUDES COGS/freight/fulfillment/Boniteca. Module A's rigorous
  ~42-51% contribution is the real number. Never judge the 10% floor by Nemu's rosy margin.
- **Causal calibration → still to build.** Nemu is NOT causal: `experiments-list` empty, feature is
  A/B-shaped not geo-lift, default first-click would still crown branded Google. The harvester +
  marginal-CAC questions still need **geo holdout (GeoLift by Recast ~$100/mo, 6mo free) + self-hosted
  Google Meridian (free, geo-hierarchical Bayesian, ~build-toward with our data depth) + Meta Conversion
  Lift**. Enterprise MMM/attribution SaaS (Northbeam $1.5k/mo, Recast-full $50k+/yr, Haus, Measured) =
  overkill at ~R$115k/mo spend.
- **OPEN Q for Nemu team:** does it forward recovered PIX conversions back to Meta/Google server-side
  (CAPI) to fix delivery, or only report? If report-only, an Elevar-style CAPI layer still adds value.
- **UTM / link-tagging convention → `references/utm-conventions.md`** [confirmed 2026-07-27]. The
  Nemu-aligned playbook for building every tracked link (paid/organic/influencer/affiliate). Nemu reads
  `nemu_*` params first, falls back to `utm_*`. **`utm_medium` is the paid(`cpc`)/organic(`organic`)
  switch** and the #1 misattribution lever. Nemu's paid Meta template *deliberately* encodes
  `{{name}}|{{id}}` (the `|` is its name↔id separator) — so paid Meta orders legitimately carry
  `utm_term=<adset>|<adset_id>` + a campaign id; that signature is correct **only on a paid click**.
- **UTM "contamination" [FALSE POSITIVE — resolved 2026-07-27]:** the growth_watchdog finding that the
  `linklist_26092025` bio-link leaked paid Meta markers **did not hold up**. A full 12-mo per-visit scan
  (`scratchpad/utm_scan.py`, 46,915 orders / 19,888 with journeys) found **0 orders** where an organic
  bio-link visit carried a paid `utm_term`/ad-id/campaign-id — before OR after Lucas's fix. Order #89360
  is a normal **multi-touch** journey (3 clean paid Meta visits + 1 clean organic bio visit; markers on
  different visits, not one URL). The watchdog counted the **1,349 multi-touch orders** (bio touch + paid
  touch, R$289k) as contamination — they're just multi-touch. **Lesson:** never read order-level UTM
  co-occurrence as a single leaked URL; check per visit (Shopify `customerJourneySummary`). The old
  68/1,183/3,544/4,795 figures were inflated OR'd counts — discard.
- **REAL finding from that scan → Instagram `utm_medium` sprawl [open hygiene debt, 2026-07-27]:**
  Instagram-source visits use a chaotic mix of mediums — influencer names as mediums (`Beta W`,
  `Myra Ruiz`, `fiorella mattheis`…), inconsistent casing (`STORIES`/`reels`/`reels-de-teste`), and
  paid-ish labels (`paid`,`paid_social`,`cco`,`geb`) alongside the dominant clean `link-na-bio` (6,237).
  This is the actual thing muddying organic/influencer/paid attribution in Nemu. Fix = enforce the
  per-channel templates at the link-builder source. Full write-up in `references/utm-conventions.md`.

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
  Our returning-rev share ~22% implies ATR ≈ 0.78 — treadmill territory. **Action: compute
  a clean monthly ATR on the scorecard; repeat is the floor.**
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

- **A landing page now serves two readers: the customer and the agent layer.**
  [best-practice · Limited Supply / Nik Sharma, transcript 2026-07-31] Discovery is moving into
  LLM shopping agents (in-chat checkout, merchant partnerships, catalog ads arriving in LLMs), so
  a page must convert a human AND expose clear product truth to a machine: details, comparisons,
  use cases, reviews, explicit claims. The instruction is to put MORE explicit information on the
  page than felt necessary before, not less. **Action: on any indexable LP treat machine
  extractability as a first-class goal, not a byproduct of SEO.**
- **Ad-angle-to-page matching is becoming table stakes; the cost barrier is gone.**
  [best-practice · Limited Supply / Nik Sharma, transcript 2026-07-31] Pattern: angle → a page
  carrying that angle's proof, offer, objection handling and relevant bundle → checkout.
  Historically blocked by dev-ticket cost, now routine. **The named pitfall matters more than the
  tactic: when a matched page underperforms, the fault is usually the core angle or messaging, not
  the page. Action: treat a page as a test of its ANGLE, and kill the angle rather than iterating
  the page indefinitely.**
- **Build pages by objection, not only by product or by pain.**
  [best-practice · Limited Supply / Nik Sharma, transcript 2026-07-31] A distinct taxonomy: one
  page per objection rather than per SKU. The enumerated set: is it worth the price · will it work
  for me · is this actually different · can I trust the claims · how fast will I see results · is
  it easy to use · what if I don't like it. **Action: the objection axis is ADDITIVE to a pain
  axis over the same catalogue; objection pages tend to serve mid-funnel and retargeting rather
  than cold prospecting.**
- **Brand constraints are the precondition for one-shot page generation, not a polish step.**
  [best-practice · Limited Supply / Nik Sharma, transcript 2026-07-31] Without a design system and
  brand book in context, generation reliably produces generic headlines, manufactured urgency,
  non-specific reviews and no hierarchy: plausible-looking and off-brand. The target is "one-shot"
  (one prompt to final page), reachable only once the agent knows voice, allowed AND disallowed
  claims, and page conventions. **Action: over-specify the brand layer, especially what may not be
  said; make an automated brand/voice gate part of the build step, not the review step.**
- **Aggregated customer language is the highest-leverage input to page copy.**
  [best-practice · Limited Supply / Nik Sharma, transcript 2026-07-31] Wire every channel where
  customers use their own words into one context, so copy is grounded in real phrasing and in what
  already performs on-site, instead of invented framing. **Action: build the corpus once and let it
  feed briefs, angles and page copy. Method → `references/customer-language-corpus.md`.**

### In-flight experiments (surfaced via digest)
- **Cart-abandon: hide the discount, make them click to reveal** [The Inbox 2026-04-29] —
  GE is A/B testing this with the team (not a new idea; logged so it isn't re-digested).

## Office doctrine — campaigns are hook-validation engines (2026-07-24, Lucas)

Standing principle for ALL growth-office paid campaigns, not one campaign. A multi-hook campaign's
primary job is to **validate which hooks win and feed those angles into new content** (video, UGC),
not only to sell in-flight. "Put every boat on the water, see which catches the most tailwind, then
build more boats shaped like the winner."

- **Test → scale architecture, split by FUNCTION not by product.** (a) *Test layer* — ABO (not
  CBO, which starves laggards), hooks on even-ish budget, optimized to a mid-funnel event, ranked
  on **leading indicators first** (thumbstop / hold / CTR / CPC / cost-per-ATC — low volume needed),
  shortlist validated on purchase CPA/ROAS. (b) *Scale layer* — CBO + ROAS floor for the winners.
  This does NOT contradict the anti-fragmentation rule (that's about not splitting delivery by
  product/scent into self-competing campaigns; a test-vs-scale functional split is standard and fine).
- **Per-hook measurement in our own data** (`utm_content` per hook → Module A), not just Meta's
  black box (view-through caveat).
- **Promote/kill rule** past a per-hook read threshold; **wave-size** the test to the budget (can't
  validate dozens of hooks at once — leading indicators make wide waves affordable); log drops.
- **Winner → new content flywheel:** validated hooks brief /video-director + UGC. This operationalizes
  the "creative velocity = #1 scaling constraint → UGC flywheel" finding above as the campaign OUTPUT.
- Consequence: a consolidated "let the algorithm pick the winner" build is INSUFFICIENT on its own —
  it optimizes for immediate conversion and yields a black-box winner you can't reproduce. Always
  pair it with a fair-exposure test layer + per-hook read.

## Intake doctrine — ask if asset creation is in scope (2026-07-24, Lucas)

At campaign intake the office must **proactively ask whether creative/asset production is part of the
job**, rather than assuming assets exist or that we build them. Scope the deliverable explicitly:
"are assets provided, or is producing them part of this?" Precedent: the mist launch — Santal Skin
creative was descoped mid-project once it was clear assets weren't coming, which should have been
settled at intake. Add to the /growth-office intake loop (frame step).
