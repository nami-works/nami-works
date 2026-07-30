# Session Handoff — 2026-07-30

Primary area: **GE Beauty MIST · TESTE paid-acquisition campaign** (the rebuild of the paused "leaking hose" test), plus the attribution fix, the PT hook-curation artifact, and one CLAUDE.md rule. Session work is moving to **Cowork** — this handoff is the bridge.

## What was done

**MIST campaign rebuild + launch (Meta Ads, in-house API build)**
- Diagnosed the paused bleeder (`ROAS 0.28`): broad unseeded audience, optimizing ATC-at-scale, no buyer exclusion, no kill switch, R$2.5k on a single ad set. Root failure: 1.1% ATC→purchase vs the account's 14-19%.
- Rebuilt as a **test→scale** structure and **launched LIVE** (T1 first, then T2): an ABO test ad set optimizing ATC, ranked on leading indicators, with two audience cells:
  - **T1 = GE buyer-lookalike** (no interest layering).
  - **T2 = premium-fragrance interests** (A-tier fragrance brands, explicitly NOT mass-tier Natura/Boticário/Avon).
- **Buyer exclusion pulled from 30D → Purchase-45D.** Geo = Brazil only.
- Creatives drive to **existing scent PDPs** (not a bespoke LP): "creatives are bait, we fish for AOV in-site" — solo mist can't clear the 10% net floor (CAC ceiling R$33-48 < achievable R$49), but mist sells as a basket (56% baskets, AOV R$352).
- Fixed a Meta **location deprecation (#1870194)** that blocked publish — Lucas remove+re-added Brazil in the UI (`location_types` went `home` → `home,recent`).

**Attribution defect fixed (static UTMs)**
- Meta dynamic `{{macros}}` (`{{campaign.name}}|{{campaign.id}}`, etc.) **do NOT resolve on reused SHARE / dark-post creatives** — one Shopify order carried the literal `{{campaign.name}}` string.
- Replaced with **static per-ad UTMs** that also encompass **Nemu's** params (Nemu keys on `utm_source=facebook` + name|id; golden rule: **no pipe `|` inside names**).
- Editing `url_tags` on a live ad **force-pauses it** — applied via **edit-then-reactivate** (Lucas approved "Option 1"). End state independently verified: **all 54 ads ACTIVE, static tags, 0 paused.**

**Docs + artifact + rule (shipped via PR #79, merged to main `d94e4ef`)**
- `gebeauty/growth/campaigns/mist-launch/rebuild-spec.md` — the durable build/launch record (architecture, T1/T2, 45D exclusion, Nemu static-tag decision, launch log, day-3/day-7 watch gates). **Read this first — it's the source of truth.**
- `gebeauty/growth/campaigns/mist-launch/poda-hooks-mist.html` — shareable **Portuguese** artifact of the per-scent hook curation ("ajuste"), with a top summary of assets-to-add and a full-download button. Published: https://claude.ai/code/artifact/f1997056-dd77-4340-b85c-14bb443e509e
- `gebeauty/CLAUDE.md` — one rule: **PT output must be idiomatic Brazilian Portuguese, never a literal calque; ask when unsure.** (Rationale + canonical mappings live in memory `feedback_pt_no_english_calques` — don't restate.)

## Key decisions

- **In-house API build, not the agency.** Lucas pushed back on routing the rebuild to CheckCommerce; the correct instinct was to build it ourselves via the meta-ads MCP.
- **LAL vs fragrance-interest as the two cells** — a clean read on whether GE's own buyer signal beats broad premium-fragrance interest.
- **Static UTMs over macros** — macros are unreliable on dark posts; static tags are the only trustworthy attribution path, and they must carry Nemu's params too.
- **No conversion verdict yet, on purpose.** At last read ~R$674 spent / 128 ATCs / **0 attributed orders**, but the clean-tag window was only hours-to-~1-day old and delivery had just recovered post-fix. **0 orders in a throttled short window = absence of data, not a signal.** Hold the scale/kill call for a real multi-day clean-data window (the day-3 / day-7 gates in rebuild-spec.md).
- Mist is thriving overall (~60 orders / ~R$13.7k in the window) but via **direct/untracked + agency campaigns**, not our cold test — don't confuse the two.

## What's pending

- **Monitor the MIST test to a real verdict.** First order tagged with the **resolved** `MIST-TESTE` campaign (not a literal `{{macro}}`) = proof the fix works AND the first true conversion. Evaluate against the day-3 / day-7 gates in rebuild-spec.md.
- **Produce the missing creative.** 3 fill hooks + 2 challengers are specified in the artifact but not built: Canva → 3-point QA gate → set metaobjects/creatives ACTIVE. Route through `/creative-producer` (copy is approved; it does not write copy).
- **`mist-rebuild-defense.html`** (in `gebeauty/growth/campaigns/mist-launch/`, currently **untracked**) — the defense one-pager. Lucas called it "for my eyes only," so it was deliberately **not committed**. Decision needed: commit it as a record, or leave it local. Published (private): https://claude.ai/code/artifact/d687cb6a-33fc-468d-8f6c-13ec57a28f96
- **CheckCommerce GB-1002 cancel** — a Gmail **draft** exists (to erico@checkstore.com.br, cc cicero@…, subject "Check MCP | Cancelar chamado criado por engano (GB-1002)", with an AI-written/not-reviewed transparency note). The Gmail MCP has **no send tool** — Lucas must send it manually.

## Modified files

- `gebeauty/growth/campaigns/mist-launch/rebuild-spec.md` — **complete** (on main via #79).
- `gebeauty/growth/campaigns/mist-launch/poda-hooks-mist.html` — **complete** (on main via #79).
- `gebeauty/CLAUDE.md` — **complete** (PT rule, on main via #79).
- `gebeauty/growth/campaigns/mist-launch/mist-rebuild-defense.html` — **in progress / decision pending** (untracked, eyes-only).
- `<scratchpad>/mist_paid_cohort.py` — **cleanup** (temp Shopify order/UTM cohort probe; scratchpad only, not for repo).

## Current state

- **Meta:** MIST · TESTE campaign LIVE, 54 ads ACTIVE, static UTM tags, 0 paused. Verify via meta-ads MCP `ads_get_ad_entities` + `ads_entity_get_report`.
- **Attribution:** verify in Nemu (`mcp e9c3f1d1…` → `campaigns-get-facebook`, `utm-get`) and Shopify (`customerJourneySummary.lastVisit.utmParameters`). Look for **resolved** `MIST-TESTE` tags, not literal `{{campaign…}}`.
- The cohort-probe script (in scratchpad) filters store orders since 2026-07-28 into: all-facebook, our-MIST-cohort (resolved vs unresolved-macro split), and mist-product orders. Re-runnable with `gebeauty/.env`.
- PR #79 is **merged**; main = `d94e4ef` (then `d12c471` on top from another session).

## Recommended next steps

1. **Read `gebeauty/growth/campaigns/mist-launch/rebuild-spec.md`** — full build/launch record; don't re-derive.
2. **Pull the current MIST read** (Meta spend/ATC/ROAS + Nemu/Shopify resolved-tag orders) and check it against the day-3 gate. Only then make a scale/iterate/kill call.
3. Decide `mist-rebuild-defense.html`: commit or leave local.
4. If green enough to keep feeding: brief `/creative-producer` on the 3 fill hooks + 2 challengers.

## Context the next session needs

- **Shared working tree churn.** This repo is one working copy driven by several concurrent sessions; the checkout branch and index change under you (this session's HEAD moved from `feat/cd-extrema-delay-tagging` → `docs/handoff-legal-retail-contracts-cowork` mid-session). **Never inherit another session's branch/index.** To land docs on `main` without disrupting the shared tree, this session used a **detached worktree off `origin/main`** + a Windows **junction to the main tree's `node_modules`** (so the pre-commit typecheck gate passes), committed there, pushed `HEAD:main`, then removed the junction *before* removing the worktree (a plain `git worktree remove` would recurse the junction and wipe the real `node_modules`). Reuse this pattern.
- **Meta macro trap:** `{{...}}` URL macros silently fail on reused/dark-post creatives → always static UTMs for attribution-critical ads. Editing `url_tags` force-pauses a live ad → edit-then-reactivate.
- **Nemu golden rule:** no pipe `|` inside campaign/ad names, or attribution keying breaks.
- **Economics guardrail:** solo-mist can't clear the 10% net floor; the test is justified only as a basket/AOV play in-site. Judge it on downstream basket value, not solo-unit ROAS (CGO guardrail 6: aggressive-acquisition cohorts are isolated from blended KPIs).
- Prefer reading Shopify **directly** via `gebeauty/.env` (API 2026-01) over the connector for growth reads — more reliable.
