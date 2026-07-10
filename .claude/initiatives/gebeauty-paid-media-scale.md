---
id: gebeauty-paid-media-scale
name: Scale GE Beauty paid media at a MER floor
owner: shared
status: in-progress
priority: high
created: 2026-07-09
target: null
current_phase: 1-measurement-baseline
next_blocker: Lucas to confirm recommended MER floor (hard 3.5 / comfort 4.0; breakeven 2.86 at 35% margin) AND provide one month Shopify total revenue for MER calibration
next_owner: lucas
stakeholders:
  - GE Beauty (brand / end-consumer acquisition)
  - Lucas (owns budget ceiling + MER floor)
working_agreement: ~/.claude/projects/c--Users-Lucas-Guimar-es-Desktop-nami-works/memory/feedback_cto_contract.md
---

## Why
Scale GE Beauty's paid-media investment aggressively while holding blended efficiency above a floor Lucas sets. Today the Meta account is single-funnel (70%+ of spend in one stage, optimizing for "ready-to-act" buyers), which is the ceiling: harvesting bottom-funnel demand doesn't survive an aggressive budget ramp because in-market demand is finite. The win state is a funnel that manufactures new demand fast enough that each incremental real dollar still clears the MER floor, verified by incrementality — not by platform-attributed ROAS alone.

## The governing rule
**Scale aggressively, but never below the blended MER floor.** North-star metric = MER (total revenue ÷ total ad spend). Platform ROAS is a per-campaign diagnostic, not the governor. Steering is by *marginal* efficiency: keep increasing budget while the next increment holds MER ≥ floor; hold/pull back when it doesn't. Blended ROAS is expected to compress as we scale — that is not failure, that is the trade we are pricing.

## Phases
- [ ] 1. Measurement baseline + MER floor — IN PROGRESS, owner: /growth-hacker + lucas
      Pull 30/60/90d spend, revenue, platform ROAS, AOV, new-vs-returning split. Confirm Pixel + CAPI (server-side) fire clean and dedupe. Verify why the time-series ROAS trend returned empty (thin spend vs. broken signal). Lucas sets the MER floor from contribution margin + payback window.
- [ ] 2. Account restructure — build the funnel — owner: /growth-hacker
      Split prospecting (broad / Advantage+) from retargeting so retargeting stops flattering blended numbers. Stand up top/mid-funnel to create new demand. Consolidate fragmented ad sets (auction overlap check) to concentrate learning.
- [ ] 3. Creative engine — owner: /growth-hacker + /video-director + /content-director
      Set a concepts-per-week cadence (creative volume is the real Meta scaling lever). Foreplay for competitive intel, our pipeline (Magnific/Canva/video-director) for production. Angle/format matrix, not one-off assets.
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

## Done means
- Blended MER floor is a written number, agreed with Lucas, tied to contribution margin + payback.
- Pixel + CAPI verified firing and deduping; a trustworthy spend/revenue/ROAS baseline exists.
- Account runs a real prospecting↔retargeting split with a live top/mid-funnel.
- A creative cadence is running (N concepts/week actually shipping).
- Monthly paid spend is materially above the 2026-07 baseline AND blended MER is at or above the floor at the higher spend.
- At least one incrementality test has run and its result is on record.
