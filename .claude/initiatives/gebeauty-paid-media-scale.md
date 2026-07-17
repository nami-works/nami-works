---
id: gebeauty-paid-media-scale
name: Scale GE Beauty paid media at a MER floor
owner: shared
status: in-progress
priority: high
created: 2026-07-09
target: null
current_phase: 1-measurement-baseline
next_blocker: Lucas to confirm recommended MER floor (comfort 4.0 / hard 3.5; breakeven 2.86 at 35% margin). MER calibration DONE — blended online MER ~8.3 (30d), ~2x the comfort floor; the marginal ad dollar is the real constraint (see 2026-07-09 calibration note). Two small Shopify pulls remain: new-vs-returning split; identify channel 316281618433 (R$53k/30d)
next_owner: lucas
stakeholders:
  - GE Beauty (brand / end-consumer acquisition)
  - Lucas (owns budget ceiling + MER floor)
working_agreement: ~/.claude/projects/c--claude/memory/feedback_cto_contract.md
---

## Why
Scale GE Beauty's paid-media investment aggressively while holding blended efficiency above a floor Lucas sets. Today the Meta account is single-funnel (70%+ of spend in one stage, optimizing for "ready-to-act" buyers), which is the ceiling: harvesting bottom-funnel demand doesn't survive an aggressive budget ramp because in-market demand is finite. The win state is a funnel that manufactures new demand fast enough that each incremental real dollar still clears the MER floor, verified by incrementality — not by platform-attributed ROAS alone.

## The governing rule
**Scale aggressively, but govern by rising absolute contribution profit, with the blended MER floor as the tripwire.** Two stacked gates:
1. **MER floor 4.0** (breakeven 2.86 at 35% margin) = fast daily gauge / tripwire. Necessary but NOT sufficient.
2. **Absolute contribution profit = sales×0.35 − spend must rise at every spend step** = the actual truth of whether scaling is working.
Why both: blended MER can sit ABOVE the floor while the marginal dollar loses money, because the fixed organic base (~R$176k/30d, see calibration note) + high-MER inframarginal spend prop the blend up. Worked example: spend R$59k→122k, sales R$489k→610k = blended MER 5.0 (above floor) yet marginal ROAS 1.92 (< breakeven) and absolute profit FALLS R$112k→R$91k. So: steer by *marginal* efficiency, keep raising budget only while the increment clears breakeven AND absolute contribution profit climbs; the MER floor just flags when to look. Blended ROAS/MER compressing as we scale is expected and fine; absolute profit falling is the stop signal. This is why incrementality (Phase 5) must run BEFORE the big ramp — it's the only read on true marginal ROAS.

## Phases
- [ ] 1. Measurement baseline + MER floor — IN PROGRESS, owner: /growth-hacker + lucas
      Pull 30/60/90d spend, revenue, platform ROAS, AOV, new-vs-returning split. Confirm Pixel + CAPI (server-side) fire clean and dedupe. Verify why the time-series ROAS trend returned empty (thin spend vs. broken signal). Lucas sets the MER floor from contribution margin + payback window.
- [ ] 2. Account restructure — build the funnel — owner: /growth-hacker
      Split prospecting (broad / Advantage+) from retargeting so retargeting stops flattering blended numbers. Stand up top/mid-funnel to create new demand. Consolidate fragmented ad sets (auction overlap check) to concentrate learning.
- [ ] 3. Creative engine — owner: /growth-hacker + /video-director + /content-director
      Set a concepts-per-week cadence (creative volume is the real Meta scaling lever). Foreplay for competitive intel; production pipeline hardened in `docs/creative-ad-image-pipeline.md` (Canva master templates + Magnific). Angle/format matrix, not one-off assets. **Still-ad production is now a solved, repeatable flow (5 formats from one hero) — see 2026-07-09 creative-pipeline note. First output: Travel-Size "pague só o frete" promo.**
- [ ] 4. Structured ramp — owner: /growth-hacker + lucas (spend approvals)
      Aggressive budget increase, still stepped enough to protect the learning phase, each step gated on MER holding the floor. Prospecting scales first (it's the demand engine); retargeting scales as a follow.
- [ ] 5. Incrementality validation — owner: /growth-hacker
      Geo-lift or conversion-lift test (meta-ads lift tooling) to prove spend is causing sales, not claiming credit for organic. This is what defends the budget at the new level.
- [ ] 6. Weekly decision cadence — owner: /growth-hacker (recurring)
      Standing scale / kill / iterate review against the floor, with pre-set guardrails (never scale in learning phase, kill thresholds, creative-fatigue triggers).

## Notes
- 2026-07-09 (MER floor proposed, pending Lucas confirm) — Contribution margin = **35%** (Lucas). Therefore **breakeven MER = 2.86** (1÷0.35). Recommended two-tier governor:
  · **Hard floor 3.5** (scale hard while blended MER ≥ 4.0; caution zone 3.5–4.0 = slow the ramp, watch; below 3.5 = pull back). At MER 3.5 profit-before-fixed ≈ 6.4% of revenue; at 4.0 ≈ 10%.
  · **STRATEGIC FLAG (money call for Lucas):** a 35% margin puts real tension on "aggressive." The only prospecting engine (ADVANTAGE TOPO) runs at 4.03 *platform* ROAS; after de-rating platform over-attribution its true MER may sit near or below the 2.86 breakeven, so pouring budget straight in could be scaling at ~breakeven. Implications: (1) move incrementality testing EARLIER (before the big ramp, not after) since margin leaves no room for attribution self-deception; (2) lean the ramp on the free efficiency harvest (fragmentation/music/A+, Opp Score 56) and on AOV/margin lift, not budget alone; (3) "aggressive" here means aggressive within a tight MER band, not uncapped spend.
  · **Calibration still required:** one month of Shopify *total* revenue ÷ *total* ad spend to locate where true MER sits today relative to the floor (platform ROAS 5.29 ≠ MER). Until then the headroom is estimated, not measured.
- 2026-07-09 (baseline complete) — Real numbers pulled from GE_Beauty `606199920079315` (BRL) via `ads_get_ad_entities`.
  **Account, last 30d (Jun 9–Jul 8):** spend R$59.1k, platform purchase ROAS **5.29**, 2.47M impr, 64.5k clicks, CTR 2.61%, CPC R$0.92, CPM R$23.97. Implied Meta-attributed revenue ≈ R$313k.
  **Monthly trend:** Apr (21d) R$46.8k @5.84 · May R$39.8k @5.49 · Jun R$51.6k @**4.89** · Jul (8d) R$20.3k @5.41. Spend accelerating: July pacing ~R$76k/mo vs June R$52k.
  **Frontier signal is real and already in the data:** June was the highest-spend full month AND the lowest ROAS (4.89, ~15% below May). Pushing spend already compresses efficiency — this is the exact curve the initiative must steer by.
  **Structure (90d by spend):** REGULAR conversion workhorse [ABO][MISTO] R$101k @5.88 (~64%, BOFU/MOFU, near-saturation) · ADVANTAGE TOPO R$35.8k @**4.03** (~19%, the ONLY real prospecting engine, underfed) · creative testing ~R$12k @6.16/8.02 · product tests small. Referral "Indique e Ganhe" R$898 @**0.13** = effectively dead, kill candidate.
  **Signal gap RESOLVED:** ROAS/purchase data populate fine here — the earlier empty `performance_trend` was a tool quirk, NOT broken tracking. Caveat: this is Meta *platform* attribution, not yet triangulated against Shopify, so it likely overstates true incrementality. MER calibration (below) still required.
  **Opportunity score 56/100.** Free mechanical efficiency Meta flags BEFORE spending more: auction fragmentation (multiple ad sets self-competing; lifts +4/+4/+3/+2 → consolidate), music on ads (+8 CTR), A+ standard enhancements (+5, -11% CPA). Harvest these first — they lift the ROAS ceiling we then scale into.
  **Still missing (needs Shopify, not Meta):** AOV, new-vs-returning split, and true blended MER (total store revenue ÷ total ad spend). Flagged for Phase 1 close.
- 2026-07-09 — Initiative opened. Spend account = GE_Beauty `606199920079315` (BRL); USD accounts (Zoko/Klaviyo/Hexagon) are read-only integration mirrors. Advertiser-context: single-funnel, 70%+ one stage, "ready-to-act" — confirms the BOFU concentration seen in the campaign split above.
- Decisions locked with Lucas: target = GE Beauty consumers; posture = aggressive ramp WITH a minimum-ROAS/MER floor; governor = blended MER; do the baseline pull before drafting (done).
- Companion kickoff brief for /growth-hacker: `inputs/growth-gebeauty-paid-media-scale-2026-07-09.md`.
- 2026-07-09 (6-MONTH CAMPAIGN MINING → strategy spine) — Pulled campaign roster Jan9-Jul8 via `ads_get_ad_entities` (ad-level pull failed on server error; deferred to execution). Opp score now **63** (was 56).
  **The spine: both engines are past their creative peak.** REGULAR CONVERSÃO ABO MISTO R$187k ROAS 6.46(6mo)→5.88(90d); ADVANTAGE TOPO R$89.5k **6.42(6mo)→4.03(90d)**. Decay = the #1 scaling constraint is creative refresh rate, NOT budget. Feeding budget to fatigued creative buys the 4.03, not the 6.42.
  **Underfunded winners:** DESCONTO PROGRESSIVO (progressive-discount offer) R$17.9k @ **9.03** (best mechanic, only ~5% of spend); Novos Vídeos VALIDADOS @ **8.02** starved at R$1.2k.
  **Creative learning:** Primer Cachos = hero (CTR 4.84%, ROAS 5.93). Primer Liso = CTR 5.48% but ROAS 2.36 → conversion/LP/offer problem, NOT demand (fix PDP before scaling media). UGC/coloquial + review video beat institucional static (2.95/3.94 vs 1.55).
  **Referral (Indique e Ganhe) ROAS 0.13** = already INACTIVE (confirmed by Lucas live in Ads Manager 2026-07-09). Historical spend in-window only, not an active leak. No action needed.
  **Free lifts to harvest first (Opp Score):** music +10pts (250+ ads, higher CTR), A+ enhancements −21% cost/result, Reels 9:16+audio −8%, multi-text −20%.
  **STRATEGY (ordered, feeds Phases 2-3):** (1) harvest free efficiency wk1, zero new spend — music/A+/multi-text/9:16, lifts ceiling before scaling into it; (2) FIX then FEED TOPO — refresh creative from test winners, then put incremental budget here (this is the topo we thought was missing; it exists, proven at 6.42, just fatigued+underfed), run incrementality here; (3) scale DESCONTO PROGRESSIVO (9.03) across products/audiences; (4) fund a VALIDADOS graduation path (8.02 winners starved); (5) consolidate self-competing ABO ad sets toward Advantage+ (referral already inactive, no kill needed); (6) product allocation: lean into Primer Cachos, fix Primer Liso PDP before media. Sequencing: efficiency + creative BEFORE budget, or we scale the 4.03 not the 6.42.
- 2026-07-09 (MER CALIBRATED — real Shopify revenue) — Pulled online-store net sales via Shopify Admin GraphQL (`gebeauty/scripts/_online_revenue_mer.py`, read-only, canonical net-sales formula, POS/IGLU excluded). Online = web + TikTok + channel `316281618433` + drafts.
  **Blended online MER by window (net online rev ÷ Meta spend, BRL):** Last 30d (Jun9-Jul8) R$489k/59.1k = **8.28** · Apr R$563k/46.8k = **12.02** · May R$417k/39.8k = **10.49** · Jun R$402k/51.6k = **7.80** · Jul MTD R$169k/20.3k = **8.33**. AOV flat ~R$190 every window.
  **Headroom is real and large:** blended MER ~8 vs breakeven 2.86 and comfort floor 4.0. My earlier "scaling near breakeven" flag was platform-ROAS-only and is now SOFTENED — the blended cushion is ~2x the comfort floor.
  **But the cushion is partly organic:** Meta claims only ~R$313k of the R$489k 30d online rev (5.29 × spend = ~64% attributed); the other ~R$176k is email/TikTok/direct/returning/SEO. So blended MER 8.3 overstates paid efficiency — the MARGINAL ad dollar performs near platform rates (5.29 blended / 4.03 prospecting). Govern by marginal, not blend.
  **Frontier confirmed in own data:** June = highest spend (51.6k) AND lowest MER (7.80) AND lowest rev (402k); April spent less (46.8k) but pulled 563k @ MER 12 (likely Mist launch/promo spike, not baseline). Reinforces: run incrementality BEFORE the big ramp.
  **Revised floor rec:** comfort 4.0 (breakeven 2.86). Clear room to push the underfed ADVANTAGE TOPO prospecting engine (~19% of spend). AOV (~R$190, flat) is an untouched MER lever.
  **Still open (needs Shopify, not Meta):** new-vs-returning split; identify channel `316281618433` (R$53k/30d online — confirm ad-driven vs owned).

- 2026-07-09 (Phase 3 — still-ad production pipeline hardened, from the Travel-Size "pague só o frete" promo build). Playbook `docs/creative-ad-image-pipeline.md`; campaign assets `gebeauty/imagery/travel-size-promo/{expanded,creatives}`; Canva folder `Projetos › Criativos › Travel Size - Pague Só o Frete`.
  · **Background extension — the technique that actually works for product stills:** Magnific `images_expand` (outpaint, tried ideogram AND flux) REGENERATES the scene and DELETES the product — never use it to extend a product shot (wasted credits twice before catching this). Nano Banana Pro reference zoom-out (`images_generate`, mode `imagen-nano-banana-2`, source in `references`) keeps the product + continuous studio but drifts fine label text. **WINNER = HYBRID:** Nano Banana zoom-out for the continuous background, then cv2 template-match + feathered composite of the real product region back over it → continuous studio AND pixel-true labels, packaging 100% untouched. Contrast with the Body & Hair Mist set, where straight Nano Banana zoom-out was fine (big simple labels, ambient scene).
  · **House layout rule (now global default):** horizontal → product LEFT / whitespace RIGHT; vertical → product BOTTOM / whitespace TOP (memory `feedback_product_left_whitespace_right`). Extension guardrail: only add background, never re-render the product (memory `feedback_image_extension_rule`).
  · Same-aspect zoom-out (1:1→1:1) barely adds space → derive the 1:1 by bottom-cropping the 9:16 plate.
  · **Canva formatting:** font family is NOT settable via the Canva MCP → clone a brand-font template rather than typing fresh text. The Primer Cachos multi-format master (META_CACHOS2) is the reusable ad template (4:5/1:1/9:16/1.91:1); export per page; must `commit-editing-transaction`; the real share links come from `get-design` (design_id ≠ URL slug).
  · **Promo-offer hook patterns (Foreplay winners, "free/try, pay only shipping"):** Ayurveda Experience "TRY BEFORE YOU BUY!" (free mini, just pay shipping — 110d+ running) and Caffeine Army "5 sachês grátis, pague só o frete + voucher do mesmo valor pra próxima compra." Formula: lead with GRÁTIS + product, state the exact shipping price, **voucher-back** (recoups shipping as next-order credit → drives the 2nd purchase, fits the cash-bridge goal), conviction + a social-proof number, light urgency. 7 GE-voice hooks validated for the travel-size promo (open mechanic Qs: voucher-back? shipping price? curated vs choice? new-customers-only?).
  · **Repo/asset note:** repo migrated to `c:/claude`, `gebeauty/` promoted out of `sandbox/` to the root; tenant `.env` now `c:/claude/gebeauty/.env`. Memory mirrored across two project folders (`c--claude` active + `c--Users-...-nami-works`) — consolidate when convenient.

- 2026-07-11 (Phase 3 — Travel-Size "pague só o frete" full matrix SHIPPED: **28 assets = 7 approved hooks × 4 Meta formats** (4:5, 1.91:1, 1:1, 9:16). Delivered to `gebeauty/imagery/travel-size-promo/creatives/{hooks-4x5,matrix}/`. The 3:1 web banner (6 assets) is the only deferred format — site-surface ratio, not a Meta placement, non-blocking. These are the layout/typography lessons that turned a one-off hero into a repeatable copy-matrix; all folded into `docs/creative-ad-image-pipeline.md` §3.
  · **Copy-matrix propagation — clone-and-swap, never retype.** Perfect ONE design across all 4 format pages with Lucas → that's the template. `copy-design` it per hook, `replace_text` the headline+support only. Clones inherit exact fonts/positions/plate. Element local-IDs (the `-LB…` suffix) are STABLE across clones; only the `<page_id>` prefix changes — so one edit recipe drives every clone. This is the mechanism that makes N hooks × M formats cheap.
  · **Match the SET's headline weight, don't fit-to-fit each hook in isolation.** The single biggest correction of the build: the longest-copy hook (hook 5 "descubra o cheiro…") got auto-shrunk to fit its own box and ended up visibly smaller than its neighbors. Fix = level every same-format headline to a common visual weight (1.91 ≈ 54px, 9:16 ≈ 100-120px here), THEN adjust line-breaks to make that size fit — not the reverse. Fit-shrink is a last resort within a size band, not the first lever.
  · **Support hugs the headline — and RE-hug on every resize.** Support `top` = headline `top` + headline box `height` + ~20-30px. Whenever the headline grows/shrinks lines, the support must move with it; a smaller headline must never leave a blank band above the support. Re-hugging was the most-repeated single fix across the whole build.
  · **Shrink-to-fit keeps the anchor.** When a longer hook overflows or crowds the `ge` logo, reduce `font_size` and hold the anchor `position` fixed — never reposition or widen the frame to make room.
  · **Two Canva text-physics quirks:** (1) Canva JUSTIFIES a soft-wrapped line to fill the box → headlines look stretched/uneven; defeat with hard `\n` breaks so no line soft-wraps (9:16 headlines = 3-5 hard-broken lines). (2) A support box authored WIDER than the canvas (e.g. 1338 on a 1080-wide 9:16) pushes a long one-line support invisibly off the right edge → wrap it to 2 lines.
  · **Logo/product clear zones:** on 9:16 the top-corner `ge` logo occupies ~x895-1038 / y60-203 → keep the headline's FIRST line short (≤~13 chars) so it clears the logo even at 100-120px; lower lines fall below the logo and can run full width. 1:1 must show the FULL product (no cropped podium/tube bases) — rebuilt the 1:1 plate deterministically (PIL: scale hero to 90% height, bottom-align on 1080², edge-replicate side pads + top band) rather than bottom-cropping the 9:16, which clipped the bases.
  · **Font size is not returned by transaction snapshots** → infer from box `height` (observed line-height factor ≈ 0.97 × font_size per line on this template) or preserve by not calling `format_text`. Rough fit math: line px ≈ 0.47 × chars × font_size.
  · **QA gate (Lucas's, now standing for every still):** support hugs the headline? · minimal whitespace / headline as large as fits? · no copy invading the logo breathing space nor the products? All three pass → ship.
  · **Canva designs of record (META_CACHOS2 template family):** template/hook3 = DAHPBag6oBE; per-hook multi-format clones hook1=DAHPBw2txSQ, hook2=DAHPB55U_Z4, hook4=DAHPB4p9AmU, hook5=DAHPB_3H_JM, hook6=DAHPByeLJoM, hook7=DAHPB0bbWDA; 4:5 seed=DAHO7Izhwug; rebuilt 1:1 plate asset=MAHPBrzxJog. Campaign folder FAHO7pMh_g4.

## Done means
- Blended MER floor is a written number, agreed with Lucas, tied to contribution margin + payback.
- Pixel + CAPI verified firing and deduping; a trustworthy spend/revenue/ROAS baseline exists.
- Account runs a real prospecting↔retargeting split with a live top/mid-funnel.
- A creative cadence is running (N concepts/week actually shipping).
- Monthly paid spend is materially above the 2026-07 baseline AND blended MER is at or above the floor at the higher spend.
- At least one incrementality test has run and its result is on record.
