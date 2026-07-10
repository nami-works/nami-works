---
id: gebeauty-custom-data-hygiene
name: GE Beauty storefront standards — custom-data hygiene + content-page pattern
owner: shared
status: in-progress
priority: normal
created: 2026-06-24
target: null
current_phase: 2-field-map
next_blocker: 4 product decisions gate Tiers 3-4 (pre-sale keep/kill, etiqueta R$/%-off library policy, canonical banner convention, social-proof badge vocabulary). Tier 1 safe-deletes can ship now on Lucas's go.
next_owner: lucas
stakeholders:
  - GE Beauty (tenant #1)
working_agreement: ~/.claude/projects/c--Users-Lucas-Guimar-es-Desktop-nami-works/memory/feedback_cto_contract.md
---

## Why
GE Beauty's custom-data layer has drifted: 76 etiqueta entries for ~5 in active use, features scaffolded in the theme but never populated, duplicate/misnamed fields, and overlapping metafields that invite double-entry and errors. Two outcomes: (1) a canonical "go-to" **field map** so anyone (human or session) knows what every product/collection/page field means, who fills it, and where it renders — killing guesswork before edits; (2) a **cleanse** that removes dead weight and merges overlaps so the registry stays simple. Pays back every time we touch product copy, badges, or collections. Also owns **storefront content-page standards** — a reusable pattern for rich pages (store locator, landings) built as self-contained `body_html`, so page revamps stay consistent and need no theme deploy.

## Phases
- [x] 1. Audit — full cleansing map produced — 2026-06-24 → `sandbox/gebeauty/research/metafield-metaobject-cleanse-audit.md`
- [ ] 2. Field map / data dictionary — canonical reference of every custom product + collection + page metafield and metaobject (purpose · who fills · where rendered · status). IN PROGRESS, owner: cto
- [ ] 3. Tier 1+2 safe deletes — dead features (como_usar slider, ingredientes_com_foto, disclaimers) + zero-use defs. Approval-gated, dry-run each.
- [ ] 4. Tier 3 — etiqueta dedupe/consolidation (76 → ~15-20). BLOCKED on R$/%-off library policy.
- [ ] 5. Tier 4 — merges: drop orphaned `descricao_longa.modo_de_uso`, unify collection banner convention, reconcile `tipo_de_cabelo` vs `shopify.hair-type`, relabel `custom.finalidade`.
- [ ] 6. Tier 5 — system noise: fix category mis-assignment (taxonomy fields), clear undefined theme metafield refs.
- [x] 7. Storefront content-page pattern established + first page (pontos físicos store locator) revamped & shipped to live — 2026-06-25 (pattern in reference section below)

## Notes
- 2026-06-25 — Revamped `/pages/pontos-fisicos` (store locator) via /design-engineer: HTML mockup → published preview page → promoted to the live page `132999643456` (old HTML backed up to `sandbox/gebeauty/research/pontos-fisicos-live-backup-2026-06-25.html`, temp preview deleted). Settled the reusable **storefront content-page pattern** (reference section below). Final design calls: WhatsApp buttons stay GE red, maps stay live Google embeds (static-thumbnail upgrade deferred — needs a Static Maps key). Iterated address standard to 2 lines (street / neighborhood, no ZIP/city) and sorted the partner section by city.
- 2026-06-24 — Initiative opened. Audit (phase 1) complete; cross-referenced API definition counts against a full 540-asset theme scan. Headline: 71/76 etiqueta entries unreferenced; `como_usar.slider` + `ingredientes_com_foto` features scaffolded in theme with 0 product data; several count=0 defs. Full detail + tier breakdown in the audit doc. Storefront field→placement map already in memory: `reference_gebeauty_storefront_metaobjects.md`.
- 2026-06-24 — Scope rule: target is `custom.*` (+ stray `como_usar.*`). Shopify taxonomy (`shopify.*`/`shopify--*`) and app namespaces (loox, reviews, judgeme, fullcomm, mm-google-shopping, etc.) are system/app-owned — flag, don't unilaterally delete.
- 2026-06-24 — 4 product decisions pending from Lucas before Tiers 3-4 (see `next_blocker`). Tier 1 + zero-use Tier 2 are safe to execute on his go without those answers.

## Done means
- A field map exists at `sandbox/gebeauty/research/` (or design-system) listing every custom product/collection/page metafield + metaobject with purpose, fill-owner, render location, and keep/merge/remove status — and is the referenced source for future custom-data edits.
- Dead features and zero-use definitions removed (metafield + metaobject + theme block, all layers).
- etiqueta set pruned + standardized to the active vocabulary + one consistent campaign-badge scheme; no duplicate or mislabeled entries.
- Each overlapping concept has a single source of truth (how-to, banners, hair-type, benefits documented).
- No orphaned metaobjects (entries with nothing referencing them).
- Storefront content-page pattern documented and applied (first instance: pontos físicos, shipped 2026-06-25) — future content pages follow it.

## Storefront content-page pattern (reference — established 2026-06-25 on /pages/pontos-fisicos)

Reusable standard for any rich storefront content page (store locator, landing, etc.), proven on the "pontos físicos" revamp:

- **Delivery:** page content is the page's `body_html`, set/maintained via the **Admin API by a build script** — NOT the WYSIWYG editor (it strips `<style>`/`<script>` on save). No theme edit or deploy needed; instant + reversible (back up the old `body_html` first).
- **Self-contained & namespaced:** one `<style>` block + inline SVG icons + (optional) inline `<script>`, all class-prefixed (`.gebpf-*`) to avoid theme CSS clashes. **Verified:** inline `<style>` AND `<script>` set via API persist and execute on the storefront — corrects the earlier "Shopify strips JS on pages" assumption (only the WYSIWYG strips them).
- **Brand tokens:** GE red `#DF372F`, ink `#161616`, muted `#6b6b6b`; display font inherits the theme (Italian Plate No1).
- **Responsive layout:** card grid 2-up on desktop → on mobile (≤768px) a horizontal **scroll-snap carousel** (cards ~92% width with a peek) + an auto-hiding swipe hint (tiny JS fades it once the last card is reached). Single-card sections stay full-width (no carousel/hint).
- **Store-locator card anatomy:** *(optional)* live Google map embed → city eyebrow → name (H3) → 2-line address (street **bold** 13.5px / neighborhood muted) → floor badge + in-mall directions in a **40/60 row** (badge wraps when long) → action buttons **stacked vertically** (WhatsApp red on owned kiosks; "como chegar" directions on all). *Shipped pontos-físicos dropped the maps (text-only cards + directions buttons) — map CSS/coords kept in the script for easy re-add.*
- **Build/deploy modes** (`sandbox/gebeauty/scripts/_create_pontos_fisicos_page.py`): no-arg = refresh local mockup only · `preview` = update phone URL `/pages/pontos-fisicos-novo` · `apply` = push live `/pages/pontos-fisicos`.
- **Address standard:** row1 = street + number (ink); row2 = neighborhood (muted). **Drop ZIP + city** (city is shown by the card's eyebrow). Sort multi-location sections **by city A→Z**.
- **Title:** H1 (bold) + H2 subtitle, in the body.
- **Gotcha:** mobile browsers auto-link CEP/phone-like numbers into `tel:` links; suppress by splitting the number with an inline element (`01332-<span>010</span>`) — only needed when a number is present.
- **Artifacts:** mockup `inputs/mockups/gebeauty-pontos-fisicos-v1.html`; build script `sandbox/gebeauty/scripts/_create_pontos_fisicos_page.py` (now targets the live page `132999643456`); pre-revamp backup `sandbox/gebeauty/research/pontos-fisicos-live-backup-2026-06-25.html`.
