# GE Beauty — Shopify Theme Customization Playbook

How to customize the GE Beauty Shopify theme fast and safely, without re-deriving it each session. Read this before any theme/storefront customization work. Sharpest gotchas also live in Claude memory: `reference_shopify_dynamic_sources`, `reference_gebeauty_theme_publish_role`. The landing-page build/replication SOP is in `.claude/initiatives/landing-page-replication.md`.

---

## 0. Before you touch the theme
- **Verify which theme is live.** `GET /admin/api/2026-01/themes.json?fields=id,name,role` and edit the theme whose `role == main`. Do NOT trust the hardcoded id `181379236160` — CheckCommerce's "badge cache bust" flow republishes duplicates and silently swaps the live theme mid-session (see `reference_gebeauty_theme_publish_role`). If edits look "not applied" on the storefront, you're probably editing the wrong theme.
- **Creds:** token from `gebeauty/.env` (`SHOPIFY_ADMIN_ACCESS_TOKEN`), never hardcode. API `2026-01`. Python `C:/Python314/python.exe`, urllib (no deps).
- **Edits are LIVE** (the published theme is edited directly — authorized while Homologação isn't ready). Keep draft pages draft unless told otherwise.

## 1. Theme facts / design tokens
- Dawn-derived theme. **`1rem = 10px`**.
- CSS custom properties (on `:root`): **`--buttons-radius: 40px`** (pill), product card corner radius **`20px`** (`2.0rem`), **`--inputs-radius: 0px`** (square).
- Brand: GE Red `#DF372F`; beige card background `#ecede9`; font **Italian Plate No1** (+ Mono variant).
- The buy button is a pill whose **red fill is a separate layer from its 1px `::after` ring** — keep their `border-radius` equal or you get a "dent" (a transparent crescent) at the rounded corners.

## 2. Asset API workflow
- **Read an asset:** `GET /themes/{id}/assets.json?asset[key]=<key>` → `asset.value` (a string). Keys: `templates/page.landing-page.json`, `snippets/buy-buttons.liquid`, `sections/<type>.liquid`, `assets/base.css`, etc.
- **Write:** `PUT /themes/{id}/assets.json` body `{"asset":{"key":<key>,"value":<string>}}`. `200` OK; `422` returns a **specific** message — read it (e.g. "dynamic source does not exist", "top level nodes must be `<p>`…", "URL scheme").
- **Always read a section's schema before editing its settings:** fetch `sections/<type>.liquid`, parse the `{% schema %}` JSON → gives setting `id`s + `type`s + block types. The setting *type* dictates the binding syntax (§3).
- **JSON template shape:** `{ "sections": { "<key>": { "type", "settings", "blocks": { "<bk>": {"type","settings"} }, "block_order":[…] } }, "order":[…] }`. The `order` array is section sequence. **Reusing a section key with a different `type`** swaps that section in place (used to swap `multicolumn` → `tabs`).
- Reusable helper pattern (`call()` / `asset_get()` / `asset_put()`): copy from any `gebeauty/scripts/_*.py`.

## 3. Dynamic sources (binding settings to metafields)
Full rules: `reference_shopify_dynamic_sources`. Summary:
- **Single-hop only from `page`:** `{{ page.metafields.custom.X.value }}` works; page→product→field double-hop is rejected. BUT inside a featured-product section, `{{ section.settings.product.metafields.custom.X.value }}` is a valid single-hop (how the LP benefits seed from the product).
- **Definition required** (store-wide, matching `ownerType`, e.g. PAGE) or `422 "dynamic source does not exist"` — a value alone isn't enough.
- **Binding syntax by setting type:** image_picker / resource refs / `text` / `inline_richtext` → `.value`; `richtext` → `| metafield_tag` (bypasses the "top-level nodes must be `<p>/<ul>/<ol>/<h*>`" literal validation). `rich_text_field` values are a **JSON AST, not HTML** (convert HTML → AST; see `_wire_lp_texts.py`). `url` metafields need an **absolute** URL (scheme) — relative `/cart/…` is rejected.

## 4. Scoped CSS pattern
- Put a `<style>` block inside a **`custom_liquid`** block (e.g. the LP's `lpstyle` block in the featured-product section). It's global, but on a template that renders on only one page (an LP), global selectors like `.image-with-text__grid` affect just that page — safe.
- Section-scope with `#shopify-section-{{ section.id }} .selector { … }`.
- **Idempotent appends:** guard with a marker comment (e.g. `/* iwt-card */`) and `if marker in value: skip` before appending; PUT the concatenation.
- `assets/base.css` is **theme-wide** — scope carefully. CSS is CDN/browser-cached; **hard-refresh (Ctrl+Shift+R)** to verify (the asset `?v=` bumps on PUT). If a rule won't win, raise specificity or `!important` above the app's rule.

## 5. Reusable techniques (copy these patterns)
- **Price inside the buy button:** inject a span after the add-to-cart label in `snippets/buy-buttons.liquid` (all product buy buttons) + `snippets/card-product.liquid` (cards): `<span … style="text-transform:none;font-weight:700;"> &middot; {{ product.price | money_without_trailing_zeros | replace: 'R$ ', 'R$' }}</span>`. `text-transform:none` keeps `R$` uppercase on lowercase buttons. Scripts: `_buybutton_price.py`, `_card_price_v2.py`, `_price_no_trailing_zeros.py`.
- **Hide the standalone card price** once it's in the button: `.card-wrapper:has(.gb-card-price) .price{display:none !important;}` — the `:has()` guard hides it ONLY where the in-button price exists, so cards without a quick-add keep their price.
- **Beige card for image-with-text:** `.image-with-text__grid{background:#ecede9 !important;border-radius:20px;overflow:hidden;padding:24px;align-items:center;}` + transparent inner `.image-with-text__media`/`__content`. Mobile full-bleed image: `@media(max-width:749px){.image-with-text__grid{padding:0}…content padding 16px}`. Desktop full-bleed (image fills its column): `@media(min-width:750px){.image-with-text__grid{padding:0;align-items:stretch}.image-with-text__media img{height:100%;width:100%;object-fit:cover}.image-with-text__content{padding:32px}}`.
- **Button "dent" fix:** make the fill's radius match the `::after` ring — `.product-form__submit{border-radius:var(--buttons-radius,40px) !important;}` (fill was 4px vs a 40px pill ring → corner gap).
- **Remove click-to-zoom** on a featured-product section: set its native `image_zoom` setting to `"none"` (don't CSS-hack it).
- **Swap a section type in place:** redefine `tpl['sections'][key]` with a new `type` (e.g. `multicolumn` → `tabs`); leave `order` untouched. The `tabs` section renders ordered/unordered rich-text lists as numbered circles / star bullets automatically.
- **Duplicate a file (give a section its own image):** `fileCreate` with `originalSource` = the existing file's CDN URL (Shopify re-fetches it), poll `fileStatus` until `READY`, then set the new MediaImage gid on the target metafield. Script: `_dup_problem_image.py`.

## 6. Reusable scripts (`gebeauty/scripts/`)
- `_copy_pdp_sections_to_lp.py` — replicate metaobject subfields → page metafields, bind sections, copy static sections.
- `_wire_lp_texts.py` / `_bind_lp_texts.py` — create page-metafield defs+values (incl. HTML→rich_text AST converter) + bind section settings.
- `_dup_problem_image.py` — fileCreate-from-URL duplicate + wire to a metafield.
- `_update_antes_titulo.py` — edit a value in both a product metaobject and a page metafield.
- `_buybutton_price.py`, `_card_price_v2.py`, `_price_no_trailing_zeros.py` — price-in-button.
- `_swap_benefit_icons_transparent.py` — batch-swap product file_reference metafields (reads a mapping, dry-run by default, `apply` to write).
- `_build_primer_cachos_lp_native.py` — original LP build. **FROZEN, do not re-run.**

## 7. Gotchas checklist
- Verify `role == main` before editing (cache-bust can swap the live theme).
- 422s are specific — read the message rather than guessing.
- CSS not showing? CDN/browser cache — hard-refresh; confirm you edited the live theme.
- `rich_text_field` = JSON AST, not HTML. `url` metafield = absolute URL.
- Confirm before any store mutation (theme write, metafield set) per `gebeauty/CLAUDE.md`.
