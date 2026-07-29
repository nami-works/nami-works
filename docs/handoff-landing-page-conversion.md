# Session Handoff — 2026-07-16

**Primary area:** GE Beauty paid-ad conversion via message-matched landing pages (initiative `landing-page-replication`). Long session; growth/LP is the through-line.

## What was done
- **Both LPs are live + fully dynamic** — `/pages/primer-cachos-definidos` and `/pages/primer-liso-intacto` (theme `181379236160`, template `page.landing-page.json`, metafield-driven). This session's LP polish, all live:
  - **Loox star rating** added to the featured-product buy card — LP-scoped `custom_liquid` block using `{{ section.settings.product… }}` (renders on both LPs), positioned **below the benefit icons, right before the buy button**. The Loox **trust-badge block was removed** from that section to decouple the two (Lucas: "stars should not be connected to the trust badge").
  - **Button "dent" fix** — buy + freight buttons had a fill radius (4px) mismatched with their `::after` ring (40px pill) → transparent corner crescent; fixed fill to `var(--buttons-radius)`.
  - **image-with-text beige cards** (problem/solution) with mobile + desktop full-bleed image; **homepage standalone card price hidden** via `:has(.gb-card-price)`; **CEP/zip field** rounded to the 40px pill; **featured-product `image_zoom` set to `none`** (kill click-to-zoom).
  - **Icon transparency sweep** — 13 opaque benefit icons → transparent versions created + 30 product `custom.imagem_beneficio_em_destaque_N` refs swapped (mapping in the agent's `REPORT.json`; script `_swap_benefit_icons_transparent.py`).
- **Theme-customization playbook created** — `docs/gebeauty-theme-customization.md` + a "read this first" trigger in `sandbox/gebeauty/CLAUDE.md` + a `MEMORY.md` pointer. Two rule-memories: `reference_shopify_dynamic_sources`, `reference_gebeauty_theme_publish_role`.
- **PDP-vs-LP A/B fully designed (BUILD DEFERRED)** — recorded in the initiative under `## PDP-vs-LP destination A/B`. Read-only Meta recon done: account **`606199920079315`** (GE_Beauty, BRL); all live Cachos/Liso ads point to PDPs, none to LPs (via Foreplay, brand `teAkgOSykZ4SbTvRO1Zm`); 2 misdirected ad groups flagged (homepage + `/pages/indique-e-ganhe`); a full **funnel-integrity threat map** produced.
- **Desktop-legacy reconcile done** — work order `2026-07-15-desktop-legacy-landing-page-replication-reconcile` → **done**. Grafted Desktop's newer travel-size note into `/c/claude`'s initiative (path-normalized); verified 0 content diffs; Desktop copy safe to discard.

## Key decisions
- **PDP-vs-LP A/B is per-product, NOT product-vs-product.** Each product tests its own "LP beats PDP?" hypothesis, in parallel. Use a **fresh Advantage+/CBO test structure** (mirror Liso's clean setup; NOT Cachos's noisy manual ABO), **reuse existing top-3 creatives**, **don't edit the always-on ads** (resets learning/dirties read), optimize on **Purchase**, judge on **CVR + CPA + ROAS** (weight CPA — Cachos R$149 vs Liso R$139), ~50 conv/arm (~2–3 wks). Nothing built on Meta — all read-only, no campaign draft exists.
- **Theme edits: verify `role == main` first.** CheckCommerce's "badge cache bust" republishes a duplicate and can swap the live theme mid-session (it stranded/clobbered edits earlier). Theme work uses the **direct Admin API via `sandbox/gebeauty/.env` token**, not the GE Beauty MCP.
- **Loox rating** kept LP-scoped (not a theme-wide `featured-product.liquid` edit) so it doesn't affect other featured-product usages.

## What's pending
- **PDP-vs-LP A/B build** — deferred by Lucas. Resume needs: his go + budget/creatives confirm + **prereqs**: verify Purchase pixel/CAPI fire for LP-origin (`/pages/`) sessions, add UTMs, pick a stable window, freeze the LPs. Then build **2 paused** test campaigns.
- **Funnel-integrity verification pass** (offered, not run) — render PDP vs LP, diff apps/sections/pixel events, trace CTA flows, CWV snapshot. Do this BEFORE the A/B. Biggest threats: CTA-flow mismatch (LP hero/close use `/cart/<variant>:1` → checkout; PDP uses standard add), pixel event parity on `/pages/`, app/section parity, coupon+UTM preservation, CWV parity.
- **2 misdirected ad groups** (product ads → homepage; "buy now" ads → `/pages/indique-e-ganhe`) — Lucas said **leave for now**.
- **Drawer-vs-checkout CTA A/B** — separate experiment, on the initiative **backlog**.
- Fernanda footage rights (Cachos hero), CWV pass, publish gate/ad-repoint — initiative phases 3–5.

## Modified files
- `.claude/initiatives/landing-page-replication.md` — reconciled superset (**complete**). NOTE: git showed it *unmodified* on `/c/claude` — verify it actually carries this session's edits before trusting it.
- `docs/gebeauty-theme-customization.md`, `sandbox/gebeauty/CLAUDE.md` (theme trigger + verify-main), `sandbox/gebeauty/scripts/_*.py` — **created/edited on the DESKTOP working tree this session** (`c:\Users\Lucas Guimarães\Desktop\nami-works\…`). ⚠️ If Desktop is being retired, **reconcile these into `/c/claude`** or they'll be lost.
- Shopify (not git): theme `181379236160` assets (`buy-buttons.liquid`, `card-product.liquid`, `base.css`, `templates/page.landing-page.json`); product + page metafields.
- Memory (per-machine): `reference_shopify_dynamic_sources`, `reference_gebeauty_theme_publish_role`, `project_checkcommerce_trial` (badge-cache-bust feedback).

## Current state
- Both LPs render live. Hard-refresh (Ctrl+Shift+R) — cache is aggressive; theme-asset `?v=` bumps on PUT but the page cache serves stale on bare URLs (use a random `?cb=`). Confirm: Loox stars sit just above the buy button; problem/solution beige cards; zip pill; no click-zoom on the buy image.
- Meta: **nothing created** — no campaigns, drafts, or edits. Account write-access is **unverified** (first paused create will confirm).

## Recommended next steps (priority order)
1. **Reconcile the Desktop-created artifacts** (theme doc + `sandbox/gebeauty/CLAUDE.md` pointer + scripts) into `/c/claude` before Desktop deletion — else the playbook + trigger are lost.
2. **Decide the PDP-vs-LP A/B**: greenlight or keep parked. If go → run the funnel-integrity verification pass, then build 2 paused test campaigns (design is in the initiative, ready).
3. Optionally commit the initiative + theme doc to `main`.

## Context the next session needs
- **Two-checkout situation.** `/c/claude` is canonical; `Desktop/nami-works` is being retired (its git main is 63+ commits behind). Much of THIS session's file work landed on the Desktop tree — treat `/c/claude` as truth and reconcile forward.
- **LP dynamic-source rules** (single-hop only; page metafields need a store-wide *definition*; image/text → `.value`, richtext → `| metafield_tag`; `url` metafield needs an absolute URL; `rich_text_field` = JSON AST not HTML). Inside a featured-product section, `section.settings.product.metafields…` is a valid single-hop.
- **MCP auth:** the GE Beauty Shopify MCP + Slack + adobe-creativity need re-authorization via claude.ai connector settings (unavailable in a headless/non-interactive run). Theme + Shopify work does NOT need them — it uses the direct Admin API + `.env` token.
- Full A/B design, funnel threat map, register maps, and the theme playbook are all captured in the initiative + `docs/gebeauty-theme-customization.md` — don't re-derive.
