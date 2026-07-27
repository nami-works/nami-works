# Growth brief — GE Beauty travel-size "cortesia" (free-plus-shipping, new customers)

**Date:** 2026-07-10 · **Mode:** campaign-design → pre-launch critique applied · **Brand:** GE Beauty (consumers)
**Initiative:** `.claude/initiatives/gebeauty-paid-media-scale.md` · **Handover:** `docs/handover-travel-size-campaign.md`
**Status:** 🟢 LAUNCHED 2026-07-10 (live via Meta API). Campaign `[GE] [GANHE MINI] [CONVERSAO] [ABO] [NOVOS]` = `120250467165120228` ACTIVE.
- Ad set A broad `120250467166790228` (R$60/day) · Ad set B lookalike `120250467167570228` (R$60/day)
- 8 ads live: ganhe + primeiro × 1x1/9x16 × broad/lookalike (creative v2, utm_campaign=ganhe-mini). Page 106114707866572, IG 17841423297702015, pixel 958727274605304.
- UTM passthrough to LP confirmed. Ads in Meta review → deliver on approval. Ad set B ramps once the 1% LAL finishes populating.
- Kill: pause an ad set at CPA > R$40 after ~30-50 conversions. Holdout deferred (underpowered at R$120/day; read incrementality by geo/time at scale).
- Open (Lucas): WhatsApp widget removal on the LP.

## The offer (built, unchanged)
Free-plus-shipping tripwire for NEW customers: pick one travel size (shampoo / máscara / leave-in), pay only shipping. Coupon `MINI-GRATIS_2PDR1FZ` (Function Studio, first item free, shipping always paid). LP built + unlisted at `/pages/lp-e4fa5694b3a8`; campaign destination = the discount link `.../discount/MINI-GRATIS_2PDR1FZ?redirect=/pages/lp-e4fa5694b3a8`.

## Locked config (Lucas-approved 2026-07-10)
- **New-only guard:** both layers — checkout Function blocks existing buyers (verified via Test B) + targeting excludes past buyers.
- **Budget:** **R$120/day, ABO = R$60 per ad set** (ABO not CBO, so the broad-vs-LAL quality comparison isn't muddied by Meta shifting budget to cheaper conversions). Purchase-optimized, bid = conversion COUNT, not value.
- **Structure:** 1 campaign, 2 ad sets — (A) broad/Advantage+, (B) **1% lookalike of repeat buyers**. Judged on 2nd-purchase rate, not CPA alone.
  - Seed `[SEED] Compradores recorrentes 2026-07-10` = id `120250466957240228` (10,690 repeat buyers, populating).
  - Lookalike `Semelhante (BR, 1%) - Compradores recorrentes 2026-07-10` = id `120250466976690228` (built 2026-07-10, populating ~hours).
  - Exclusions (both ad sets): `[EXCLUSAO] Compradores all-time 2026-07-10` id `120250466589500228` + pixel `Purchase 180D` + `Clientes recorrentes`.
- **Exclusions (both ad sets):** `[EXCLUSAO] Compradores all-time 2026-07-10` (id 120250466589500228, 50k) + pixel `Purchase 180D` + `Clientes recorrentes`.
- **Creative:** launch `ganhe-miniatura` statics now; `/video-director` UGC/Reels queued after week-1 CPA read. **Real hero (screenshot 2026-07-10) = "seu primeiro GE Beauty é por nossa conta / escolha um travel size e pague só o frete" — offer-led. Wave 1 LEADS with `primeiro` + `ganhe-miniatura` hooks (verbatim-strong match); `experimente` to wave 2. (Earlier WebFetch misread hero as "experimente a GE Beauty" — corrected.)**
- **Incrementality:** Meta conversion-lift holdout from day one (directional at this budget; firms up as we scale).
- **Success:** cost per new customer + 2nd-purchase rate (60-90d cohort). ROAS is not the lens (product is free by design).
- **UTMs:** `utm_source=meta&utm_medium=paid&utm_campaign=travelsize-cortesia&utm_content=<hook>&utm_term=<adset>`; Shopify order tag for cohorting.

## LP review findings (2026-07-10, via WebFetch of the live LP)
- **RESOLVED — earlier WebFetch flags were artifacts, not bugs (Lucas confirmed via live review 2026-07-10).** The fetch hit the bare URL without the coupon cookie / on-load giftapply script, so it saw pre-discount state (button "comprar · R$40", placeholder slots). Real visitors arriving via the discount link see the correct free / "pague só o frete" state. LP confirmed solid; no build fixes required.
- **MESSAGE-MATCH — STRONG (verified via screenshot 2026-07-10).** Real hero = "seu primeiro GE Beauty é por nossa conta" + "escolha um travel size e pague só o frete." Offer-led; matches `primeiro` + `ganhe-miniatura` hooks tightly. Earlier WebFetch misread it; corrected. No hero change needed.
- **PAID-FLOW FLAG — WhatsApp path (RESOLVED — Lucas removing the widget himself, 2026-07-10).** Rationale: WhatsApp orders are manual draft orders that bypass the coupon Function (new-only + free-mini) and Pixel/CAPI/UTM (untracked → breaks CPA + 2nd-purchase cohort). CAUTION logged: the WhatsApp buy widget is a store-wide feature in BOTH theme layouts (`gebeauty/theme/whatsapp-widget/`); removal must be scoped to this LP (`gift_mode`-gated), not store-wide, unless intended. Optional nicety still open: above-fold "quero meu travel size" button to the selector.
- **PENDING:** Core Web Vitals (LCP/CLS/INP) not yet measured — run PageSpeed Insights on mobile before launch.

## Kill / scale rules (LOCKED)
- **CPA ceiling = R$40** per new-customer purchase (Lucas, provisional; refine once 2nd-purchase cohort lands). Note vs economics: ~R$66 contribution/order at 35% margin, so R$40 leans on a decent 2nd-purchase rate to pay back, watch the cohort closely.
- **Kill:** pause an ad set if CPA > R$40 after ~30-50 conversions.
- **Scale:** ≤20% / 48h inside learning; up to 2× outside; only on the ad set clearing R$40 AND showing the better 2nd-purchase rate.

## Open blockers before launch
1. Unit economics → CPA ceiling + kill criterion (Lucas).
2. LP fixes: remove placeholder cards, fix button/price display, (decide) hero message-match rewrite.
3. Core Web Vitals pass.
4. Clean public slug replacing the unlisted one; Pixel + CAPI + UTM verified on destination.
5. Then: create paused draft → final "go" to un-pause.
