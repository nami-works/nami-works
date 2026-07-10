# GE Beauty — Metafield & Metaobject Cleansing Map

**Date:** 2026-06-24 · **Store:** ge-beauty-cosmeticos · **Scope:** products, collections, pages
**Method:** Admin API definition counts (`metafieldsCount` / `metaobjectsCount`) cross-referenced with a full theme scan (540 assets) for what's actually rendered. Read-only — nothing changed.

## Inventory at a glance

| Layer | Count | Notes |
|---|---|---|
| Product metafield definitions | 65 | 29 `custom.*` + 26 `shopify.*`/system + 10 app/ERP |
| Collection metafield definitions | 17 | all `custom.*` |
| Page metafield definitions | 17 | all `custom.*` |
| Metaobject definitions | 32 | **13 custom** + 19 `shopify--*` system taxonomy |

**Scope rule:** `shopify.*` metafields and `shopify--*` metaobjects are Shopify's standard product taxonomy — driven by product category, not safely deletable. App/integration namespaces (`loox`, `reviews`, `judgeme`, `mm-google-shopping`, `mc-facebook`, `fullcomm`, `littledata`, `subscription`, `shopify--discovery`, `global`, `seo`) are owned by their apps. The cleansing target is **`custom.*` (+ the stray `como_usar.*`) metafields and the 13 custom metaobjects.**

---

## TIER 1 — REMOVE: dead features (scaffolded, never populated)

These are full features wired into the theme but with **zero product data** — they render empty everywhere. Highest-value, lowest-regret removals.

| Feature | Metafield (usage) | Metaobject (entries) | Theme | Verdict |
|---|---|---|---|---|
| **"Como usar" slider** | `como_usar.slider` — **0 products** | `como_usar_slide` — 3 entries | 1 template reads it | Remove all 3 layers. Built, never wired to a product. (Note: a separate `descricao_longa.passo_a_passo` already carries how-to.) |
| **"Ingredientes com foto"** | `custom.ingredientes_com_foto` — **0 products** | `ingredientes_com_descri_o` — 2 entries | **13 templates** read it | Remove. Redundant with `descricao_longa.ingredientes` (text, 62 products). ⚠️ 13 templates reference it → theme cleanup needed alongside. |
| **Disclaimers** | none references it | `disclaimers` — 1 entry | not rendered | Remove. Orphaned metaobject, no metafield, no theme use. |

---

## TIER 2 — REMOVE: unused custom definitions (count = 0)

Safe deletes — defined but never filled, minimal/no theme reliance.

| Owner | Metafield | Theme refs | Note |
|---|---|---|---|
| Product | `custom.combinacao_de_precos` | none | unused |
| Product | `custom.range_preco` | none | unused |
| Product | `custom.datepresale` + `custom.ispresale` | datepresale in 2 templates | **Pre-sale feature, dormant** (0 products). Decision: keep if pre-sales planned (there's also a `produto_pre-venda` template), else remove both. |
| Collection | `custom.link_banner_1` | 1 template | unused |
| Page | `custom.produto_em_destaque_5` | none | unused (the _1.._4 series is used; _5 never) |

**Flag, do NOT unilaterally delete (app/ERP-owned):**
- `fullcomm.*` — 7 fiscal fields all at 0 (`cfop`, `cofins_situacao_tributaria`, `icms_aliquota`, `icms_origem`, `icms_situacao_tributaria`, `origem_produto`, `pis_situacao_tributaria`). FullComm/ERP namespace; fiscal data likely comes from Omie, not Shopify. Confirm with ERP owner before removing. (`fullcomm.ncm` IS used — 38 products — keep.)
- `mm-google-shopping.custom_product` (0), `shopify--discovery--product_search_boost.queries` (0) — app/system; remove via their app UI, not here.

---

## TIER 3 — MERGE / DEDUPE: the etiqueta sprawl (biggest mess)

**76 `etiqueta` entries exist; only 5 are currently applied to any product** (`lançamento` ×8, `best seller` ×6, `mais pedido` ×3, `R$17 OFF` ×1, `R$59 off` ×1). The other 71 break down as:

| Bucket | ~Count | Recommendation |
|---|---|---|
| **R$-off badges** (`r-14-off` … `r-104-off`, `r10-off` … `r110-off`) | ~40 | Campaign auto-badge library. **Two inconsistent handle formats** (`r-XX-off` vs `rXX-off`) with value overlaps (e.g. `r-20-off` & `r20-off` both "R$20 off"). Standardize ONE format; collapse duplicates. Keep only if a script applies these during sales — confirm. |
| **%-off badges** (`3/5/10/15/16/20/25/30-off` + `*-percent-off`) | 11 | **Duplicates:** three "15% off" (`14-percent-off`, `15-off`, `15-percent-off`); two "10% OFF" (`10-off`, `10-percent-off`). Dedupe to one per value. |
| **Conditional/gift** (`compre-e-ganhe*`, `compre-199/300-e-ganhe`, `ganhe-*`, `10-off-com-*`) | 10 | Campaign library; keep a minimal consistent set. |
| **Social proof** (`mais-vendido`, `mais-pedido`, `best-seller`, `preferido`, `*-mil-vendidos`) | 7 | **Overlap + errors:** `preferido` texto is "13% off" (handle/label mismatch — error-inducing). `58-mil-vendidos`→"+60 mil", `50-mil-vendidos`→"+53 mil" (handle/text drift). Pick ONE social-proof vocabulary (currently only `best-seller` + `mais-pedido` are live). |
| **Status** (`esgotado`, `pre-venda`, `edicao-limitada`, `frete-gratis`, `ja-disponivel`) | 5 | Keep the ones tied to real states; `ja-disponivel` ("back in stock") just unlinked this week. |
| **Junk** (`teste`) | 1 | Delete. |

**Target:** prune 76 → ~15-20 (active vocabulary + one clean, consistently-named campaign set). This is where "doubling work / induce errors" bites hardest — duplicate and mislabeled badges are a live risk.

---

## TIER 4 — MERGE / CLARIFY: overlapping metafields

| Overlap | Detail | Recommendation |
|---|---|---|
| **How-to (in `descricao_longa`)** | `modo_de_uso` (37 products filled) vs `passo_a_passo` (the tab the theme actually renders). `modo_de_uso` only rendered by the unused `produto-brinde` template → **orphaned**. | Drop `modo_de_uso` field; keep `passo_a_passo`. (Migrate any unique kit content first — some kits have `modo_de_uso` but empty `passo_a_passo`.) |
| **Collection banners** | `banner_1`/`banner_1_mb` (12) vs `banner_desktop`/`banner_mobile` (4) — two parallel banner systems. Theme also reads undefined `banner_2`/`banner_2_mb`. | Pick ONE convention; migrate the minority; drop the other + the undefined refs. |
| **Hair type** | `custom.tipo_de_cabelo` (text list, 9) duplicates `shopify.hair-type` (taxonomy, 9). | Consolidate to one source (keep `custom` for the "Busca Home" filter set, or migrate filter to taxonomy). |
| **Benefits** | `custom.caracteristicas` (rich bullets, 62) vs `custom.beneficio_em_destaque_1/2/3` + 3 images (~21). | Likely **keep both** (full bullet list vs 3 hero benefits w/ icons — different placements), but document the split so they aren't confused/double-filled. |
| **`custom.finalidade` naming** | key = `finalidade` (implies "product purpose") but label + actual use = "tagline para home" (62 products). | Rename/relabel for clarity — not a deletion. Prevents future misuse. |

---

## TIER 5 — SYSTEM NOISE (review upstream, don't delete defs)

- **Irrelevant taxonomy metafields** at count=1, from product category mis-assignment: `shopify.fabric`, `shopify.shape`, `shopify.accessory-size`, `shopify.suitable-space`, `shopify.material` (these belong to apparel/furniture categories, not hair care). Fix the offending product's **category**, and these disappear — don't delete the definitions.
- **Undefined metafields referenced in theme** (no product/collection/page definition): `custom.banner_2`, `custom.banner_2_mb`, `custom.custom_label`, `custom.discount_value`, `custom.link_banner_2`, `custom.produto`. Theme cruft that renders empty — clean when next editing those templates.

---

## Suggested execution order

1. **Tier 1 + Tier 2 (safe deletes)** — dead features and zero-use defs. Lowest risk, immediate simplification. (Tier 1 "ingredientes com foto" needs paired theme edits across 13 templates.)
2. **Tier 3 etiqueta dedupe** — highest error-reduction value; start with junk + duplicates + mislabeled, then decide the campaign-library policy.
3. **Tier 4 merges** — each needs a small migration (move data to the surviving field) before dropping the loser.
4. **Tier 5** — category fixes + theme cruft, opportunistic.

**Product decisions needed from you:** (a) pre-sale feature — keep or kill? (b) etiqueta R$/%-off library — script-generated during sales, or stale? (c) which banner convention is canonical? (d) social-proof badge: one vocabulary — which?
