# GE Beauty — Landing Page Composite Metaobjects

How the 4 core LP (landing page) Shopify page templates are structured after the 2026-08 metafield-to-metaobject consolidation. Read this before touching any `page.lp-*.json` template or its data. Companion doc: `docs/gebeauty-theme-customization.md` (general theme/asset-API mechanics, dynamic-source rules).

**Why this exists:** the templates originally accumulated dozens of flat, duplicated page-level metafields (`produto_em_destaque_1-5`, `colecao_em_destaque_1-4`, `banner_desktop`, `intro_ponto_1-4`, `antes_foto`/`depois_foto`, `tab_como_usar`/`tab_resultados`/`tab_saiba_mais`, etc.) — much of it re-entering data that already existed elsewhere (a product's own description, a shared banner image). This doc describes the result of consolidating that into: (a) shared metaobjects for genuinely shared content, (b) one composite metaobject per template for template-specific content, and (c) direct product-metafield binding wherever page-level duplication added nothing.

## 1. The four templates

| Display name | Template file | Pages (2026-08) |
|---|---|---|
| LP kits e rotinas | `templates/page.lp-kits-e-rotinas.json` | `fios-leves-sem-acumulo`, `rotina-certa-cabelo-saudavel`, `scalp-care-o-novo-skincare`, `fios-fortes-mesmo-no-frio` |
| LP multi produtos | `templates/page.lp-multi-produtos.json` | `nossos-boosters`, `lp-e4fa5694b3a8`, `o-seu-finalizador-ideal` |
| LP produto único | `templates/page.lp-produto-unico.json` | `primer-cachos-definidos`, `primer-liso-intacto` |
| LP aquisição e promo | `templates/page.lp-aquisicao-e-promo.json` | `lp-n4ga7384b3y3`, `lp-f358qoslxv` |

A 5th template, `templates/page.lp-boosters.json` (1 page: `landing-page-boosters`), exists but is **out of scope** — never folded into this system.

Each template has a matching **composite metaobject type**, bound to the page via one PAGE metafield: `custom.lp_kits_e_rotinas`, `custom.lp_multi_produtos`, `custom.lp_produto_unico`, `custom.lp_aquisicao_e_promo` (all `metaobject_reference`, one entry per page). Metaobject definition display names mirror the template names exactly ("LP kits e rotinas", etc.) for 1:1 recognizability in the admin.

## 2. Composite field maps

### LP kits e rotinas (type `lp_kits_e_rotinas`)
| Field key | Type | Feeds |
|---|---|---|
| `kit_principal` | product_reference | Both the mid-page "kit principal" featured-product card and the closing "kit principal (fechto)" card — same product, two cards |
| `titulo_colecao_principal` | single_line_text | "coleção principal" featured-collection heading |
| `colecao_principal` | collection_reference | same section's collection |
| `titulo_colecao_upsell` | single_line_text | "coleção upsell" heading |
| `colecao_upsell` | collection_reference | same section's collection |
| `fechamento` | single_line_text | the "fechamento" `lp-titulo` section heading |

### LP multi produtos (type `lp_multi_produtos`)
| Field key | Type | Feeds |
|---|---|---|
| `produto_principal_1`…`produto_principal_5` | product_reference ×5 | the 5 individual featured-product cards |
| `titulo_colecao_kits_relacionados` | single_line_text | "coleção kits relacionados" heading |
| `colecao_kits_relacionados` | collection_reference | same collection, reused by **both** the mid-page block and the closing "(fechto)" block |
| `abertura_produtos_principais` | single_line_text | the opening `lp-titulo` section heading |

### LP produto único (type `lp_produto_unico`)
| Field key | Type | Feeds |
|---|---|---|
| `produto_principal` | product_reference | **Everything on this template**: `buy` section, "produto principal (fechto)" closing section, Loox review carousel + Loox snippets widget, the `ingredients` custom-liquid script, the `before_after` block, and all 3 `tabs.liquid` blocks (como usar / resultados / saiba mais) |
| `problema_e_solucao` | metaobject_reference → `problema_e_solucao` type | `problem`/`solution` sections (image + heading + body, both sides) |

This composite is thin by design — everything else on this template (tabs, before/after, ingredients) binds **directly to the product itself** via `section.settings.product`/`block.settings.product`, not through a page-level copy. No duplication needed.

### LP aquisição e promo (type `lp_aquisicao_e_promo`)
| Field key | Type | Feeds |
|---|---|---|
| `produto_principal_1`…`produto_principal_5` | product_reference ×5 | the 5 `card_N` featured-product sections |
| `titulo_colecao_promocional` | single_line_text | "coleção promocional" heading |
| `colecao_promocional` | collection_reference | same section |
| `gift_mode` | boolean | drives the `giftprice` custom_liquid block on every card (hides normal price, shows "R$0,00 · 1 unidade grátis") |
| `gift_code` | single_line_text | the discount code auto-applied via the `giftapply` section's cart script when `gift_mode` is on |
| `promo_price_mode` | boolean | drives the `promoprice` custom_liquid block on every card (shows the struck-through/promo price pair) |
| `promo_code` | single_line_text | the discount code auto-applied via `giftapply` when `promo_price_mode` is on |

## 3. What stays flat on purpose (not migrated)

- **`produto_em_destaque_1`** — kept as a field *definition*, but its **value is explicitly cleared/unused on all 11 pages above**. It remains load-bearing for one unrelated template, `page.composicao-produto.json`. Never re-fill it on any LP page — every binding that used to read it now reads the composite's own product field instead.
- **`colecoes_destaque`** (metaobject type + PAGE field) — kept alive because `page.promo.json` (out of scope) still uses it. The old per-page entries that used to back the 4 LP templates are now orphaned (harmless, unreferenced) — not pruned since deleting them provided no functional benefit and risked an ID mixup with `page.promo.json`'s own entries.
- **`promo_note`** — real, live, unrelated to this migration. Feeds the `lppromo__note` line under the promo-price card (`page.metafields.custom.promo_note.value | default: '…'`). Untouched.
- **`hero_heading` / `hero_subheading` / `faq_titulo` / `tab_1_label`* / `colecao_descricao`** — simple per-page free-text copy, not duplicated/reusable data. Left as standalone PAGE fields; migrating them would add indirection without removing any redundancy.
  - *`tab_1_label`/`tab_2_label`/`tab_3_label` **were** deleted — see §4, they became coded logic instead of a field.

## 4. Tab-label logic (no longer a metafield)

`snippets/product-descricao-tabs.liquid` — the shared kit/product-card tabs widget rendered on every featured-product card across all 4 templates — used to read per-page override metafields (`custom.tab_1_label` etc.) with hardcoded Portuguese fallbacks. Auditing live data showed only 3 of 11 pages had a genuine deviation from the default, and the pattern was a **product-category** decision, not a true per-page one. Replaced with coded logic in the snippet itself:

```liquid
{%- assign tab1_label = 'como usar' -%}
{%- assign tab2_label = 'resultados' -%}
{%- assign tab3_label = 'saiba mais' -%}
{%- if product.tags contains 'booster' -%}
  {%- assign tab1_label = 'como combinar' -%}
  {%- assign tab2_label = 'resultado' -%}
{%- elsif product.type == 'kit' -%}
  {%- assign tab1_label = 'a rotina' -%}
{%- endif -%}
```

Note: Liquid's product type property is `product.type`, **not** `product.product_type` (that's the GraphQL Admin API field name, easy to confuse). A booster is any product tagged `booster`; a kit is any product with `product.type == "kit"`. This unified wording across all kit-type products site-wide (kits-e-rotinas' `kit_principal` now also says "a rotina", matching aquisição's kit cards — previously it said the generic "como usar"). `tab_1_label`/`tab_2_label`/`tab_3_label` PAGE field definitions are deleted; any future wording exception should extend this Liquid branch, not reintroduce a page metafield.

## 5. The direct-to-product binding pattern

Established while eliminating `tab_como_usar`/`tab_resultados`/`tab_saiba_mais` page-level duplication (content that already lived on the product's own `custom.descricao_longa_com_abas` metaobject): give the **section or block** its own `product`-type setting (mirroring Dawn's native `tab_kit` block), then bind via `section.settings.product.metafields.custom.X` / `block.settings.product.metafields.custom.X`. This is a valid single-hop dynamic source (page→product→field triple-hops are always rejected — see `docs/gebeauty-theme-customization.md` §3). Reused for:
- `sections/tabs.liquid` block types `tab_como_usar`/`tab_resultados`/`tab_saiba_mais`
- `sections/section-before-after.liquid` block type `result_produto` (reads the product's own `custom.antes_e_depois` metaobject — `foto_antes`/`foto_depois`/`t_tulo`/`resultados`)

Both patterns exist alongside their original manual-entry block types (`tab`/`tab_kit`, `result`) for non-LP sections that still want manual content.

## 6. Gotchas specific to this system

- **`gift_mode`/`promo_price_mode` are checked directly inside `custom_liquid` blocks** (`giftprice`/`promoprice`) duplicated on every featured-product card, not just via the `giftapply` section script. If you ever touch these fields again, grep for `page.metafields.custom.gift_mode`/`promo_price_mode` across **all 4 templates**, not just aquisição-e-promo — the same dead-but-harmless checks exist on kits-e-rotinas/multi-produtos cards too (always false there, no data ever set, by design — cortesia/promo fields only belong on the aquisição-e-promo composite).
- **Before deleting any PAGE field definition**, grep every theme asset (templates + sections + snippets), not just the templates you're actively working on — `produto_em_destaque_1`, `colecoes_destaque`, and `promo_note` all looked locally-dead inside one template but were load-bearing elsewhere (Loox app-block settings, `page.composicao-produto.json`, `page.promo.json`). `metafieldDefinitionDelete(deleteAllAssociatedMetafields: true)` is irreversible.
- **Metaobject entries default to DRAFT** unless created with `capabilities: {publishable: {status: "ACTIVE"}}` — a draft entry renders blank with no error. If a definition wasn't created with the capability enabled, run `metaobjectDefinitionUpdate` with `capabilities: {publishable: {enabled: true}}` first.
- Test schema/liquid changes on the `[GBCC] Testes` theme first (use `?view=<new-template-suffix>` to preview an alternate template suffix without touching the live page's actual assignment), then push to the live `[Check] - Produção` theme and re-verify.
