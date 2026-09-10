---
id: gebeauty-b2b-portfolio-pages
name: GE Beauty B2B portfolio decks (prospect + partner) → b2b.gebeauty.com.br
owner: cto
status: in-progress
priority: normal
created: 2026-08-12
target: null
current_phase: 4-institutional-placeholders
next_blocker: "Camila Coutinho founder quote + portrait, and brand reach numbers (seguidores/clientes/avaliações/alcance) -- owner: lucas provides / cto wires."
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

## Current state (2026-08-14) — LIVE on b2b.gebeauty.com.br

Migration off Shopify is done. Both decks are self-contained static HTML (S3 + CloudFront), decoupled from the theme entirely:
- Commercial: https://b2b.gebeauty.com.br/comercial
- Neutral/partner: https://b2b.gebeauty.com.br/parceiros

Gated by a custom per-client login (username + password + visitor name, one screen — not the browser's native Basic Auth popup). Credentials live in a CloudFront KeyValueStore, managed via `gebeauty/scripts/_b2b_manage_client_access.py add|remove|list`. Each client's first visit is tracked (`?_co=<company>&_n=<name>`) into the CloudFront access logs; an `access-notify` Lambda emails Lucas immediately per view, and an `access-digest` Lambda sends a daily rollup (09:00 UTC). Link-preview metadata (title, `og:title`/`og:image`/etc.) is wired for WhatsApp/social sharing, including on the login gate itself (crawlers never have credentials, so the tags had to live there too, not just in the deck HTML).

Infra + build pipeline: `gebeauty/b2b-site/infra/terraform` (S3, CloudFront, ACM, the CloudFront Function, the two Lambdas). Build: `gebeauty/scripts/_b2b_build_site.py` (font-inlines both decks) + `_b2b_make_neutral.py` (regenerates the partner deck from the commercial one) + `_b2b_deploy_site.py` (S3 sync + CloudFront invalidation). Source deck: `inputs/mockups/gebeauty-b2b-portfolio-v6.html`.

The two Shopify pages (`pf-comercial-k7m3qx9v`, `pf-marcas-p4w9zt6b`) are deleted. `gebeauty/scripts/_b2b_publish_pages.py` (the old Shopify publisher) is removed. **One manual leftover**: `templates/page.b2b.liquid` is still in the live theme (`[Check] - Produção`, id `181379236160`) — the connector's GraphQL tool blocks theme-file writes against the live/main theme as a safety guard, so this one unused, now-orphaned file needs removing by hand in the Shopify theme editor whenever convenient. It's inert (no page references it anymore).

## Phases

- [x] 1. Build the interactive deck (mockup-first) — cover, diferencial, posicionamento, mercado, fundadora, novidades, 5+ line chapters, line-sheet, parceria, CTA. Photographic register, real catalog data, print→PDF. Copy per-line validated + /content-director brand-voice audit.
- [x] 2. Publish both variants LIVE on the Shopify store (superseded by phase 3 — pages now deleted).
- [x] 3. **Migrate off the Shopify page → `b2b.gebeauty.com.br`** — S3+CloudFront, self-hosted fonts (already-inlined images kept as-is), two routes, DNS at registro.br, custom per-client login (superseding the original plan's shared Basic Auth), access notifications (immediate + daily digest), WhatsApp/social preview tags + image. Shopify pages + publisher script retired. Only the theme template file removal remains, blocked by a safety guard on live-theme writes — manual cleanup in the theme editor, not urgent (inert file).
- [ ] 4. Fill institutional placeholders — Camila Coutinho founder quote + portrait; brand reach numbers (seguidores/clientes/avaliações/alcance). owner: lucas provides / cto wires.
- [ ] 5. Standalone launches deck (3rd variant) — brand refresher + fragrance market-defense + new items only, for existing customers. owner: cto on go.

## Notes

- 2026-08-14: Subdomain migration (phase 3) shipped end-to-end in one extended session: infra, per-client auth (replacing the original shared-credential plan), access tracking + notifications, unified login UX, and social link previews — all verified live against the real domain before each step closed out. Landed via PR #117 (a consolidation of #109-#116 after GitHub's base-branch auto-retargeting broke on a stacked-PR chain once an earlier base branch was deleted — same commits, one clean merge).
- Access-notify email sender/recipient is `lucas@gebeauty.com.br` (SES account is sandbox-mode, requiring a pre-verified identity on both ends) — not a new domain identity, reuses the one already verified.
- Locked decisions: unlisted, per-client-gated (not public); retail PVS shown (wholesale stays in quote); formal B2B register; seamless #ecede9 cards; fixed 4-per-row grid; no numerals/counts; "haircare" kept in the B2B CTA per Lucas; root `/` defaults to `/comercial/` (not `/parceiros/` or a chooser) — reversible one-line call, not a standing decision from Lucas.
- Related: `gebeauty-b2b-channels` (channel economics/registry), `gebeauty-design-system` (brand tokens), `feedback_ask_user_question` (validate copy changes via AskUserQuestion).

## Done means

- ~~The two decks (and any future variants) live on `b2b.gebeauty.com.br`, fully self-contained (no dependency on the Shopify theme), with a repeatable build/deploy path; the Shopify pages + `page.b2b.liquid` template retired~~ — done except the template file itself (manual, inert, not blocking). Institutional placeholders (phase 4) still open.
