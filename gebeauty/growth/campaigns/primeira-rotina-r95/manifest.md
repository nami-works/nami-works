# Meta Campaign Manifest — "primeira rotina" R$95 acquisition offer

**Author:** /growth-hacker (CGO) · **Date:** 2026-07-25 · **Status:** UPLOAD-READY PLAN — NOT LAUNCHED.
No spend, no writes. Loads into Meta Ads Manager on Lucas's explicit "go."

**Ad account:** GE_Beauty `606199920079315` (BRL).
**Doctrine:** CGO "campaigns are hook-validation engines" (knowledge.md 2026-07-24) — test layer
(ABO, fair hook exposure, mid-funnel event, ranked on LEADING indicators) → scale layer (CBO, winners
only). This is a **negative first-order-payback LTV bet by design** (offer contribution ~ −R$4.74/order
to SP on the full model, knowledge.md 2026-07-22), so **first-order ROAS is the WRONG test signal** and
is explicitly excluded from the promote/kill logic. Scale is gated on leading indicators + the analyst's
cohort-payback read (Module A, running in parallel — see §8).

---

## 0. The offer (stated honestly in every ad)

Leve o **shampoo sem sulfato** (001, full) + a **máscara condicionadora** (002, full) e escolha o
**terceiro item de presente**: **leave-in com proteção térmica travel** (011, vale R$47) **ou**
**shampoo a seco** full (008, vale R$69). **Os três por R$95, com frete grátis.** Oferta de
**aquisição de novo cliente** (tripwire isolado, cohort guardrail 6).

- Riscado ("de") = **R$190** (a dupla full-size), NOT the 3-item sum — anchors value, avoids fire-sale read.
- Copy rule: no "% off / desconto / liquidação / última chance." Lead with *montar a rotina* + *o presente*.
- LP (cold-traffic destination, live/unlisted): **https://www.gebeauty.com.br/pages/lp-n4ga7384b3y3**
- **Price is code-activated:** coupon `PRIMEIRA-ROTINA_DO7HTHDO5C` (DiscountCodeApp, ACTIVE, once-per-customer, combines with shipping) — baked into every ad's destination via the apply-via-URL pattern (§6).

---

## 1. Structure overview

Two campaigns. The TEST validates hooks cheaply; the SCALE consolidates only the promoted winners.

```
CAMPAIGN 1 — TEST  [ABO · optimize ADD_TO_CART · rank on leading indicators]
  Objective: Sales (OUTCOME_SALES), ad-set budgets (ABO — NOT CBO; CBO starves laggards)
  Group A (HOOK TEST — audience held constant, 1 variable = hook):
    10 ad sets, 1 hook each, equal daily budget, audience = Advantage+ (broad)
    → the ranked hook read
  Group B (AUDIENCE PROBE — hook held constant, 1 variable = audience):
    2 ad sets, control hook = rotina (canonical), interest set 1 / interest set 2
    → clean audience read, does not confound the hook test
  Each ad = ONE ad carrying all 4 ratios via placement asset customization (§3)

CAMPAIGN 2 — SCALE  [CBO · optimize PURCHASE · winners only]  ⟵ DO NOT BUILD until §7 gate clears
  Objective: Sales (OUTCOME_SALES), campaign budget (CBO)
  1–2 broad ad sets, ads = promoted winning hooks only
  Gated on: leading-indicator thresholds (§7) AND analyst cohort-payback read (§8)
```

**Why 10 ad sets, not 10 ads in one ad set:** fair exposure. Inside one ad set (or under CBO) Meta
concentrates delivery on an early front-runner and starves the rest — you get a black-box winner you
can't reproduce. One hook per ad set at equal budget forces even exposure, which is the whole point of
a hook-validation wave (doctrine: "ABO, hooks on even-ish budget").

**Why audience is held constant in Group A:** creative test before audience test — hold audience, vary
creative, or you learn nothing about either. Group B isolates audience separately with a control hook.

### 1a. Hook isolation — how the structure yields BOTH reads (growth convention)

The wave is built so that each hook is a controlled experiment on one axis, then the winners are
re-tested on a second axis. Two distinct reads come out:

**(a) Clean hook-QUALITY ranking (from the TEST layer).** In Group A the *only* variable that differs
across the 10 ad sets is the hook — same audience (Advantage+ broad), same equal daily budget
(R$30/ad set), same 4-ratio creative frame, same placements, same optimization event (ATC), same LP.
So any spread in **link CTR / CPC / cost-per-ATC** is attributable to the hook, not to delivery,
audience, or budget skew. ABO (not CBO) is what makes this true: CBO would reallocate budget to an
early front-runner and destroy the equal-exposure baseline, leaving you unable to separate "better
hook" from "hook the algorithm happened to feed." Result = a defensible rank order of the 10 hooks on
leading indicators. Group B does NOT enter this ranking (different audiences) — it answers "which cold
audience," read separately with the control hook held constant.

**(b) SCALABILITY read on the winners (from the promote→CBO path).** A hook winning a thin, equal-budget
test does not prove it holds as spend rises — cheap ATCs at R$30/day can decay when the audience is
pushed. So promoted hooks graduate into the SCALE campaign (CBO, §7), where the question flips to:
does the hook **hold its leading indicators AND its cohort economics as budget scales**? Watch
CTR/CPC/cost-per-ATC (and now purchase CPA) at 3-5x the test's daily spend, plus CPM inflation and
frequency as the audience saturates. A hook that keeps its efficiency while spend climbs is scalable;
one whose cost-per-ATC balloons or CTR collapses under budget is a good *hook* but not a *scale* hook —
it gets fed back to the content flywheel rather than scaled. The ABO test ranks hook quality; the CBO
graduation tests whether quality survives scale.

---

## 2. The 10 hooks (on-image hero → ad copy)

Only the on-image hero headline changes per creative; plate/mechanic/logo/frete-grátis badge are
identical across all 40 (MANIFEST QA 40/40 PASS). `utm_content` = the hook slug (1:1 with the ad).

| # | Hook slug | On-image hero (verbatim) | Angle |
|---|---|---|---|
| 1 | `rotina` | seu primeiro ritual / por apenas R$95 | canonical — start the routine |
| 2 | `presente` | comece seu novo / ritual com presentes | gift-led |
| 3 | `loyalty` | sua nova rotina / começa aqui | belonging / "starts here" |
| 4 | `ritual-menos100` | seu primeiro ritual / por menos de R$100 | price-frame (sub-R$100) |
| 5 | `completo-menos100` | seu ritual completo / por menos de R$100 | completeness + sub-R$100 |
| 6 | `experiencia-menos100` | sua primeira experiência / por menos de R$100 | trial + sub-R$100 |
| 7 | `capilar-menos100` | sua rotina capilar completa / por menos de R$100 | full-hair-routine + sub-R$100 |
| 8 | `completo-95` | seu ritual completo / por apenas R$95 | completeness + R$95 |
| 9 | `experiencia-95` | sua primeira experiência / por apenas R$95 | trial + R$95 |
| 10 | `capilar-95` | sua rotina capilar completa / por apenas R$95 | full-hair-routine + R$95 |

---

## 3. Placements per ratio (honors the placement-cropping rule)

**Build each ad as ONE ad with placement asset customization** (`asset_feed_spec` + `asset_customization_rules`):
one image pinned per placement group so no single ratio auto-crops across all placements
(memory `feedback_meta_placement_ratio_cropping`). This keeps the wave at 10 ads (fair, cheap) instead
of 40, while every placement serves its native ratio.

| Ratio | File | Pinned placements |
|---|---|---|
| 9:16 (1080×1920) | `9x16_<slug>.png` | IG Stories · FB Stories · IG Reels · FB Reels |
| 4:5 (1080×1350) | `4x5_<slug>.png` | FB Feed · IG Feed · IG Explore Home · FB Video Feeds |
| 1:1 (1080×1080) | `1x1_<slug>.png` | IG Explore grid · FB Marketplace · Search results |
| 1.91:1 (1200×628) | `1x91_<slug>.png` | FB Right Column · Audience Network · FB In-stream · Messenger inbox · Marketplace desktop |

**QA gate before publish (every ad, every placement):** open Ad Preview per placement, confirm the
pinned ratio renders (no crop of headline/products/logo), confirm the CTA button and offer are legible.
Never publish a placement that auto-cropped. Assets dir: `gebeauty/imagery/primeira-rotina/creatives/meta/`.

---

## 4. Audiences (all cold prospecting)

| Ad set group | Audience | Config | Notes |
|---|---|---|---|
| Group A (×10) | **Advantage+ Audience (broad)** | age 18-45, F, BR (or GE's standing geo), no interest narrowing; Advantage+ placements | Held CONSTANT across all 10 hook ad sets — the hook is the only variable |
| Group B ad set 1 | **Interest set — cabelo/cachos** | detailed targeting: haircare, cachos/curly hair, hair treatment, shampoo; F 18-45 BR | Control hook = `rotina`. Audience read only |
| Group B ad set 2 | **Interest set — beleza/premium** | detailed targeting: beauty & cosmetics, premium/clean beauty buyers; F 18-45 BR | Control hook = `rotina`. Audience read only |

**Exclusions (all ad sets):** exclude existing customers / recent purchasers (customer-list custom
audience) and the wash-rotina cohort segment — this is a NEW-customer offer; do not pay to reacquire.
**This offer's own hooks** state the real R$95 ritual offer — it is NOT the travel-size "pague só o
frete" free-mini campaign; keep the two separate in the account so reads don't cross-contaminate.

---

## 5. Ad-set / ad build table (TEST campaign)

Campaign name: `primeira-rotina-r95 | TESTE | ABO`
Objective: Sales · Optimization event: **Add to Cart** (cheap mid-funnel; more volume than IC for a
readable cost-per-ATC at this budget — switch to Initiate Checkout only if ATC proves too noisy).
Attribution: 7-day click / 1-day view (record only; not used for the promote/kill call).

Ad name convention: `pr95_<group>_<slug>`. Destination URL + UTMs in §6. All 4 asset files per ad per §3.

| Ad set name | Hook slug | Audience | Daily budget | Ad (asset basenames) |
|---|---|---|---|---|
| `as_A_rotina` | rotina | Advantage+ broad | R$30 | `{4x5,1x91,1x1,9x16}_rotina.png` |
| `as_A_presente` | presente | Advantage+ broad | R$30 | `{4x5,1x91,1x1,9x16}_presente.png` |
| `as_A_loyalty` | loyalty | Advantage+ broad | R$30 | `{4x5,1x91,1x1,9x16}_loyalty.png` |
| `as_A_ritual-menos100` | ritual-menos100 | Advantage+ broad | R$30 | `{4x5,1x91,1x1,9x16}_ritual-menos100.png` |
| `as_A_completo-menos100` | completo-menos100 | Advantage+ broad | R$30 | `{4x5,1x91,1x1,9x16}_completo-menos100.png` |
| `as_A_experiencia-menos100` | experiencia-menos100 | Advantage+ broad | R$30 | `{4x5,1x91,1x1,9x16}_experiencia-menos100.png` |
| `as_A_capilar-menos100` | capilar-menos100 | Advantage+ broad | R$30 | `{4x5,1x91,1x1,9x16}_capilar-menos100.png` |
| `as_A_completo-95` | completo-95 | Advantage+ broad | R$30 | `{4x5,1x91,1x1,9x16}_completo-95.png` |
| `as_A_experiencia-95` | experiencia-95 | Advantage+ broad | R$30 | `{4x5,1x91,1x1,9x16}_experiencia-95.png` |
| `as_A_capilar-95` | capilar-95 | Advantage+ broad | R$30 | `{4x5,1x91,1x1,9x16}_capilar-95.png` |
| `as_B_int-cabelo` | rotina (control) | Interest: cabelo/cachos | R$20 | `{4x5,1x91,1x1,9x16}_rotina.png` |
| `as_B_int-beleza` | rotina (control) | Interest: beleza/premium | R$20 | `{4x5,1x91,1x1,9x16}_rotina.png` |

**Daily total:** R$300 (Group A) + R$40 (Group B) = **R$340/day**. See §6 budget for wave sizing.

---

## 6. UTMs + budget + cohort

### Destination URL — coupon baked in + UTMs carried through (VERIFIED)

The R$95 mechanic is **code-activated**: `PRIMEIRA-ROTINA_DO7HTHDO5C` (DiscountCodeApp, ACTIVE,
once-per-customer, combines with shipping). Every ad uses the Shopify **apply-via-URL** pattern
(same as the travel-size `MINI-GRATIS_2PDR1FZ` destination): the link hits `/discount/<CODE>?redirect=…`,
Shopify applies the code to the session, then 302s to the LP. The UTMs must ride **inside** the redirect
target, so the redirect value is **percent-encoded** (its `?` → `%3F`, `&` → `%26`, `/` → `%2F`) —
otherwise Shopify parses the UTMs as params of `/discount` and drops them at the redirect.

**Destination template (per ad):**
```
https://www.gebeauty.com.br/discount/PRIMEIRA-ROTINA_DO7HTHDO5C?redirect=%2Fpages%2Flp-n4ga7384b3y3%3Futm_source%3Dmeta%26utm_medium%3Dpaid%26utm_campaign%3Dprimeira-rotina-r95%26utm_content%3D<HOOK-SLUG>%26utm_term%3D<AUDIENCE>
```

**Worked example — hook `rotina`, Group A (`advantage-broad`):**
```
https://www.gebeauty.com.br/discount/PRIMEIRA-ROTINA_DO7HTHDO5C?redirect=%2Fpages%2Flp-n4ga7384b3y3%3Futm_source%3Dmeta%26utm_medium%3Dpaid%26utm_campaign%3Dprimeira-rotina-r95%26utm_content%3Drotina%26utm_term%3Dadvantage-broad
```

**Verified against production (2026-07-25, read-only GET):** one 302 hop → applies the code → lands
**HTTP 200** on `…/pages/lp-n4ga7384b3y3?utm_source=meta&utm_medium=paid&utm_campaign=primeira-rotina-r95&utm_content=rotina&utm_term=advantage-broad` with all five UTMs **intact and decoded** on the LP
(`num_redirects=1`). A GET only stages the code in the cart session; it does not consume the
once-per-customer usage (redemption happens at order placement), so validation is safe.

- `utm_content` = the hook slug (Group B control ads = `rotina`; distinguish by `utm_term`).
- `utm_term` = `advantage-broad` (Group A) / `int-cabelo` / `int-beleza` (Group B).
- One ad per hook = `utm_content` maps 1:1 to the ad (format is captured by placement, not the UTM).
- Every row of `ad-build-table.csv` carries its own coupon-baked, encoded destination URL.

### Cohort key (Module A join)
**Cohort key = the two bundle product GIDs `10212940448064` / `10212940120384`.** The order-tag
automation keys on "order contains bundle product A or B" (not on the UTM), so cohort capture is robust
even if a UTM drops. `utm_campaign=primeira-rotina-r95` is what joins Meta spend ↔ store orders in
Module A. Orders in this cohort are EXCLUDED from blended KPIs by default (guardrail 6); judged on
downstream payback, never first-order margin.

### Budget / wave sizing
Leading indicators (CTR / CPC / cost-per-ATC) stabilize on far less volume than purchase CPA, which is
what makes a 10-hook wave affordable.

| Option | Daily | 7-day wave | Per-hook spend (Group A) | Read quality |
|---|---|---|---|---|
| Lean | R$220 (R$20/hook + R$10×2 probe) | ~R$1,540 | ~R$140 (~150 clicks @ R$0.92) | CTR/CPC rankable; cost-per-ATC thin |
| **Recommended** | **R$340** (R$30/hook + R$20×2 probe) | **~R$2,380** | **~R$210 (~230 clicks)** | CTR/CPC/cost-per-ATC all rankable |
| Rich | R$540 (R$50/hook + R$20×2 probe) | ~R$3,780 | ~R$350 (~380 clicks) | tightest reads, faster stabilization |

Recommended wave ≈ 3-4% of GE's ~R$59-82k/mo Meta spend. Run **7 days**, no mid-wave edits (edits reset
learning). Account benchmarks for context: CTR 2.61%, CPC R$0.92, CPM R$23.97 (30d); hero creative
Primer Cachos hit 4.84% CTR.

---

## 7. Promote / kill thresholds (LEADING indicators — no first-order ROAS)

Judge after the wave, at ≥ ~R$150 spend and ≥ ~1,000 impressions per hook. These are static images, so
"thumbstop" (a video metric) is proxied by **link CTR** + **CPC** + **cost-per-ATC**. Prefer
**rank-relative** thresholds (vs the wave's own median) over absolutes; absolutes below are provisional
tripwires from account benchmarks.

**PROMOTE a hook to SCALE if all hold:**
- Link CTR ≥ wave median AND ≥ ~2.6% (account median); top-quartile ≥ ~3.5% is a strong buy.
- CPC ≤ ~R$1.00 (≤ account avg R$0.92 preferred).
- Cost-per-ATC ≤ wave median (provisional absolute ≤ ~R$12).
- Ranks top ~3-4 of 10 on a blended leading-index (CTR↑, CPC↓, cost-per-ATC↓).
- **AND** the analyst's cohort-payback read (§8) is not red.

**KILL (pause) a hook if any trips, after ≥ R$150 spend:**
- Link CTR < ~1.8% (well below median), OR
- CPC > ~R$1.50, OR
- Cost-per-ATC > ~R$25 (~2× wave median), OR
- Zero ATC after R$120 spend.

**Winner → new-content flywheel:** promoted hook slugs brief /video-director + UGC (doctrine campaign
OUTPUT). Log every drop with its numbers so the wave teaches even where it kills.

---

## 8. Scale gate (depends on the analyst, running in parallel)

The SCALE campaign (§1 Campaign 2) is **not built until both hold**:
1. At least one hook clears the §7 leading-indicator promote bar.
2. **`ga_econ` (Module A) delivers the cohort-payback threshold** — the day-30/60/90 downstream read
   (hero-trial rate, 2nd-purchase rate, cohort payback vs a holdout) that says this negative-first-order
   bet actually pays back. This threshold is being produced in parallel; **treat §7 as necessary-not-
   sufficient until ga_econ's number lands.** Steer scale by Module A NET margin + CAC ceiling, not
   platform ROAS; run/queue an incrementality read before any big ramp (initiative Phase 5).

**Scale build (when gated open):** CBO, optimize **Purchase** (efficiency now matters), winners
consolidated into 1-2 broad ad sets. Scale ≤20% / 48h inside the learning window; don't starve winners
(the account already carries a ~30% creative-testing tax — knowledge.md — so consolidate the wave
promptly rather than leaving 12 ad sets fragmented).

---

## 9. Pre-launch checklist (run before "go")

1. [ ] Bundle products A/B live + component count = 3 each (mechanic spec Deliverable 1); LP add-to-cart wired to their variant GIDs.
2. [ ] Free-ship Function predicate extended for the two bundle GIDs (sub-R$299 bundle still gets free ship).
3. [ ] **Pixel + CAPI firing & deduping** — PageView, ViewContent, **AddToCart** (the optimization event), InitiateCheckout, Purchase — verified in Events Manager. A wave optimized to ATC on a broken ATC signal is burned budget.
4. [ ] Order-tag automation keys on bundle-product-in-cart → `cohort-wash-rotina*` (tagsAdd only; never overwrite tags).
5. [ ] LP loads 200 on mobile 4G with real UTMs; message-match holds (ad hero ↔ LP hero repeats dupla + terceiro presente + R$95 + frete grátis).
6. [ ] Every destination URL is the coupon-baked, percent-encoded discount-redirect (§6) — spot-check one live: 302 → code applied → 200 on LP with all 5 UTMs intact. Confirm the code still shows the R$95 total in a test cart.
7. [ ] Exclusions in place (existing customers + wash-rotina cohort) on all ad sets.
8. [ ] Brand-voice pass on all 10 copies: no em dashes, no invented numbers, real products, tagline once, no discount language.
9. [ ] Kill/promote thresholds (§7) agreed with Lucas in writing.
10. [ ] Daily budget confirmed out loud (R$340/day recommended); wave end-date set (7 days).

---

## 10. Open flags / reconciliations

- **UTM campaign name vs tracking spec.** This manifest uses the CGO-tasked `utm_campaign=primeira-rotina-r95`. The mechanic-tracking-spec's arm-split logic referenced `utm_campaign=wash-rotina-acq`. Reconcile: cohort capture keys on the **bundle product GIDs** (robust), so the UTM only needs to join spend; point the LP cart-attribute / Flow acq-arm rule at `primeira-rotina-r95` (or accept both) before launch.
- **Bundle GIDs.** Manifest uses the CGO-provided cohort GIDs `10212940448064` / `10212940120384` as bundle products A/B. Confirm these are the two live `productType: kit` bundle products at build (the tracking spec listed component-SKU GIDs, which are different — components, not bundles).
- **Static creatives = no true thumbstop.** Leading-indicator ranking leans on link CTR + CPC + cost-per-ATC. If Lucas wants a genuine thumbstop/hold read, the winners feed a video wave via /video-director (the flywheel output anyway).
- **Group B confound guard.** Keep Group B on the control hook only; do not read Group B hooks against Group A (different audiences). It answers "which cold audience," not "which hook."
- **Checkout upsell surface** unconfirmed (mechanic spec flag) — LP-only ships fine; upsell is additive.

---

*Companion file: `ad-build-table.csv` — flat ad-by-ad build sheet (ad name, hook, audience, budget, 4 asset paths, full destination URL) for direct reference during Ads Manager entry.*
