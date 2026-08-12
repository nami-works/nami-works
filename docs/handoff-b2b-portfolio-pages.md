# Handoff — GE Beauty B2B Portfolio pages (prospect + partner decks)

**Surface: Claude Code** (local git + memory + `gebeauty/.env` + Windows PowerShell + Shopify Admin API). This document is self-contained; read it top to bottom before touching anything.

**Status as of 2026-08-12:** both pages are **LIVE** on the GE Beauty Shopify store and iterated to Lucas's satisfaction. All source is committed to `main`. The next major move (see §7) is to lift these OFF the Shopify page and onto a dedicated subdomain, **`b2b.gebeauty.com.br`**.

---

## 1. What this is

An **interactive, immersive product-portfolio presentation** for GE Beauty's B2B audience, delivered as two variants of the same deck:

| Variant | Audience | Live URL | Page ID |
|---|---|---|---|
| **B2B sales deck** | Wholesale buyers (Sephora, perfumarias, redes, department stores) | https://www.gebeauty.com.br/pages/pf-comercial-k7m3qx9v | `164822745408` |
| **Neutral partner deck** | Partner brands that want to buy products or use them in campaigns/marketing | https://www.gebeauty.com.br/pages/pf-marcas-p4w9zt6b | `164822778176` |

Slugs are intentionally unguessable; pages are unlisted (no nav link) + `noindex,nofollow`. They are NOT meant to be findable via storefront search.

It is a scroll-telling lookbook (editorial + photographic), not a DTC storefront. Both render **full-screen** with no store header/footer (see §4). The B2B deck carries the full sales pitch; the neutral deck strips it (see §3).

## 2. Source files (all committed on `main`)

Everything lives under `c:\claude`:

- **Decks (mockup = source of truth for the page body):**
  - `inputs/mockups/gebeauty-b2b-portfolio-v3.html` — the B2B deck. Self-contained: one `<style>` (fonts, tokens, all CSS), the static section markup, and a `<script>` whose `PORTFOLIO[]` array + `card()`/line/table renderers build the DOM. **Edit this file to change either deck** (the neutral one is derived from it — see below).
  - `inputs/mockups/gebeauty-portfolio-neutral-v1.html` — the neutral deck. **DO NOT hand-edit** — it is generated from v3 by `_b2b_make_neutral.py`. Change v3, then regenerate.
  - `inputs/mockups/INDEX.md` — both decks are registered in the pre-rule section.
- **Local mockup assets** (used when opening the mockup files locally via `file://`):
  - `inputs/mockups/assets/portfolio_26-06-22_white-space-left.webp` — cover hero (full-portfolio lineup, left whitespace). Optimized from `G:\Drives compartilhados\GEB_Marketing\MARKETING COMPARTILHADO\IMAGENS\Produtos\portfolio_26-06-22.png`.
  - `inputs/mockups/assets/ge-beauty-logo.webp` — header logo (white knocked out to alpha).
  - `inputs/mockups/assets/products/<slug>.webp` — 21 product shots (slug = SKU lowercased, spaces removed, e.g. `geb001.webp`).
- **Scripts** (`gebeauty/scripts/`, run with `C:/Python314/python.exe`, resolve `.env` from `gebeauty/.env`):
  - `_b2b_portfolio_fetch.py` — pulls the live active line (productType `product`/`acessorio` only) → `_b2b_portfolio_fetch.out.json` (sku, title, price, tags, `lancto`, `featuredImage` URL). Run this first when refreshing data/prices/images.
  - `_b2b_localize_images.py` — reads the fetch output, downloads + optimizes the current `featuredImage`s into `assets/products/` (for the local mockup). Prints price reconciliation.
  - `_b2b_make_neutral.py` — derives the neutral deck from v3: removes sales-pitch sections (`diferencial`, `marca`, `mercado`, `parceria`, placeholder `fundadora`) + the CTA (`contato`) + the PVS footer, neutralizes copy, drops the cover H1, stretches the cover image full width, moves the price into the expandable card detail. **Run after any v3 edit.**
  - `_b2b_publish_pages.py` — the publisher. Uploads hero+logo to Shopify Files, wires product cards to the current canonical CDN `featuredImage` URLs, adds the chrome-less theme template, upserts both pages. Sources HTML/images from git via `git show` so a concurrent checkout flip can't corrupt a run. **DRY by default; pass `commit` to write to the live store.**
  - Recon one-offs (reference only): `_check_search_config.py` (storefront predictive search indexes pages), `_fetch_theme_fonts.py` + `_fetch_font_urls.py` (theme font discovery), `_find_camila_quote.py` (founder-content search).

## 3. How the two decks differ (the neutral transform)

`_b2b_make_neutral.py` turns v3 → neutral. It **removes**: the Diferencial, Posicionamento, Mercado, Parceria and (placeholder) Fundadora sections, the CTA/`contato` section, and the PVS footer. It **neutralizes** copy (drops "recompra do portfólio", "girar no PDV", "tabela de atacado", etc.), **drops the cover H1** (keeps eyebrow + descriptive line + tagline), **stretches the cover portfolio image full width**, and **moves the price from the card face into the expandable detail**. Net: a clean product catalog with no wholesale sell.

## 4. Rendering / theme mechanics (the fragile part — the migration fixes this)

- Pages use a **chrome-less template** `templates/page.b2b.liquid` on the published theme (id `181379236160`, `[Check] - Produção`): `{% layout none %}` + a bare `<!doctype>` wrapper + `<meta name="robots" content="noindex,nofollow">`. Both pages have `template_suffix = "b2b"`. This is additive — it does NOT modify any existing theme file.
- **Known fragility (why we're migrating):**
  - CheckCommerce's badge-cache-bust can **swap/republish the live theme** and wipe this added template (memory `reference_gebeauty_theme_publish_role`). If the store menu ever reappears, the template was lost — re-run the publisher.
  - The deck's Italian Plate `@font-face` points at the theme CDN path `t/34`; a theme republish bumps the version and type falls back to Assistant.
  - Storefront/edge/browser caching caused repeated "I still see the menu / old version" confusion. Server was always correct; the client cached the first (theme-wrapped) render. **All of this disappears once the deck is a standalone site on `b2b.gebeauty.com.br`.**
- **Images:** product cards reference the live Shopify CDN `featuredImage` URLs (canonical, current). Hero + logo were uploaded to Shopify **Files** (re-uploaded on each publish → a few duplicate Files accumulated; harmless, worth a one-time cleanup). Fonts stream from the theme CDN.

## 5. Fonts + brand tokens (mirrors the live DTC theme)

- Body + headings: **Italian Plate No2 Expanded** (sans), fallback Assistant.
- Buttons + small labels/nav: **Italian Plate Mono** (No1 on buttons, No2 on labels).
- **GE Red = `#DF3630`** (canonical). Product-shot background = **`#ecede9`** (canonical; the card bg is set to exactly this so photos bleed seamlessly).

## 6. To re-publish after any change

```powershell
cd c:\claude
C:/Python314/python.exe gebeauty/scripts/_b2b_portfolio_fetch.py          # refresh live data/images (optional)
# edit inputs/mockups/gebeauty-b2b-portfolio-v3.html for design/content
C:/Python314/python.exe gebeauty/scripts/_b2b_make_neutral.py             # regenerate the neutral deck
# commit v3 + neutral (mockup branch; hook blocks direct main)
C:/Python314/python.exe gebeauty/scripts/_b2b_publish_pages.py            # DRY: verify card-wire / hero / logo
C:/Python314/python.exe gebeauty/scripts/_b2b_publish_pages.py commit     # writes to the LIVE store (confirm with Lucas)
```
The publisher reads the decks from git (`BRANCH` const at the top — update it to the branch/`main` the source is on). Verify live with a cache-busted fetch (`?v=<n>`), not the canonical URL (edge cache lags a couple minutes).

## 7. NEXT MAJOR MOVE — migrate off the Shopify page → `b2b.gebeauty.com.br`

**Decision (Lucas, 2026-08-12): take these pages out of the Shopify storefront and host them on a dedicated subdomain, `b2b.gebeauty.com.br`.** Rationale: kills every §4 fragility at once — no theme-template dependency (immune to CheckCommerce theme swaps), no storefront-search exposure, no edge/theme cache confusion, no `t/34` font-path breakage, full layout control. The decks are already fully self-contained HTML, so they port with minimal change.

Open design questions for that build (decide with Lucas):
- **Hosting:** static (S3 + CloudFront, mirroring `apps/omnify-site`) vs. another static host. No server needed — these are static HTML.
- **Assets:** keep referencing Shopify CDN for product images (simplest, but couples to the store) vs. move all images to the new host (fully independent). Fonts likewise (self-host the Italian Plate woff2 on the subdomain instead of the theme CDN).
- **The two decks → two routes** (e.g. `b2b.gebeauty.com.br/comercial` and `/parceiros`), or keep unguessable paths.
- **Access control:** still unlisted, or add a light gate?
- **Then:** point DNS, deploy, and retire the two Shopify pages + the `page.b2b.liquid` template.

## 8. Open items (smaller, independent of the migration)

- **Camila Coutinho (founder) quote + portrait** — the Fundadora section on the B2B deck has placeholders. No verbatim quote exists in the store; the closest is the "A mágica da cocriação" blog article. Founder photos are in Shopify Files (`2024-01-29_Camila_Coutinho0903.jpg`, etc.). Either draft an attributed quote from the article (Lucas approves) or Lucas provides exact words.
- **Brand reach numbers** — the "Mercado e marca" section (B2B deck) has `[ • ]` placeholders (seguidores, clientes, avaliações, alcance). Needs real figures from Lucas.
- **Standalone launches deck** — spec agreed earlier (brand refresher + fragrance market-defense + new items) but not yet built as a third variant.
- **Cleanup:** duplicate hero/logo Files in the Shopify Files library from repeated publishes; unused `.gbb-line-num` / `.gbb-foot` / `.gbb-line-count` CSS rules left in v3 (harmless).

## 9. Key decisions already locked (don't re-litigate without Lucas)

- Public/unlisted link (not gated), page on the main store **for now** (→ moving to the subdomain).
- Pricing shown = **retail PVS** (product value + retailer margin story); negotiated wholesale stays in the quote conversation.
- Copy validated line-by-line + brand-voice audited for a **formal B2B register** (kept "haircare" in the B2B CTA per Lucas; used "girar no ponto de venda", "Invista na categoria…", "Geramos reconhecimento, desejo e demanda").
- Cards: seamless one-color (`#ecede9`) with the image bleeding edge-to-edge; **fixed 4-per-row grid** (no horizontal scroll); no category numerals, no per-category product count.

---

**Next step / Owner:** kick off the `b2b.gebeauty.com.br` migration (§7) — owner: Lucas to pick hosting + asset strategy, then CTO builds. Everything needed to continue is in this doc + the committed source. Tracked in initiative `gebeauty-b2b-portfolio-pages`.
