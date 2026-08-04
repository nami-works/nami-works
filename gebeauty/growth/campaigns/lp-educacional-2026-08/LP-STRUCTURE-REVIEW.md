# LP structure review, ahead of the Shopify port

Resolved: `gebeauty` · model `dtc-purchase` · gate = 10% net floor per purchase after media AND marginal CAC under R$68 (`as_of 2026-07`, source CGO-TEAM.md prose, re-derive via `module-a/kpi_sweep.py`) · BRL.

Run through `/growth-office` (intake, gates, decomposition) and the landing-page checklist from `marketing:draft-content`. Read against `growth/knowledge.md` so this builds on what is already known rather than relearning it.

---

## Part 1. Corrections to my earlier read

### 1a. `primeira-rotina-r95` was wrongly ranked

Lucas is right and my ACCOUNT-AUDIT.md table was wrong. The campaign carries roughly 60% off wired into the offer (R$95 against a R$259 routine list, so 63.3% off) and targets never-purchased customers only. Under the cohort-isolation rule in `brand-context.md` it must not appear in a table alongside full-price campaigns, and it must not be judged on first-order economics. Replacement read in `r95_cohort_isolation.py`:

| | at the R$95 sticker | at observed AOV R$125.85 |
|---|---|---|
| total revenue | 101.08 | 133.91 |
| contribution before media | **-0.32** | 24.80 |
| less CPA R$21.70 | -22.02 | **3.10** |
| vs the 10% floor | below by R$32.13 | below by R$10.29 |

Two things worth seeing here. At the bare R$95 sticker the order is **negative before a cent of media**, because the absolute costs (COGS R$46.25, freight R$20.43, fulfilment R$6.00, packaging R$5.00) do not shrink when you discount. The campaign only works because the basket rises to R$125.85. That is the offer doing its job, and it is fragile: anything that drags AOV back toward the sticker puts the order under water.

The payback test is the one that matters:

- per acquired customer we must recover **R$10.29** to reach the floor
- a full-price routine repurchase contributes **R$133.22** with no media attached
- so the required repeat rate is **7.7%**
- the brand baseline is 15.8% (`as_of 2026-07`) and routine-first repeat is 25.0% per the retention study

**The subsidy is comfortably affordable even if this cohort behaves like an average GE customer.** That is a much better verdict than my earlier ranking implied. It also makes the campaign a textbook instance of the First-Routine Bundle Offer the retention study was built to justify.

Requirement: tag these orders at creation, exclude them from blended Module A, and read the cohort on second-purchase rate and payback window. Never on first-order AOV or platform ROAS.

### 1b. I overstated the PDP-versus-LP conclusion

In the audit I wrote that the Primer Liso creative "is not the problem, the destination is." That was too strong, and `knowledge.md` already flags exactly this trap:

> **PDP vs LP on COLD traffic** [hypothesis] the agency's "PDP wins" read is confounded (warm-PDP vs cold-LP, co-resident ads). The real open question is LP vs PDP on cold prospecting, run as a clean single-variable A/B.

My comparison had the same defect in the opposite direction. Primer Liso versus `primeira-rotina-r95` differs on at least four variables at once: destination, offer (full price versus 63% off), audience (broad versus never-purchased), and creative (coiffeur influencer versus hook statics). A 20x to 50x gap in LPV-to-ATC across four variables tells you something is badly wrong in that funnel. It does not tell you the landing page is the fix.

What survives the correction: the Primer Liso funnel is genuinely broken (CPA R$95.80 against a max of R$87.29, 6.4% net, below the floor while active), and add-to-cart rates of 0.7% to 3.4% on traffic bought at R$0.36 to R$0.57 per landing-page view are not explainable by price alone. It is worth diagnosing, and the LP is a plausible lever.

What does not survive: any claim that these pages are proven to fix it. **The clean single-variable A/B in `knowledge.md` is still open, and this campaign is the chance to close it.** That is now the primary experimental value of the LP set, and it should be designed in rather than hoped for.

---

## Part 2. Intake on the r95 audience window

The request is to narrow r95 to people who have engaged with the brand for a while but have not converted. My recommendation, with the reasoning exposed so you can overrule the parts you disagree with.

### The governing principle

A 63%-off offer should only reach people who have **demonstrated they will not convert at full price**. Every impression served to someone still inside their natural consideration window is margin given away that you would have earned anyway. So the floor of the window matters far more than the ceiling, and the floor should sit past the point where organic full-price conversion becomes unlikely.

### Recommended spec (MEASURED 2026-07-31, supersedes the earlier 14-day placeholder)

The floor is no longer a guess. Measured from Klaviyo (`klaviyo_signup_to_first_order.py`): among genuine deliberators, **p50 = 14 days, p75 = 36, p90 = 58**, and cumulative conversion runs 34% by day 7, **51% by day 14**, 70% by day 30, **81.6% by day 45**, 91% by day 60. Marginal conversion never drops below 17% in any window from day 7 to day 60, so there is no natural cliff before ~45 days.

**A 14-day floor was wrong.** At day 14 half the pool still converts at full price unaided, so you would be paying 63% off for orders you already had.

| dimension | spec | why |
|---|---|---|
| engagement depth | **variant A: 2+ touchpoints** · **variant B: 3+ touchpoints** | see the gate below. Depth selects for interest; interest correlates with converting anyway |
| floor (oldest allowed first touch) | **first interaction 45+ days ago** | 81.6% of deliberators have already converted by day 45, vs 51% at day 14 |
| ceiling (most recent activity) | last interaction within **180 days** | still warm; 180 days is the hard cap on Meta website custom audiences |
| exclusions | all-time purchasers (customer list + pixel purchase events) | first-purchase-only offer; a repeat customer taking 63% off is pure margin loss |
| also exclude | anyone in an active full-price prospecting cell | otherwise you cannibalise full-price conversion and cannot read either test |

Engagement-based audiences (IG account, FB page, video viewers) allow up to 365 days, so widen the **ceiling** there if reach is short. Never lower the floor to buy reach: the floor is the part earning the margin.

### Volume gate — decide A vs B on audience size, not preference

Raising the floor to 45 days costs almost nothing in reach, because it delays eligibility rather than removing anyone, and the 180-day ceiling leaves runway. Raising depth from 2+ to 3+ is the change that can starve delivery, and r95 is already small (73 purchases in 30 days on R$1,584).

Depth also cuts against the logic: the time floor selects for *demonstrated failure to convert*, which is exactly who should get a discount, while depth selects for *high interest*, who are likeliest to convert at full price. The combination is still coherent (3+ touches and still nothing after 45 days describes a real blocker), but the burden is on volume.

**Gate:** check the Meta audience estimate for both variants before committing.
- If **B (3+ @ 45d)** has enough scale to deliver at the intended budget, run B.
- If it comes back thin, **keep 45 days and fall back to 2+**, never the reverse.

Not measurable from the data pulled here: touch-count distribution. Ads Manager's audience estimator answers it directly.

### Caveats on the measurement

It measures Klaviyo profile creation to first purchase, so it only sees people who joined the list before buying. That is the right population for this decision, since it is exactly who the engaged-non-converter audience is made of. Two contamination traps handled: 78.3% of "signups" are the checkout creating the profile (excluded as non-deliberators), and Shopify's own `daysToConversion` is right-censored at 30 days and unusable for this (details in `knowledge.md`).

### Two risks to weigh before committing

**Volume.** The campaign did 73 purchases in 30 days on R$1,584. Narrowing from broad prospecting to engaged non-converters will shrink the addressable pool substantially. If the resulting audience is small, Meta will struggle to deliver at meaningful budget and your read gets slow and noisy. Check the audience size in Ads Manager before committing, and be ready to widen the ceiling (engagement-based, 365 days) rather than lower the floor, because lowering the floor is what costs you margin.

**It changes what the campaign measures.** Today r95 is a broad-prospecting loss-leader. Narrowed to warm non-converters it becomes a conversion-rescue play on a warmer, cheaper-to-convert audience. Expect CPA to fall and expect that to be flattering rather than meaningful. The cohort's second-purchase rate remains the only verdict that counts, and the two versions of the campaign are not comparable to each other either. Isolate them as separate cohorts, not one continuing series.

---

## Part 3. LP structure review

### What holds up

The spine is sound and I would not restructure it. Specifically:

- **Message match is right.** Each h1 continues its ad's own words. All five h1s are 27 to 43 characters, so they hold two lines on mobile without truncation. Meta descriptions are all under 150 characters with no mid-word cuts.
- **The answer arrives before the ask.** Section 3 delivers what the ad promised as a numbered list, ahead of any selling. For educational creative that is the correct order, and it is what earns the scroll.
- **Ingredient-as-proof is applied correctly.** Actives are named only bound to a benefit (murumuru repõe a maciez, crambe reduz o frizz, H-Vit Plus controla a oleosidade), per `voice.register`.
- **The offer is the routine, not a SKU.** Validated: a single R$95 shampoo absorbs only R$18.21 of media before breaking the floor, against a R$68 ceiling. The routine absorbs R$105.66.
- **No discount anywhere,** so the brand gate holds. Value comes from the structure and from free shipping as policy.
- **The R$40-to-free-shipping progress bar** is a real AOV lever, and closing it with the booster moves the order to 27.7% net.
- **Voice gate is automated** and blocks em-dashes and invented-number patterns at build time.

Reinforcement from the knowledge base: ATR is roughly 0.78, which is treadmill territory, and returning revenue is only about 22%. Routine-first pages that push customers onto the 001/002/008 core are the right structural response to that, not a nice-to-have.

### Gaps, prioritized

**P0, blocks launch.**

1. **No payment, shipping or guarantee reassurance anywhere.** Grep across all five pages returns zero matches for parcelamento, sem juros, Pix, prazo de entrega, troca, devolução or garantia. For a R$259 first purchase from a brand the visitor met ninety seconds ago, in Brazil, this is the largest single omission in the set. Instalments in particular are a first-order conversion lever here, not a detail. **Question for you: does the store show parcelamento, and in how many instalments?** If it does, it belongs directly under the price, not in a footer.

2. **No secondary conversion path.** Every one of the five pages has exactly one outcome: buy the routine at R$259 today. Visitors who will not do that today leave having given you nothing, even though every ad caption already promises "cupom especial na primeira compra". The store also already runs an Octane quiz, and `knowledge.md` carries a digested finding that question-first pop-ups beat email-first by capturing segmentation at entry.

   This connects directly to Part 2. **The LPs are the natural factory for the engaged-non-converter pool that r95 later harvests.** Right now they leak that audience instead of building it. Adding a quiz or coupon-unlock as the secondary path turns a bounced visit into a segmented, retargetable, first-purchase-eligible contact. I would treat this as the highest-value structural addition in the whole review.

3. **No mid-funnel event instrumentation.** The office doctrine requires the test layer to be optimized to a mid-funnel event and ranked on leading indicators first (thumbstop, hold, CTR, CPC, cost per ATC) because those need low volume to read. The pages forward `utm_*` and `nemu_*` correctly, but they fire nothing of their own. Without offer-block-viewed, CTA-clicked and scroll-depth events there is no mid-funnel signal to optimize toward and no per-hook read beyond the click. `integrations-engineer` owns the wiring; it needs specifying before launch, not after.

**P1, fix during the port.**

4. **Proof sits too low and is unapproved.** Social proof appears only after the offer block. Standard practice puts at least one proof element adjacent to the primary CTA above the fold. Separately, the real Instagram handles are still an open approval item; if using them publicly is not cleared, switch to first names.

5. **No explicit value proposition for the routine over its parts.** The offer block explains what each step does, which is mechanism. It never states plainly why the bundle beats buying one item, which is the actual purchase decision. Given the economics this is also the most honest thing on the page: the routine is what makes the customer stay.

6. **The secondary hero CTA is a scroll anchor, not a choice.** "entender primeiro" moves people down the page. Once a capture path exists (gap 2), that slot should offer it.

**P2, worth doing.**

7. **SEO posture is undecided.** Pages currently carry `noindex,nofollow`, which is right for pure paid LPs and wrong if they become indexable Shopify pages, where they could compete with collections and PDPs. Route meta titles, descriptions and canonicals to `content-director`, whose `native_delegates` include `marketing:seo-audit`.

8. **Accessibility pass not run.** Delegate to `design-engineer` via `design:accessibility-review`.

### What the experiment should now be designed to prove

Given 1b, the LP set should be built to close the open PDP-versus-LP question rather than assume it. Cleanest available design: hold creative, offer, audience and budget constant, vary only the destination, on cold prospecting. One creative, one offer, two destinations. Everything else that differs makes the result unreadable, which is precisely how the agency's earlier read went wrong.

That is a smaller, more boring test than five simultaneous pages, and it is the only version that produces a durable finding. The five pages can then roll out on the answer.

---

## Part 4. What the port needs from the template

For your theme guidelines, these are the structural capabilities the pages rely on. If the existing campaign LP template lacks any of them, tell me which and I will restructure around it rather than asking you to extend the theme.

| capability | used for | fallback if absent |
|---|---|---|
| sticky mobile buy bar | primary CTA persistence on mobile | inline repeated CTAs every two sections |
| free-shipping progress indicator | the R$40 AOV lever | static line of copy stating the gap |
| FAQ accordion | real audience objections | plain headed paragraphs |
| anchor navigation | hero CTA jumps to the offer block | full-page scroll only |
| filter or toggle interaction | the finalizador chooser on page 5 | static four-card comparison grid |
| repeatable rich section with image plus text list | the ritual steps with actives | plain list |
| embeddable quiz or capture block | the secondary path in gap 2 | link out to the existing quiz |

## Part 5. Open intake questions

Per the intake doctrine, settling these now rather than mid-project:

1. **Is creative and asset production in scope?** The pages currently use live Shopify product images only. No lifestyle photography, no video, no custom illustration. If the campaign needs those, that is `creative-producer` and `video-director` work and it should be scoped now, not descoped later the way the Santal Skin creative was.
2. **Parcelamento:** does the store offer it, in how many instalments, and interest-free to what limit?
3. **Real Instagram handles as public proof:** approved, or switch to first names?
4. **Indexable or noindex** once these are Shopify pages?
5. **Do you want the time-to-first-purchase distribution pulled** so the r95 floor is a measured number rather than my 14-day placeholder?

## Gap list, manifest nulls hit on this run

- `visual.tokens` and `visual.guide` are `null`. I read design tokens out of `design-system/foundations.html` instead (GE red #DF3630, sands, sage, Italian Plate No1). Substitute used; a centralized token source would close it.
- `workspace.org_charter` is not declared, so `roster` served as the org chart, as the schema intends.
- `economics.cac_ceiling` and `repeat_baseline` are prose snapshots, not engine output. Both are load-bearing in Part 1 and Part 2 and should be re-derived via `module-a/kpi_sweep.py` before any spend decision rests on them.
