---
id: gebeauty-chief-growth-office
name: GE Beauty Chief Growth Office (CGO) — profitable-growth operating system
owner: cto
status: in-progress
priority: high
created: 2026-07-21
target: null
current_phase: A-measurement-spine
next_blocker: Module A unit-economics structure CONFIRMED + validated with Lucas (2026-07-21): 42.1% contribution before media, max allowable CAC ~R$68/new order at the 10% floor. Next = Module A v1 media-allocation layer — join Meta spend (meta-ads MCP, live) to per-channel/per-order CAC so the 10% floor becomes a live post-media gate; Google Ads still needs data access for the branded/non-branded split (H1).
next_owner: cto
stakeholders:
  - GE Beauty (brand / end-consumer acquisition + retention)
  - Lucas (owns the 10% net floor, the brand rulebook, budget ceiling, money assumptions)
working_agreement: ~/.claude/projects/c--claude/memory/feedback_cto_contract.md
---

## Why

Stand up an AI-native growth operation for GE Beauty that drives aggressive but
**strictly profitable** growth: minimum 10% NET profit on every sale (per-purchase,
not just blended) and no brand-diluting discounting. Instead of ~10 human hires, the
operation is a set of interconnected modules built + orchestrated in Claude Code. This
initiative is the **office of record** — it holds the module map, the guardrails, the
build order, and the standing cadence. The individual modules live as their own
skills + initiatives; this file coordinates them and is the single place to see the
whole operation's state.

Mandate priority order: (1) new-customer acquisition via paid media, (2) repurchase /
LTV from the existing base. GE Beauty only (Bossa is out of scope).

## Hard guardrails (non-negotiable — from the mandate)

1. **10% net-profit floor on every sale.** The business is not yet cash-flow positive.
   No acquisition at a loss on LTV faith; payback effectively immediate, LTV is upside.
   Enforced as an automated check in Module A once the media-allocation layer lands.
2. **Brand-positioning protection.** No aggressive discounting, no desperate promo
   phrasing. Volume bought by cheapening the premium position is a net loss. Needs a
   written "too aggressive" definition (Module F, Lucas's call — see backlog).
3. **Isolate aggressive-acquisition cohorts from the base** (added 2026-07-22, Lucas).
   Tripwire / aggressive new-customer mechanics — the free-travel-size giveaway, deep
   discount tripwires, buy-X-get-Y loss-leaders — are measured as their own segregated
   cohort. Blended KPIs (AOV, conversion rate, discount depth, first-order margin,
   repeat rate) exclude them by default; each campaign carries its own scorecard judged
   on downstream payback (2nd purchase / hero trial), never first-order AOV or margin.
   Tag every such campaign at creation (discount-code family + order tag + customer tag)
   so Module A can split it out. Precedent: the 699 "pague só o frete" orders already
   excluded by default. Full rule in `gebeauty/growth/CGO-TEAM.md` guardrail 6.

## The module map (what maps to what)

| Module | Role | Home in this repo | Verdict (2026-07-21 assessment) |
|---|---|---|---|
| **A — Attribution & Unit Economics** | measurement spine; true CAC, contribution/order, cohort LTV, floor check | **NEW: `gebeauty/growth/` + `module-a/`; owned by `/growth-analyst`** | Built from scratch (v0 live) |
| **B — Paid Acquisition (Meta/Google/TikTok)** | spend, structure, ramp, incrementality | skill `/growth-hacker` + initiative `gebeauty-paid-media-scale` | Enhance: rewire to net-margin (not MER); add Google branded/non-branded + TikTok protocol |
| **C — Creative pipeline** | still / video / copy production + fatigue tracking + winner library | skills `/creative-producer`, `/video-director`, `/content-director` | Enhance (light): add fatigue-decay tracking + winner library to creative-producer |
| **D — CRO / Landing Pages** | funnel, message match, LP build/audit | skill `/growth-hacker` (LP half) + initiative `landing-page-replication` | Keep → resume the deferred PDP-vs-LP A/B |
| **E — Retention & CRM (Klaviyo/WhatsApp)** | lifecycle, replenishment, win-back, VIP | skill `/crm-director` + initiative `gebeauty-review-repurchase` + engine `gebeauty/retention-machine/` | Enhance: broaden from review+reactivation to full lifecycle architecture |
| **F — Brand Integrity (cross-cutting)** | review gate on B/C/E; the written rulebook | skill `/storefront-agent` (partial) + **NEW rulebook doc (TODO)** | New: one-page "too aggressive" definition (Lucas) |

Build order (from the mandate): **A → B+E in parallel → C → D → F formalized once
patterns emerge.** A first, because it validates the economics everything depends on.

**Team charter + orchestration (2026-07-21).** The full org, roster, guardrails, and
the intake loop live in **`gebeauty/growth/CGO-TEAM.md`** (the onboarding + training
doc). Two connective roles were recruited to make the stack operate as a team across
sessions: **`/growth-office`** (the orchestrator and entry point — intakes a job, gates
it on economics + brand, decomposes across the roster, verifies independently, reports
to Lucas; owns the number) and **`/growth-analyst`** (owns Module A, the scorecard, and
the agency challenge loop). The existing skills (growth-hacker, crm-director,
creative-producer, video-director, content-director, storefront-agent + the
product-developer / integrations-engineer / design-engineer bench) are the specialists,
briefed per job. The external media agency is the execution arm for buying, directed by
growth-hacker and audited by growth-analyst. A job flows: frame → economics gate → brand
gate → decompose+brief → execute → verify in raw data → report (gated actions await Lucas).

## Phases

- [ ] **A. Measurement spine** — IN PROGRESS, owner: cto + lucas
      Module A engine: contribution margin per order from real per-SKU COGS + params.
      v0 DONE (contribution.py, first read below). v1 = media-allocation join +
      branded/non-branded Google + cohort LTV + kit COGS expansion. Gated on the two
      Lucas confirmations (COGS completeness, params) + Google Ads access.
- [ ] **B. Paid acquisition** (parallel with E) — owner: /growth-hacker + lucas
      Re-baseline `gebeauty-paid-media-scale` onto Module A's net-margin numbers
      instead of MER. Fund the underfed prospecting engine, run incrementality before
      the big ramp. See that initiative for the live account state + strategy spine.
- [ ] **E. Retention** (parallel with B) — owner: /crm-director + lucas
      Broaden `gebeauty-review-repurchase` into the full lifecycle (welcome /
      post-purchase / replenishment-timed / win-back / VIP). Replenishment timing (H4)
      is the highest untapped retention lever; WhatsApp (H5) the missing channel.
- [ ] **C. Creative engine** — owner: /creative-producer + /video-director + /content-director
      Concepts-per-week cadence; fatigue-decay tracking; winner library. Feeds B.
- [ ] **D. CRO** — owner: /growth-hacker + cto
      Resume the deferred PDP-vs-LP destination A/B in `landing-page-replication`.
- [ ] **F. Brand integrity** — owner: lucas + /storefront-agent
      Write the one-page brand rulebook (discount depth/frequency limits, forbidden
      framings). Becomes the review gate on B/C/E output.

## Standing cadence (once B/E are live off Module A)

Weekly: read Module A (net margin vs floor, marginal efficiency, cohort trend) →
scale/kill/iterate calls on B → retention wave review on E → creative fatigue check on
C. Monthly: re-baseline. The mandate's §7 plan is provisional until Module A's numbers
land.

## Module A first read (2026-06-21 → 2026-07-21, 3,773 paid orders, giveaway-excluded)

Unit-economics structure CONFIRMED with Lucas 2026-07-21 (see params.json). Model is
% of total revenue = product net + 5% freight revenue. Costs: COGS 22% (per-SKU
calibrated ×1.48 to the real aggregate), tax 12%, payment 3.95%, freight 17%,
fulfillment 3% = 57.95% variable → **42.1% contribution before media**.

- Free travel-size acquisition orders ("pague só o frete") EXCLUDED by default: 699
  orders (15.6% of paid), near-all new customers. A tripwire cohort whose payback is
  the 2nd purchase — measured separately (`--include-giveaway` to see them).
- Blended: product AOV R$209, total-rev/order R$219, contribution 42.1% (~R$92/order).
- New customer: total-rev/order R$214, contribution 41.8% (~R$90/order).
- **10% floor → max allowable CAC ≈ R$68/new order.** At stated ~R$50 CAC, net ≈ 18%
  (modest ~R$18 cushion; marginal CAC rises with scale). This CAC ceiling is the real
  scaling governor — the v1 media layer replaces the stated R$50 with measured
  per-channel CAC and makes the floor a live gate.
- **Reconciles with the BP's 20-25% net-after-media** (42% contribution − ~23% media).
  H2 (first orders near breakeven) is false on variable economics; the real constraint
  is marginal CAC + fixed-cost absorption. Detail: `gebeauty/growth/module-a/README.md`.

## KPI sweep (2026-07-21) — full detail `gebeauty/growth/module-a/KPI-ANALYSIS.md`

Own sweep across Shopify (13mo, 44k orders / 35k customers) + Meta (live) + the model.
- **Acquisition:** Meta 30d spend R$81.9k @ 4.46 ROAS (down from 5.29 as spend ramped
  +38% — diminishing returns, live). 96% prospecting. Paid CAC ~R$49 vs R$68 ceiling →
  clears the floor at ~19% net-after-media, but cushion is ~R$19/order and eroding.
  **Payback is immediate** (first-order contribution R$90 > CAC R$49); H2 resolved.
- **Retention:** repeat rate **15.8%** (84% one-and-done), time-to-2nd median **63d**,
  returning revenue 22.2%, mature 12-mo contribution LTV **R$169**, LTV:CAC 3.4 (paid) /
  6.0 (blended). Retention is the biggest untapped lever.
- **Reallocation:** ~R$25k/30d (30% of spend) in sub-breakeven Primer creative tests
  while 7+ ROAS winners (Validados, review) are starved <R$2k.
- **Three next moves:** (1) incrementality test BEFORE the big ramp (marginal CAC is
  the governor); (2) replenishment flow at day ~45-60 (Module E, zero-discount, highest
  ROI); (3) reallocate off sub-breakeven tests to starved winners before adding budget.
- Caveats: LTV/repeat are all-channel (incl. retail POS); paid CAC is Meta-attributed
  estimate pending the v1 media/UTM join; cohort LTV not yet giveaway-excluded.

## Agency challenge loop (Module B operating mechanism)

Paid buying is run by an external agency (a good partner — coordinate, don't replace).
Our role is the independent challenge-and-accountability layer: we hold our own Meta
access + the margin model, so we scrutinize their work against independent data, hand
them a constructive punch-list, then verify in the data whether they acted and map the
result. Living tracker: `gebeauty/growth/module-a/agency-challenge-register.md`.
Biweekly cycle: challenge → prompt → validate (independent re-pull) → follow-up → map.
Cycle 0 findings seeded (F1 sub-breakeven tests bleeding ~R$10k/30d · F2 winners
starved · F3 free Opp-Score lifts · F4 auction fragmentation · F5 destination leaks ·
F6 ramping into diminishing ROAS · F7 Liso conversion leak).

## Data access / blockers

- **Have:** Shopify (token in `gebeauty/.env`, works), Meta Ads (meta-ads MCP, live).
- **Need:** Google Ads (branded/non-branded split — mandate H1), Klaviyo (retention
  performance), Omie/ERP for cost confirmation. No local tooling for Google/Klaviyo yet.
- **Auth-gated MCPs** (interactive session only): claude.ai MCP GE Beauty, Magnific,
  Slack, foreplay.
- **Money calls for Lucas:** confirm cost-basis completeness; confirm params (tax rate
  is the biggest lever); write the Module F brand rulebook.

## Backlog (not scheduled)

- Module F brand rulebook (one page, Lucas).
- **Connect Google Ads to the stack (API-first) — SCRIPTS BUILT 2026-07-22, pending creds.**
  `gebeauty/growth/module-a/google_ads_auth.py` (one-time refresh-token minter, reuses the
  Desktop OAuth client `gebeauty/scripts/google_oauth_credentials.json`, project
  `ge-beauty-copilot`) + `google_ads_fetch.py` (REST+urllib, GAQL campaign + search_term_view
  -> spend/ROAS + branded-vs-non-branded split, H1; creds in `gebeauty/.env`). Read-only.
  STILL NEEDS (external): (1) developer token from the Ads API Center on an MCC with access;
  (2) agency grants our Google user read access + the 10-digit customer id; (3) run
  google_ads_auth.py to mint the refresh token; (4) confirm GOOGLE_ADS_API_VERSION before
  first run. Official read-only Google Ads MCP is the fallback/ad-hoc option. Bridge:
  agency 90-day search-term CSV answers H1 now. Owner /integrations-engineer, consumed by /growth-analyst.
- **Connect TikTok Ads to the stack (API-first, MCP fallback).** TikTok Marketing API pull
  (spend/ROAS/conversions); MCP only if no API path. Low priority until TikTok spend justifies
  it (early-stage per the mandate). Same owner split.
- Klaviyo: DONE (`KLAVIYO_API_KEY` in `gebeauty/.env`; Module A can read email performance).
- Kit/bundle COGS expansion (component-level, closes the ~5.5% uncosted gap).
- Post-purchase "how did you hear about us" survey (near-zero-cost brand-awareness baseline).

## Done means

Module A produces a trustworthy margin-true, media-allocated read where every channel
shows real net contribution per order against the 10% floor; B and E run off those
numbers on a weekly cadence; creative ships on a cadence with fatigue tracking; the LP
A/B has a verdict; and the brand rulebook gates all outbound. Growth is materially
above the 2026-07 baseline with every channel clearing the floor.
