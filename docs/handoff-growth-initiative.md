# Session Handoff — 2026-07-30 — GE Beauty Growth initiative (→ Cowork)

**Scope:** the GE Beauty growth measurement & attribution-integrity workstream. Moving to Cowork.
This handoff is written to be **self-contained** — a Cowork session on another machine will NOT have
this machine's `~/.claude` memory files, so everything load-bearing is either restated here or points
to a **committed repo file** (which Cowork gets on `git pull`). Memory pointers are listed but treated
as optional context, not prerequisites.

**⚠️ FIRST THING TO DO (Lucas's explicit instruction):** before deleting this handoff, **create an
initiative file** so the Growth work has a durable home above the PR layer. See "Recommended next
steps" #0 — do that first, then delete this handoff.

---

## What was done this session

**1. Unified two prior handoffs into one growth session.** Picked up `growth_watchdog` (UTM bio-link
contamination investigation) and `growth_team` (measurement stack) from `docs/_handoff-log.md`; deleted
both their handoff files; this session now owns the whole growth measurement thread.

**2. Baked the Nemu UTM guide into the growth stack.** Lucas pointed to Nemu's onboarding docs
(`https://docs.nemu.com.br/pages/onboarding/configuracao-utms` + platform sub-pages). Distilled them
into a canonical, GE-applied playbook:
- **NEW file (committed, `ec4d1c6`): `gebeauty/growth/references/utm-conventions.md`** — how Nemu reads
  links (`nemu_*` first, `utm_*` fallback), the `utm_medium = cpc(paid) / organic` switch, the pipe
  `|name|id` separator rule, verbatim per-channel templates (Meta/Google/organic/influencer), a case
  study, and a reconciliation checklist.
- Updated `gebeauty/growth/knowledge.md` (Measurement stack section) with a pointer + the key rules.

**3. Investigated and RESOLVED the "UTM contamination" claim — it was a FALSE POSITIVE.**
- The `growth_watchdog` handoff claimed the Instagram bio-link (`linklist_26092025`) was leaking paid
  Meta markers onto organic clicks (order #89360 etc.), with inflated exposure numbers
  (68 / 1,183 / 3,544 / 4,795 orders floating around). I inherited that framing and initially relayed
  it to Lucas as a real, live leak. **That was wrong.**
- Ran a **full 12-month per-visit scan** of Shopify orders via `customerJourneySummary`
  (2025-07-28 → 2026-07-27): **46,915 orders scanned, 19,888 with journey data.**
- **Result: 0 contaminated orders** — before OR after any fix. Not one order where a *single* organic
  bio-link visit carried a paid `utm_term` / ad-id / campaign-id.
- Order #89360 is a normal **multi-touch journey**: 3 clean paid Meta visits (`medium=cpc`, `name|id`)
  + 1 clean organic bio-link visit (`medium=link-na-bio`, `term=null`). The paid and organic markers
  sit on **different visits**, not one URL. The watchdog read order-level UTM co-occurrence as a single
  leaked URL — that's the bug in the analysis.
- **1,349** of 2,634 bio-link orders were multi-touch (bio touch + paid touch, R$289k) — that overlap
  is what the old scan inflated into "contamination."
- Corrected the record in the reference doc, `knowledge.md`, and memory (commit `07a7a81`).

**4. Surfaced the REAL finding — Instagram `utm_medium` sprawl (open work).** The scan showed
Instagram-source traffic is tagged with a chaotic mix of mediums: influencer names used as the medium
(`Beta W` ×68, `Myra Ruiz`, `fiorella mattheis`, `Jordanna`…), inconsistent casing
(`STORIES`/`reels`/`reels-de-teste`), paid-ish labels (`paid`, `paid_social`, `cco`, `geb`) alongside
the dominant clean `link-na-bio` (6,237 visits). **This**, not a leak, is what actually muddies the
organic/influencer/paid split in Nemu. It is the top open item.

**5. Lucas manually "fixed" the bio link** (2026-07-27) — standardized it to `utm_medium=organic`.
Since nothing was leaking it corrected no misattribution, but it aligns with Nemu's organic convention,
so it's a harmless hygiene change. No harm done.

---

## Measurement stack — current state (from `growth_team`, still accurate)

Doctrine: **no single tool is truth — triangulate.** Full detail in `gebeauty/growth/knowledge.md` →
"Measurement stack". Layers:

- **LIVE — Nemu (cockpit + Brazil/PIX signal + MTA).** `claude.ai Nemu` MCP, dashboard "Atribuição
  geral" id 4967, ~12mo history. Brazil-native (PIX/boleto aware), 9 attribution models, reconciles ad
  claims to real store revenue. Replaces the plan to buy Triple Whale. Default model = first-click.
  **It is MTA (correlational), NOT causal.**
- **LIVE — Module A (margin-true profit spine).** `gebeauty/growth/module-a/`. The 10% net floor is
  judged here, never by Nemu's rosy ~64% (which excludes COGS/freight/fulfillment/Boniteca).
- **LIVE — independent platform pulls.** meta-ads MCP + `module-a/google_ads_fetch.py` (Google Ads
  API v21, committed `303e53a` in a prior session). Cross-check Nemu + audit the agency.
- **MEASURED fact:** PIX = ~31.6% of revenue / ~36.8% of orders (30d, 2026-07-27) — the async-payment
  signal ad pixels under-see; the *opposite* error to the Google harvester.
- **TO BUILD — causal calibration layer** (the big gap). See pending #2.

---

## Key decisions (with the why — don't re-litigate)

- **UTM co-occurrence must be checked PER VISIT, never at order level.** Shopify multi-touch journeys
  legitimately carry paid + organic UTMs on *different* visits of the same order. Reading order-level
  co-occurrence as a single leaked URL is exactly what produced the false-positive contamination.
- **Nemu's paid Meta template deliberately uses `{{name}}|{{id}}` with pipes** — the `|` is Nemu's
  name↔id separator. So paid Meta orders legitimately carry `utm_term=<adset>|<adset_id>` + a campaign
  id. That signature is correct **only on a paid click**. The one thing Nemu forbids: a `|` *inside* a
  campaign/ad name (breaks the split).
- **`utm_medium` is the paid(`cpc`)/organic(`organic`) switch** and the #1 attribution-quality lever.
- **Nemu = cockpit, Module A = profit truth.** Never judge the 10% floor by Nemu's margin.
- **Discard the old contamination numbers** (68 / 1,183 / 3,544 / 4,795) — inflated OR'd counts.

---

## What's pending — the Growth initiative's open work

0. **Create the initiative file** (see Recommended next steps #0). Do this before deleting the handoff.
1. **Instagram `utm_medium` sprawl cleanup — TOP ITEM.** Profile the full source/medium breakdown with
   orders + revenue per bucket (how much organic vs influencer revenue is currently mislabeled), then
   hand the agency/social team a single tagging standard enforced **at the link-builder source** (bio
   tool, influencer link builder, Stories/Reels swipe-ups). The playbook to enforce is
   `gebeauty/growth/references/utm-conventions.md`. (I offered to run this profiling; Lucas hadn't
   greenlit it when the session pivoted.)
2. **Brand-search GeoLift test — highest-value causal experiment.** Pause `[SEARCH] MARCA` in matched
   regions, measure surviving sales, to settle the Google-harvester concern (branded search ≈41% of
   Google spend manufacturing a 10.1x ROAS). Tools: GeoLift by Recast (~$100/mo, 6mo free) +
   self-hosted Google Meridian + Meta Conversion Lift (`ads_experiment_lift_create_test` exists in the
   meta-ads MCP).
3. **Ask the Nemu team one question:** does Nemu forward recovered PIX conversions server-side (CAPI)
   to Meta/Google, or only report? If report-only, an Elevar-style CAPI layer adds delivery value.
4. **Deeper Nemu mining** (cheap, unused): influencers-by-coupon (~30 affiliate `{NAME}10` codes),
   creatives, basket, competitor Meta ads, per-channel reconciliation vs our own pulls.
5. **Confirm GE's paid Meta + Google accounts actually carry the Nemu templates** (paid-side
   completeness — separate from the organic hygiene item).

---

## Modified files (all COMPLETE + committed to `origin/main`)

- `gebeauty/growth/references/utm-conventions.md` — **complete** (new). Commits `ec4d1c6` → `07a7a81`.
- `gebeauty/growth/knowledge.md` — **complete**, Measurement stack section extended.
- `docs/_handoff-log.md` — growth_watchdog + growth_team blocks removed (log upkeep).
- This handoff — `docs/handoff-growth-initiative.md`.
- **Memory (per-machine, NOT in Cowork):** `project_gebeauty_measurement_stack.md` updated with the
  false-positive correction + the sprawl finding.
- **NOT mine — leave alone:** `.claude/initiatives/gebeauty-acquisition-rescue.md` (1 M) + ~61 `??`
  files (other sessions' handoffs/scripts). Do not stage or commit them.

**Scaffolding (cleanup / already ephemeral):** the scan scripts (`utm_scan.py`, `utm_probe*.py`) live
ONLY in this session's scratchpad (`...\scratchpad\`), **not in the repo** — a Cowork session will not
find them and should not need them (the result numbers are captured above and in the reference doc). If
the sprawl profiling (#1) is run, re-author a fresh scan; the query shape is in "Context" below.

---

## Current state / how to verify

- All growth artifacts are on `origin/main` (commits `ec4d1c6`, `2481e80`, `07a7a81`). Verify with
  `git log --oneline -- gebeauty/growth/references/utm-conventions.md`.
- The measurement doctrine + numbers live in `gebeauty/growth/knowledge.md` (committed) — the durable
  source of truth once this handoff is gone.
- Nemu is live: verify via the Nemu MCP `dashboard-get-info` (should return id 4967).
- Shopify creds for any re-scan: `gebeauty/.env` (`SHOPIFY_ADMIN_ACCESS_TOKEN`, domain
  `ge-beauty-cosmeticos.myshopify.com`, API `2026-01`). Python: `C:/Python314/python.exe`.

---

## Recommended next steps (priority order)

**0. FIRST — create the Growth initiative file (Lucas's explicit ask).** Before deleting this handoff,
create `.claude/initiatives/growth-measurement-stack.md` (schema + conventions in
`.claude/initiatives/README.md`). It should capture: the triangulation doctrine, the three live layers
(Nemu / Module A / platform pulls), the open phases (sprawl cleanup → GeoLift causal test → CAPI Q →
deeper mining), the current blocker, and who picks up next. This is the durable Kanban-layer home; the
handoff is ephemeral and disappears after ingestion. Point it at `gebeauty/growth/knowledge.md` and
`gebeauty/growth/references/utm-conventions.md` as the detail files. (Note: an adjacent initiative
`.claude/initiatives/gebeauty-acquisition-rescue.md` already exists — keep this one distinct: that's
the rescue campaign, this is the measurement/attribution spine.)

1. Run the Instagram `utm_medium` sprawl profiling (pending #1) — the concrete, in-flight next task.
2. Design the brand-search GeoLift test (pending #2) — highest-value causal experiment.
3. Ask Nemu the CAPI-forwarding question (pending #3).

---

## Context the next session needs

- **Cowork has no `~/.claude` memory.** Rely on the committed files: `gebeauty/growth/knowledge.md`
  (office memory), `gebeauty/growth/references/utm-conventions.md` (UTM playbook),
  `gebeauty/growth/CGO-TEAM.md` (roster/charter), `gebeauty/growth/module-a/` (unit economics). The
  memory files below are this-machine-only bonus context: `gebeauty-measurement-stack`,
  `project_gebeauty_google_ads_harvester`, `project_gebeauty_chief_growth_office`.
- **The re-scan query shape** (if profiling sprawl or re-verifying): Shopify GraphQL
  `orders(query:"created_at:>=…", sortKey:CREATED_AT){ … customerJourneySummary{ momentsCount{count}
  firstVisit{ source utmParameters{source medium campaign content term} } lastVisit{…}
  moments(first:20){ nodes{ ... on CustomerVisit{ source utmParameters{…} } } } } }`. Gotchas that cost
  time: `momentsCount` needs `{count}`, and `moments` nodes are the `CustomerMoment` interface so you
  need `nodes{ ... on CustomerVisit{ … } }` (not a bare fragment). `utmParameters` only exposes
  source/medium/campaign/content/term — `utm_id` is NOT surfaced there (it lives only in the raw
  landing-page query string), which is partly why the original order-level analysis went wrong. Page
  size 100 was fine (no throttling); full 46,915-order scan took ~9 min — run it in the background, not
  a foreground shell that can time out, and NOT via a sub-agent (sub-agents can't reliably read back
  their own background tasks).
- **Two separate attribution-integrity issues are live**, don't conflate them: (a) the Google
  brand-search **harvester** (inflates ROAS — needs the GeoLift test), (b) the UTM **medium sprawl**
  (muddies organic/influencer/paid — needs tagging discipline). The bio-link "contamination" was a
  third, now-closed FALSE alarm.
- **Meta ad account:** `606199920079315` ("GE_Beauty", BRL) is the one actually spending; other
  read-only accounts under business `221767282502823` are for integrations — don't confuse them.
- **In-flight repo change (unrelated to growth, but you'll see it):** Lucas is moving the repo off its
  custom git conventions (two-tier discipline / commit-then-push / direct-main) toward Claude default
  branch+PR conventions. That cleanup was interrupted mid-session and is NOT finished — the CLAUDE.md
  "Session start" git section and the `feedback_two_tier_discipline` / `feedback_commit_then_push` /
  `feedback_branch_autonomy` memories were flagged for removal but not yet removed. Don't rely on either
  the old or new convention being fully in force; confirm with Lucas.
- **This session started on inherited branch `legal/studio-plural-close`** (identical tree to `main`);
  the handoff was committed to `main` per the established Cowork-handoff pattern, then HEAD restored.
