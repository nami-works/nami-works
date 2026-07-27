# Session Handoff — 2026-07-27

Topic: **GE Beauty CGO — measurement & attribution stack.** Continues on Claude Code Desktop.
Same machine → memory (`~/.claude/projects/c--claude/memory/`) and the `c:\claude` repo transfer
automatically. This file bridges the *conversation* state that doesn't.

## What was done
- **Google Ads connection — DONE & COMMITTED** (`main` commit `303e53a`). Fixed the 404 (`API_VERSION`
  v18→**v21**; v18/v19 retired, v20 deprecated) + added HTTP-error-body printing in
  `module-a/google_ads_fetch.py`. First live pull answered **H1: Google is a HARVESTER** — blended
  6.6x ROAS is manufactured (branded `[SEARCH] MARCA` = 41% of spend at 10.1x; true non-branded only
  ~R$4k at 2.8x). Logged in `knowledge.md` + memory `project_gebeauty_google_ads_harvester.md`.
- **Measurement-tooling research + pitch** (conversation). Landed on doctrine **"triangulate — no single
  tool is truth"** and a **cockpit + calibration** architecture. Reviewed Elevar, Triple Whale,
  Northbeam, Polar, KnoCommerce/Fairing, GeoLift by Recast, Google Meridian, Meta Robyn. Delivered an
  honest TW-vs-Northbeam-vs-composite comparison and an MTA primer (MTA = credit-splitting/correlational;
  only incrementality is causal).
- **Nemu MCP connected + introspected with live data.** Confirmed dashboard "Atribuição geral" (id 4967,
  ~12mo). Pulled 30d analytics. **This is the session's biggest new artifact** — see knowledge.md.
- **Persisted durably** (so this handoff can be deleted safely): new "Measurement stack" section in
  `gebeauty/growth/knowledge.md`; new memory `project_gebeauty_measurement_stack.md` + MEMORY.md pointer.

## Key decisions
- **Nemu = the cockpit; it replaces the earlier plan to buy Triple Whale.** Reason: it's Brazil-native
  (PIX/boleto + Tray/Nuvemshop/Yampi), reconciles ad claims to real store revenue, and is already live.
  US dashboards (TW/Northbeam) are PIX-blind — near-disqualifying for a BR brand.
- **Module A stays the margin-true profit spine.** Nemu's "63.8% margin" excludes COGS/freight/
  fulfillment/Boniteca — it's revenue − ad spend − tax only. The 10% net floor is judged by Module A, never Nemu.
- **Causal layer is still required and unbuilt.** Nemu is MTA (first-click default), NOT causal —
  it would still crown branded Google. Enterprise MMM/attribution SaaS (Northbeam, Recast-full, Haus,
  Measured) ruled out as overkill at ~R$115k/mo spend.

## What's pending
- **Build the causal calibration layer** (highest-value open item): **brand-search GeoLift test** to
  settle the Google harvester concern (pause `[SEARCH] MARCA` in matched regions, measure surviving
  sales). Tools: GeoLift by Recast (~$100/mo, 6mo free) + self-hosted Google Meridian + Meta Conversion
  Lift (`ads_experiment_lift_create_test` exists in the meta-ads MCP).
- **Ask the Nemu team one question:** does Nemu forward recovered PIX conversions server-side (CAPI) to
  Meta/Google, or only report? If report-only, an Elevar-style CAPI layer still adds delivery value.
- **Deeper Nemu mining not yet done:** influencers-by-coupon (our ~30 affiliate codes), creatives,
  basket, competitor Meta ads, per-channel campaign attribution reconciliation vs our own pulls.

## Modified files
- `gebeauty/growth/knowledge.md` — **complete**, new "Measurement stack" section (committed this session).
- `~/.claude/.../memory/project_gebeauty_measurement_stack.md` + `MEMORY.md` — **complete** (per-machine, not committed).
- `gebeauty/growth/module-a/google_ads_fetch.py`, `.gitignore` — **complete**, already on `main` (`303e53a`).
- NOT mine (leave alone): `.claude/initiatives/gebeauty-acquisition-rescue.md`, `gebeauty/legal/pending.md`
  (2 M) + ~43 ?? — belong to other sessions.

## Current state
- Nemu is live and authorized. Verify with `dashboard-get-info` (should return id 4967) or a 30d
  `dashboard-get-analytics` pull. Query envelopes are quirky — use the JSONata `jsonata:` arg; the tool
  descriptions carry a full path/anti-pattern guide (payment split lives at `data.data.{pix,credit,billet,other}`).
- **Measured PIX fact (30d):** PIX = 31.6% of revenue / 36.8% of orders. Card 58.7%/42.6%; "other"
  9.7%/20.6%; boleto 0. This is the size of the ad-pixel signal gap Nemu closes.
- Google Ads pull works: `python gebeauty/growth/module-a/google_ads_fetch.py --days 30` (v21).

## Recommended next steps (priority order)
1. **Design the brand-search GeoLift test** — closes the harvester concern; the single highest-value experiment.
2. Ask Nemu team the CAPI-forwarding question (gates whether we also need Elevar).
3. Optionally mine Nemu deeper (affiliate/coupon attribution, creative analytics) now that it's wired.
4. Consider folding the measurement stack into a proper initiative file if it grows beyond knowledge.md.

## Context the next session needs
- **Two opposite measurement errors coexist:** Google harvesting *inflates* apparent ROAS; PIX-blindness
  *deflates* it. They partly offset — which is exactly why raw platform numbers can't be trusted either way.
- **Nemu spend numbers cross-validated our independent Meta+Google pulls exactly** (R$115.9k total) — good
  reason to trust its data plumbing, but its *attribution* is still correlational and its *profit* is not margin-true.
- **CGO context:** Claude is CGO/CTO owning the growth number; the media agency is the audited execution arm.
  Roster/charter in `gebeauty/growth/CGO-TEAM.md`; office memory in `gebeauty/growth/knowledge.md`; unit
  economics in `gebeauty/growth/module-a/`. Memory: `project_gebeauty_chief_growth_office.md`,
  `project_gebeauty_measurement_stack.md`, `project_gebeauty_google_ads_harvester.md`.
- **Delivery economics are UNDER REVISION** (new fulfiller) — gates net-margin work in Module A.
