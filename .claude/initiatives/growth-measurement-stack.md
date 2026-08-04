---
id: growth-measurement-stack
name: GE Beauty growth measurement & attribution-integrity stack
owner: shared
status: in-progress
priority: high
created: 2026-07-30
target: null
current_phase: 3-utm-medium-sprawl
next_blocker: Lucas hasn't greenlit the next move — the Instagram utm_medium sprawl profiling scan (offered, not yet approved) vs. jumping to the GeoLift causal test
next_owner: lucas
stakeholders:
  - Lucas (growth strategy calls)
  - GE Beauty paid-media agency (executes the tagging standard)
  - Nemu (attribution vendor — open CAPI question)
working_agreement: ~/.claude/projects/c--claude/memory/feedback_cto_contract.md
---

## Why
Every spend and pricing decision at GE Beauty leans on knowing which revenue came from where. No single tool is truth, so this initiative maintains a triangulated measurement spine (Nemu cockpit + margin-true profit + independent platform pulls) and keeps attribution honest. Two live integrity problems distort the organic/influencer/paid split and inflate paid ROAS; closing them protects the 10% net floor judgment and the agency-audit story.

## Doctrine
- **No single tool is truth — triangulate.** Nemu is the cockpit, Module A is profit truth, independent platform pulls audit both. Never judge the 10% net floor by Nemu's rosy ~64% margin (it excludes COGS/freight/fulfillment/Boniteca).
- **Nemu is MTA (correlational), not causal.** Causal claims need a real experiment (GeoLift / Conversion Lift), not attribution-model reads.
- **UTM co-occurrence is checked PER VISIT, never at order level.** Shopify multi-touch journeys legitimately carry paid + organic UTMs on *different* visits of one order. Reading order-level co-occurrence as a single leaked URL is exactly what produced the (now-closed) false-positive "contamination."
- **`utm_medium` is the paid(`cpc`)/organic(`organic`) switch** — the #1 attribution-quality lever.
- **Nemu's paid Meta template uses `{{name}}|{{id}}` with pipes on purpose** — `|` is Nemu's name↔id separator; that signature is correct only on a paid click. The one forbidden thing: a `|` *inside* a campaign/ad name (breaks the split).
- Detail lives in committed repo files: `gebeauty/growth/knowledge.md` (office memory / doctrine + numbers) and `gebeauty/growth/references/utm-conventions.md` (the Nemu-applied UTM playbook). These are the durable source of truth.

## Live layers
- **Nemu** — cockpit + Brazil/PIX-aware signal + multi-touch attribution. Nemu MCP, dashboard "Atribuição geral" id 4967, ~12mo history, 9 attribution models (default first-click). Replaced the plan to buy Triple Whale.
- **Module A** — margin-true profit spine at `gebeauty/growth/module-a/`. Where the 10% net floor is actually judged.
- **Independent platform pulls** — meta-ads MCP + `gebeauty/growth/module-a/google_ads_fetch.py` (Google Ads API v21). Cross-check Nemu and audit the agency.
- **Measured fact:** PIX ≈ 31.6% of revenue / 36.8% of orders (30d, 2026-07-27) — the async-payment signal ad pixels under-see.

## Phases
- [x] 1. Measurement stack stood up — Nemu + Module A + independent platform pulls all live — done 2026-07-30
- [x] 2. UTM conventions playbook committed + bio-link "contamination" investigated and closed as a FALSE POSITIVE (full 12mo per-visit scan: 46,915 orders, 0 contaminated) — done 2026-07-30
- [ ] 3. Instagram `utm_medium` sprawl cleanup — IN PROGRESS, owner: lucas (greenlight) → cto (execute). Profile source/medium breakdown with orders + revenue per bucket, then hand the agency/social team one tagging standard enforced at the link-builder source (bio tool, influencer link builder, Stories/Reels swipe-ups) per `gebeauty/growth/references/utm-conventions.md`
- [ ] 4. Brand-search GeoLift causal test — pause `[SEARCH] MARCA` in matched regions to settle the Google-harvester concern (branded search ≈41% of Google spend manufacturing a 10.1x ROAS). Tools: GeoLift by Recast + self-hosted Meridian + Meta Conversion Lift (`ads_experiment_lift_create_test`)
- [ ] 5. Ask Nemu the CAPI question — does Nemu forward recovered PIX conversions server-side to Meta/Google, or only report? If report-only, an Elevar-style CAPI layer adds delivery value
- [ ] 6. Deeper Nemu mining (influencers-by-coupon ~30 `{NAME}10` codes, creatives, basket, competitor Meta ads, per-channel reconciliation) + confirm GE's paid Meta + Google accounts actually carry the Nemu templates (paid-side completeness)

## Notes
- 2026-07-30 — Initiative created from `docs/handoff-growth-initiative.md` (prior Claude Code session; commit `d9524a8`), which was then deleted. Unified two prior threads (`growth_watchdog` UTM investigation + `growth_team` measurement stack).
- 2026-07-30 — **Two attribution-integrity issues are live and must not be conflated:** (a) the Google brand-search **harvester** inflating ROAS → needs the GeoLift test (phase 4); (b) the Instagram `utm_medium` **sprawl** muddying the organic/influencer/paid split → needs tagging discipline at the source (phase 3). The bio-link "contamination" was a third, now-closed FALSE alarm.
- 2026-07-30 — Discard the old contamination counts (68 / 1,183 / 3,544 / 4,795) — inflated order-level OR'd numbers. Order #89360 was a normal multi-touch journey (3 clean paid Meta visits + 1 clean organic bio visit on different visits), not a leaked URL. Lucas manually standardized the bio link to `utm_medium=organic` on 2026-07-27 — harmless hygiene, corrected no real misattribution.
- 2026-07-30 — Re-scan mechanics (if profiling phase 3): Shopify GraphQL `orders{ … customerJourneySummary{ momentsCount{count} firstVisit/lastVisit{ source utmParameters{source medium campaign content term} } moments(first:20){ nodes{ ... on CustomerVisit{ … } } } } }`. Gotchas: `momentsCount` needs `{count}`; `moments` nodes are the `CustomerMoment` interface (`nodes{ ... on CustomerVisit{…} }`); `utmParameters` exposes only source/medium/campaign/content/term — `utm_id` is NOT surfaced (lives only in the raw landing-page query string), which partly drove the original wrong analysis. Full 46,915-order scan ≈ 9 min — run in the background, not a foreground shell, and NOT via a sub-agent. Scan scripts were scratchpad-only and are not in the repo; re-author fresh if needed. Shopify creds: `gebeauty/.env` (`SHOPIFY_ADMIN_ACCESS_TOKEN`, domain `ge-beauty-cosmeticos.myshopify.com`, API `2026-01`).
- 2026-07-30 — Meta ad account that actually spends: `606199920079315` ("GE_Beauty", BRL). Other read-only accounts under business `221767282502823` are for integrations — don't confuse them.
- 2026-07-30 — Adjacent but distinct: `.claude/initiatives/gebeauty-acquisition-rescue.md` is the rescue *campaign*; this file is the measurement/attribution *spine*. Keep separate.
- 2026-07-30 — Context flag (not growth): a repo-wide move off the custom git conventions toward Claude-default branch+PR was interrupted mid-session and is unfinished; the CLAUDE.md git section and related memories were flagged for removal but not removed. Don't assume either convention is fully in force — confirm with Lucas.

## Done means
- The Instagram `utm_medium` sprawl is quantified (orders + revenue per source/medium bucket) and a single tagging standard is enforced at every link-builder source, with the organic/influencer/paid split in Nemu reading clean.
- The brand-search GeoLift test has run and the branded-search ROAS question is settled with a causal (not correlational) answer.
- The Nemu CAPI-forwarding question is answered and a decision recorded on whether a CAPI layer is warranted.
- Doctrine and results stay current in `gebeauty/growth/knowledge.md` and `gebeauty/growth/references/utm-conventions.md` as the durable sources of truth.
