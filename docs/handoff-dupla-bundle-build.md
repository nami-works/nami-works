# Session Handoff — 2026-07-30 — Dupla bundle build (moving to Cowork)

## What was done
- **Built + launched a native bundle end-to-end:** `dupla shampoo + booster fortificante` (product GID `10217099297088`, handle `dupla-shampoo-booster-fortificante`), components **GEB 001** shampoo sem sulfato ×1 + **GEB 019** booster fortificante ×1. Was an empty DRAFT; now a fully-enriched, **ACTIVE**, live PDP.
- **Registry enrichment applied** (all copy sourced from the two components' already-approved claims — no new actives invented; booster active clause lifted verbatim from the live `dupla leave-in + booster fortificante` sibling):
  - `productType=kit`; 13 tags incl. `dupla`, `dupla_shampoo+booster`, `kit-ate-300`, `kit-com-booster`, `kit-full-size`, `contem-shampoo`, `antiqueda`, `forca-e-nutricao`, `couro-cabeludo`, `queda-quebra`.
  - `descriptionHtml` (h3+p), SEO title + description.
  - Metafields: `custom.finalidade`, `custom.caracteristicas` (4 bullets), `custom.etiquetas` = shared **r10-off** badge (`gid://…/177092624704`), `custom.descricao_longa_com_abas` → **new ACTIVE metaobject** `gid://shopify/Metaobject/368455024960` (tabs: o_que_e / passo_a_passo / resultado / itens_do_kit=[GEB001,GEB019] / ingredientes), `mm-google-shopping` + `mc-facebook` google_product_category = `543615`.
  - **Hero image**: `DUPLA_FORTIFICANTE.png` (1000×1000) pulled from Drive folder `1rY9vPMQt4h8E2n7pjEEZBU4Z3ebg1Iw0`, uploaded via staged-upload, set as featured media (READY, rendering on storefront).
  - **Activated** (DRAFT→ACTIVE) and **published to Online Store** via legacy REST `published=true`.
- **Committed the 3 build scripts to `origin/main`** (`902af69`): `gebeauty/scripts/_dupla_fort_apply_registry.py`, `_dupla_fort_apply_hero.py`, `_dupla_fort_activate_publish.py`.

## Key decisions
- **PRICING — DO NOT TOUCH.** I initially set `price=160/compareAt=170` to mirror siblings; Lucas **reverted to price=170, no compareAt** and corrected hard: the discount is applied by the **`kit-ate-*` per-tag rule computed off `compareAtPrice`** — never set prices differently from what's agreed. New HARD memory: `feedback_never_override_agreed_price`. If a bundle needs a price/compareAt, that's Lucas's number, not an inference. DRAFT status does not lower the bar.
- **API is 2026-01:** `productUpdate` takes `ProductUpdateInput!` (not `ProductInput!`). Publishing needs `write_publications` (token lacks it) — Online Store was reachable via the legacy REST `published` flag under `write_products`.
- **Copy is component-sourced only** — reuse approved component claims/actives for bundles; never invent (this is the compliance-safe path that avoids the consistency-sweep debt).
- **Scripts committed** because they encode a reusable dupla-build recipe; the 3 read-only probes (`_bundle10217_state.py`, `_dupla_template_harvest.py`, `_dupla_parity_harvest.py`) were left **untracked** (throwaway).

## What's pending
1. **Publish to the other 7 sales channels** — only Online Store is live. Siblings are also on: **Google & YouTube, Pinterest, TikTok, Facebook & Instagram, IGLU POS, Point of Sale, Microsoft Copilot**. Blocked on `write_publications` scope (token has only `read_publications`). Either add the scope so `publishablePublish` works, or toggle the channels by hand in admin.
2. **Pricing confirmation (Lucas-owned):** confirm the `kit-ate-*` rule yields the intended discount off the R$170 shelf price on this SKU, and that the r10-off badge matches. Do not change price/compareAt without an explicit number.
3. **Optional:** the theme surfaces only 3 tabs (o que é / modo de uso / resultado); `ingredientes` + `itens do kit` are stored but not shown — same as siblings, left as-is.

## Modified files
- `gebeauty/scripts/_dupla_fort_apply_registry.py` — **complete**, committed `902af69`
- `gebeauty/scripts/_dupla_fort_apply_hero.py` — **complete**, committed `902af69`
- `gebeauty/scripts/_dupla_fort_activate_publish.py` — **complete** (publish step partially blocked on scope), committed `902af69`
- `gebeauty/scripts/_bundle10217_state.py`, `_dupla_template_harvest.py`, `_dupla_parity_harvest.py` — **cleanup**: untracked probes, delete or keep as scratch
- Hero image cached at scratchpad `dupla_fort.png` (ephemeral)

## Current state / how to verify
- Live PDP: `https://www.gebeauty.com.br/products/dupla-shampoo-booster-fortificante` — renders hero, de R$170 (no strikethrough), description, 4 char bullets, 3 tabs.
- Admin: `https://admin.shopify.com/store/ge-beauty-cosmeticos/products/10217099297088` — status ACTIVE, 1 media READY.
- Read-only state probe: `cd /c/claude/gebeauty && C:/Python314/python.exe scripts/_bundle10217_state.py`.
- All Shopify work via direct Admin API using `gebeauty/.env` (API 2026-01) — more reliable than the flapping MCP.

## Recommended next steps
1. Decide channel publishing (pending #1): add `write_publications` and run `_dupla_fort_activate_publish.py` (it mirrors the shampoo's channel set), or toggle channels manually. **Confirm with Lucas first** (channel visibility = product decision).
2. Have Lucas eyeball the `kit-ate-*` discount on this SKU (pending #2). **No price writes without his number.**
3. Clean up the 3 untracked probe scripts if desired.

## Context the next session needs
- **CONCURRENT-SESSION HAZARD (critical):** a **Cowork session operates in this same `C:\claude` checkout**. This session hit a live collision — HEAD switched mid-operation, the shared index briefly co-mingled staged files across sessions. **Do not commit into the shared index while Cowork is active.** Land commits via an **isolated worktree** (`git worktree add -b <branch> C:/claude-wt/<name> main`), commit there, then `git push origin HEAD:main` (atomic ff). Never `git add .`; stage explicit paths only; never `git reset --hard` another session's tree.
- **This work is moving to Cowork** — that session owns follow-through on channels/pricing.
- **Native bundle mechanics:** components live under `variants[].productVariantComponents`; `itens_do_kit` in the descricao_longa metaobject is the customer-facing kit list. Titles stored lowercase (theme title-cases). Rich-text metaobject fields are Shopify `{type:root,children:[…]}` JSON.
- **Drive images** are link-shared: `powershell Invoke-WebRequest 'https://drive.google.com/uc?export=download&id=<FILE_ID>'` fetches bytes directly (no auth) — used for the hero.
- Memory refs: `feedback_never_override_agreed_price` (NEW, HARD), `reference_gebeauty_bundles_app_owned`, `project_gebeauty_shopify_conventions`, `reference_gebeauty_etiqueta_applier`.
