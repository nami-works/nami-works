---
id: marketplace-catalog-optimization
name: Marketplace catalog optimization framework
owner: shared
status: in-progress
priority: normal
created: 2026-07-02
target: null
current_phase: 5-rappi-turbo-copy-drafted
next_blocker: Rappi copy review (Lucas) + pure-white packshot production + GEB 029 real volume; Amazon Mayday 122-126 still pending prices/data
next_owner: lucas
stakeholders:
  - GE Beauty
working_agreement: ~/.claude/projects/c--Users-Lucas-Guimar-es-Desktop-nami-works/memory/feedback_cto_contract.md
---

## Why
We ran a full catalog-improvement pass on Amazon 1P (existing 16 SKUs + 5 new) and the mechanics are reusable, not Amazon-specific. Registering the framework means the next marketplace we join (Mercado Livre, Magalu, Sephora, Shopee, etc.) reuses a proven playbook instead of relearning it, and every channel renders the same brand voice + margin discipline. It also keeps the standard consistent across whoever picks the work up. This initiative is the home for that framework and its per-marketplace rollouts.

## Framework (marketplace-agnostic)

The order matters: **ground → copy → media → discoverability → registry → margin → monitor**. Each step is a gate.

1. **Ground in the live source catalog first (anti-hallucination).** Pull product names, descriptions, prices, specs, and images from the live Shopify catalog. Never invent an active, claim, or spec. **Only read prices from `productType` product/acessorio — never rappi/brinde/kit** ([[feedback_shopify_product_type_price]]). Cross-check the marketplace's own catalog export to see what already exists vs. what's genuinely new.

2. **Descriptions / intros — brand voice, minimal-change, validated.** Base each on the product's real Shopify description with minimal edits, not a from-scratch rewrite. **Opening phrase = the product's canonical tagline verbatim** (in GE's case the `custom.finalidade` metafield, character-identical). Then benefit-led body, ingredient-as-proof kept light, brand-voice rules (no em-dashes, idiomatic PT, canonical claims 230°C / 12h / 24h / 72h, clean/vegana/cruelty-free close). Voice canon: [[project_gebeauty_voice_registry]]. **Generate 3 options per product and validate one-by-one with Lucas** before writing to the file. Write approved copy into the marketplace's own template, not a scratch doc.

3. **Images — resize to spec, keep brand look.** Pull hero + additional images from Shopify; resize to the marketplace's dimension spec (uniform square, ≥1600px for zoom); **keep GE's brand background (`#ecede9`) unless the marketplace hard-requires pure white** (Amazon MAIN technically wants white — flagged, Lucas accepted keeping brand bg). Name per the marketplace convention (Amazon: `<ASIN>.MAIN.jpg` / `.PT01..08`, or feed image-URL columns). Feeds that accept URLs can point straight at the Shopify CDN.

4. **Search terms / keywords — platform best practices.** Amazon: ≤250 bytes total, spaces only, no punctuation, no brand or competitor names, synonyms + use-cases + spelling variants, pt-BR, don't repeat words already in title/bullets. Adapt the byte/format rules per platform.

5. **Category / browse nodes — use the controlled taxonomy, don't guess.** Every marketplace has a fixed category tree; a wrong string de-indexes or rejects. On Amazon the valid nodes (the "BTG", Browse Tree Guide) are **embedded in the category template's Dropdown Lists sheet** — no separate 1P download. Pick the node where strong competitors actually sit ("more specific ≠ more correct"). Confirm placement with Lucas when there's a judgment call.

6. **New-product registry — clone a live row.** To fill a complex item-setup feed, clone a live, accepted product's row (same category) to inherit valid enum/dropdown values, then override only the SKU-specific fields (identity, EAN, copy, price, dims, form). Fill mandatory + relevant conditional fields; **flag enum-uncertain fields** rather than guessing. Never overwrite Lucas's source files — but write the finished content into the real uploadable file, not a side doc.

7. **Margin / PPM parity check before launch.** Before registering costs, verify the new SKUs' **cost-to-retail ratio is in parity with the existing line** (GE band ≈ 0.80–0.81) so they start with a healthy platform margin. Parity is necessary but not sufficient — see the Net PPM mechanics + reorder-deadlock finding in [[project_gebeauty_amazon_1p]].

8. **Monitor realized sell-out post-launch (the trap-avoider).** Platform margin turns on the *realized* selling price, not the retail we set. Watch realized ASP (Shipped Revenue ÷ Units) once live; alert if it drops below ~90% of registered retail or margin metric goes red. This is the early signal that would have caught GE's negative-PPM SKUs months sooner.

**Deliverable discipline (all steps):** produce upload-ready files, approval-gated — we never push anything live to the marketplace or the store; Lucas uploads. Read-only against source systems.

## Phases
- [x] 1. Amazon 1P catalog pass — existing 16 SKUs (images + intros) and 5 new SKUs (029/031/032/033/121) registered — 2026-07-02
- [x] 2. Framework registered (this file) — 2026-07-02
- [ ] 3. Amazon: complete Mayday line 122-126 registry — BLOCKED on prices/data (Lucas)
- [ ] 4. Amazon: upload + ASP-watch live (fires on first post-launch Vendas export)
- [~] 5. Apply framework to **Rappi Turbo** (marketplace #2)
  - [x] 5a. Channel rendering rules reverse-engineered from 14 competitor PDP screenshots (title formula, image spec, description, facets) — 2026-07-02
  - [x] 5b. Copy drafted for all 21 `productType=product` SKUs (Amazon 1P as canonical, adapted to convenience-length; finalidade verbatim first sentence) — consolidated table + CSV + per-SKU at `sandbox/gebeauty/content-director/2026-07-02_rappi-turbo/` — 2026-07-02
  - [ ] 5c. Pure-white packshot production (adapt bg pipeline #ecede9 -> #FFFFFF, ref-lit)
  - [ ] 5d. Confirm attribute facets + GEB 029 volume; upload via Rappi seller portal (Lucas)

## Notes
- 2026-07-02 — Framework extracted from the Amazon 1P session. Full channel mechanics (Net PPM formula, 12% on-invoice, cost = registered × 0.88, allowance stack, BTG-in-template) live in memory [[project_gebeauty_amazon_1p]]. Deliverable files in `G:\Drives compartilhados\GEB_Comercial\Marketplaces\Amazon\` (`*_INTROS_PREENCHIDAS.xlsm` = 16 existing descriptions; `Perfumes_Fragrancias_NOVOS_PREENCHIDO.xlsm` = 5 new; `images-amazon/` = existing-16 image zip).
- 2026-07-02 — Open Amazon items: Mayday 122-126 (no prices), the 6 orphan existing rows carry inherited placeholder images/keywords/category (description-only, per Lucas), and MAIN image bg stays GE `#ecede9`.
- Relates to the `gebeauty-b2b-channels` initiative (Amazon 1P is one B2B channel).
- 2026-07-02 — Rappi Turbo rollout started. Channel is mobile-first, search/category-driven, ultra-convenience. **Title formula = category-noun-first** (`<categoria> GE Beauty <linha> - <tamanho>`); competitors bury the searched term. **Image norm = pure white** (#FFFFFF) with studio lighting — Lucas approved white for Rappi (breaks GE greige on this channel only). Competitor copy on-shelf is machine-scraped garbage (Title-Case-every-word, missing spaces, typos) = low bar; clean GE copy out-premiums it. Facets rendered: Conteúdo, Tipo de Tratamento, Tipo de cabelo, Cor do cabelo. Channel detail captured in memory `project_gebeauty_rappi_catalog`.

## Done means
- The framework above is documented and proven end-to-end on Amazon (existing + new SKUs uploaded and live).
- The same framework has been applied to at least one additional marketplace without re-deriving the steps.
- Per-marketplace channel specifics captured in memory (as `project_gebeauty_amazon_1p.md` is for Amazon).
