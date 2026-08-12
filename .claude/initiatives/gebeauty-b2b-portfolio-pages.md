---
id: gebeauty-b2b-portfolio-pages
name: GE Beauty B2B portfolio decks (prospect + partner) → b2b.gebeauty.com.br
owner: cto
status: in-progress
priority: normal
created: 2026-08-12
target: null
current_phase: 3-migrate-to-subdomain
next_blocker: "Migration decision pending (Lucas): host b2b.gebeauty.com.br as static (S3+CloudFront like apps/omnify-site) vs other; keep product images on Shopify CDN vs self-host; self-host Italian Plate fonts on the subdomain. Both decks are LIVE on the Shopify store now and iterated to satisfaction; the subdomain move retires the fragile theme-template/cache/search dependencies."
next_owner: lucas
stakeholders:
  - GE Beauty
  - Prospective wholesale buyers (Sephora, perfumarias, redes)
  - Partner brands (co-marketing / campaign use)
working_agreement: ~/.claude/projects/c--claude/memory/feedback_cto_contract.md
---

## Why

Give GE Beauty a shareable, interactive product-portfolio presentation for B2B audiences — one that feels like a real sales deck (buyers expect that register), is fed from the live Shopify catalog (single source of truth), reads formal/credible, and can be handed to two different audiences:
- **Prospective wholesale buyers** (Sephora, perfumarias, redes): full sales pitch (diferencial, posicionamento, mercado, parceria/sell-out, CTA).
- **Partner brands** (buy products or use them in campaigns/marketing): a neutral product catalog with the sell stripped.

Distinct from `gebeauty-b2b-channels` (that initiative owns the channel economics + registry: Sephora CADASTROS, Drogaria Iguatemi P&L, TJX). This one owns the **presentation asset** those channels are pitched with.

## Current state (2026-08-12) — LIVE

Both decks are published and iterated to Lucas's satisfaction:
- B2B: https://www.gebeauty.com.br/pages/pf-comercial-k7m3qx9v (page `164822745408`)
- Neutral: https://www.gebeauty.com.br/pages/pf-marcas-p4w9zt6b (page `164822778176`)

Immersive (chrome-less `page.b2b.liquid` `{% layout none %}` template), unlisted + `noindex`, fed from the live registry, storefront-style seamless `#ecede9` cards in a fixed 4-per-row grid, formal-B2B copy (line-validated + brand-voice audited). Full build/publish detail + all source paths in **`docs/handoff-b2b-portfolio-pages.md`**.

## Phases

- [x] 1. Build the interactive deck (mockup-first) — cover, diferencial, posicionamento, mercado, fundadora, novidades, 5+ line chapters, line-sheet, parceria, CTA. Photographic register, real catalog data, print→PDF. Copy per-line validated + /content-director brand-voice audit.
- [x] 2. Publish both variants LIVE on the Shopify store — image localization + canonical CDN wiring, chrome-less immersive template, unlisted + noindex, neutral variant via `_b2b_make_neutral.py`. Storefront-style cards + 4-per-row grid + all copy/layout iterations landed.
- [ ] 3. **Migrate off the Shopify page → `b2b.gebeauty.com.br`** — owner: lucas (decide hosting + asset strategy), then cto builds. Static host (S3+CloudFront à la `apps/omnify-site`); self-host fonts + optionally images; two routes; point DNS; deploy; retire the two Shopify pages + `page.b2b.liquid`. Kills the theme-swap / cache / search / font-path fragilities (see handoff §4).
- [ ] 4. Fill institutional placeholders — Camila Coutinho founder quote + portrait; brand reach numbers (seguidores/clientes/avaliações/alcance). owner: lucas provides / cto wires.
- [ ] 5. Standalone launches deck (3rd variant) — brand refresher + fragrance market-defense + new items only, for existing customers. owner: cto on go.

## Notes

- 2026-08-12: Initiative opened at handoff to Claude Desktop / Claude Code. Work to date committed on `main`; live pages up. Migration to `b2b.gebeauty.com.br` is the headline next move — it's the clean fix for the recurring theme-template/cache/menu fragilities the Shopify-page hosting created.
- Locked decisions: unlisted public link (not gated); retail PVS shown (wholesale stays in quote); formal B2B register; seamless #ecede9 cards; fixed 4-per-row grid; no numerals/counts; "haircare" kept in the B2B CTA per Lucas.
- Related: `gebeauty-b2b-channels` (channel economics/registry), `gebeauty-design-system` (brand tokens), `feedback_ask_user_question` (validate copy changes via AskUserQuestion).

## Done means

- The two decks (and any future variants) live on `b2b.gebeauty.com.br`, fully self-contained (no dependency on the Shopify theme), with a repeatable build/deploy path; the Shopify pages + `page.b2b.liquid` template retired; institutional placeholders filled.
