---
id: gebeauty-design-system
name: GE Beauty brand system + Canva production automation
owner: shared
status: in-progress
priority: normal
created: 2026-06-23
target: null
current_phase: 1-foundations-review
next_blocker: Foundations v0 awaiting Lucas review (palette completeness, font confirm, neutrals/spacing); Canva Enterprise decision pending in parallel
next_owner: lucas
stakeholders:
  - GE Beauty
working_agreement: ~/.claude/projects/c--claude/memory/feedback_cto_contract.md
---

## Why
Give GE Beauty one canonical brand definition (in Claude Design) that every surface — Canva social/ads, Shopify storefront, paid creative — renders consistently, and a brief-driven automation (`/canva-studio`) that turns that system + the product catalog into review-ready on-brand Canva assets. Replaces ad-hoc manual design with a repeatable pipeline while keeping a human approval gate. Foundation for scaling content output without diluting the brand.

## Decisions (locked 2026-06-23)
- **Scope:** foundations-first, then components, then asset recipes.
- **Canva track: A** — design for Brand Template + Autofill API (requires Canva **Enterprise**, every user). Lucas evaluates the upgrade in parallel; build proceeds Track-B-first so it's useful before Enterprise lands.
- **Operator surface:** new **`/canva-studio`** skill (brief-driven, the visual twin of `/video-director`).
- **Publish boundary:** drafts only, always — every asset reviewed before it leaves.

## Phases
- [x] 0. Connect Canva + extract brand tokens — done 2026-06-23
- [ ] 1. Lock foundations in Claude Design — IN PROGRESS, owner: lucas (review v0)
- [ ] 2. Build components + asset recipes (recipe = dims + layout + tokens + copy slots per asset type) — owner: cto
- [ ] 3. Canva Enterprise decision + author Brand Templates from the recipes — owner: lucas (plan) + designer
- [ ] 4. Build `/canva-studio` skill (Track-B duplicate-and-edit now → swap fill step to Autofill API on Enterprise) — owner: cto
- [ ] 5. Brand-QA gate (no em-dash / benefit-only / real-products) + triggers (on-demand brief, scheduled batch) — owner: cto

## Notes
- 2026-06-25: **First deliverable (B2B portfolio deck) PARKED — Lucas redoing it "a different way."** Handover at `docs/handover-portfolio-catalog.md` (ephemeral). Keep the existing warm editorial look (white redesign was rejected). Deck fonts = full Italian Plate family (**No2 Expanded** display + **No1 Expanded Bold** + **No1 Mono**); 14 weights staged at `gebeauty/.brand-assets/fonts/_portfolio-canva-set/` and loaded into the Canva Brand Kit. Canva PPTX import drops licensed fonts (substitutes theme Calibri/Arial) → fix is upload-to-BrandKit + **re-import** (upload alone doesn't retro-heal; proven by pixel-diff=0). Canva API can't set font family. Broken-font designs left in Canva: seed `DAHNgXz0o2A`, master `DAHNgW4ypDw` (delete when new approach lands).
- 2026-06-23: Canva connected via committed `.mcp.json` (drive-letter casing split-brain in `~/.claude.json` was the blocker — see memory `reference_mcp_claudejson_drive_casing`).
- 2026-06-23: Canva account has **no Brand Templates** (autofill or plain) and brand-kit API exposes only id/name/thumbnail, no hex palette. Tokens extracted by PNG-export + PIL sampling.
- Confirmed tokens: **GE Red `#DF3630`**, Ink `#000000`, Paper `#FFFFFF`; typeface **Italian Plate No1** (full family on disk incl. Mono cut). Recommended free fallbacks: **Inter** (sans, has 900) + **IBM Plex Mono** (mono).
- `foundations.html` lives at `gebeauty/design-system/`; rendered as a Claude artifact for review.
- Canva can build assets now via duplicate-and-edit (copy-design + editing transaction); Autofill is the Enterprise upgrade path.

## Done means
A natural-language brief in chat produces review-ready, on-brand Canva drafts — copy obeying locked brand rules, imagery sourced via the packshot/Magnific pipeline, layout filled from a design-system-derived template — with nothing auto-publishing, and the design system living in Claude Design as the single source of truth that Canva, Shopify, and paid creative all reference.
