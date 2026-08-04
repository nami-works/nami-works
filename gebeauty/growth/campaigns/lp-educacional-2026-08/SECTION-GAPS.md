# Section gaps for porting the 5 educational LPs onto `multi-product`

Verified against the LIVE published theme **181379236160 `[Check] - Produção`** on 2026-07-31 (role `main` confirmed). Nothing was written to the store.

Decisions locked with Lucas: base template **`multi-product`**, banners **in scope for me**, slugs **real and reachable** (these are not offer-heavy, so the obscure-slug pattern does not apply), missing sections **specced here for us to build together** rather than quietly adapted.

---

## First, three corrections to the initiative doc

The doc is stale on points that change the plan.

1. **The hero has TEXT metafields.** `hero` (slideshow) binds `hero_heading` and `hero_subheading`, both `single_line_text_field`, alongside `banner_desktop`/`banner_mobile`. The doc describes the hero as banner-image-only. **Consequence: the message-matched h1 does not have to be baked into the Canva render.** Banner scope drops from "10 renders carrying live copy" to "10 background plates with a clean type zone", and copy stays editable without re-exporting art. This is the single most useful thing the verification turned up.

2. **The sections were de-boostered.** The template references types **`lp-destaques`** and **`lp-titulo`**, not `boosters-oquesao` / `boosters-headline`. Both old liquid files still exist on the theme, so there are now two generations present. Worth a cleanup decision later; harmless today.

3. **Undocumented templates and fields exist.** Templates on the main theme include **`lp-acquisition`**, **`lp-boosters`** and **`promo`**, none of which the doc mentions. `promo_price_mode` (boolean) is bound on every product card and is undocumented. 69 PAGE metafield definitions exist; the doc's register covers about half.

Also: `templates/page.guia-boosters.json` is confirmed **gone**, so the 2026-07-31 rename completed cleanly.

Definition coverage for my build: **29/31 present**. The only two missing are `promo_note` and `promo_code`, both coupon fields I do not need because these pages sell the routine at full price. **No 422 risk.**

---

## The actual template

```
giftapply -> hero -> oquesao -> trust -> punchline
          -> card_1..card_8 -> promo -> kits_boosters -> faq
```

| section | type | bound page metafields |
|---|---|---|
| `giftapply` | custom-liquid | `gift_mode`, `gift_code` |
| `hero` | slideshow | `banner_desktop`, `banner_mobile`, **`hero_heading`**, **`hero_subheading`** |
| `oquesao` | `lp-destaques` | `intro_titulo`, `intro_ponto_1..4` |
| `trust` | icons-with-title | static brand icons, clones free |
| `punchline` | `lp-titulo` | `cards_titulo` |
| `card_1..8` | featured-product | `produto_em_destaque_N`, `tab_1..3_label`, `gift_mode`, `promo_price_mode` |
| `promo` | `lp-promo-icones` | `promo_icones` (falls back to a default trio) |
| `kits_boosters` | featured-collection | `colecao_titulo`, `colecao_descricao`, `colecao_em_destaque_1` |
| `faq` | faq | `faq_titulo`, `faq_1..4_pergunta/_resposta` |

---

## Gap analysis

My page structure against the template, in page order.

| # | my section | native slot | verdict |
|---|---|---|---|
| 1 | announcement bar (free shipping) | theme-wide | fits |
| 2 | hero: h1 + sub + CTA + image | `hero` + `hero_heading` + `hero_subheading` | **fits** |
| 3 | trust chips | `trust` | fits |
| 4 | **the answer** (4-5 numbered title + description pairs) | `oquesao` pills | **GAP A** |
| 5 | **mechanism** (3 cards, ingredient-as-proof) | definitions exist, section absent here | **GAP B** |
| 6 | offer block (routine kit) | `card_1` + `produto_em_destaque_1` | **fits**, and the kit's "itens do kit" tab renders the 3 components free |
| 7 | **free-shipping progress** (the R$40 lever) | none | **GAP C** |
| 8 | **social proof** (real Instagram comments) | none; Loox is reviews, not IG | **GAP D** |
| 9 | FAQ | `faq`, 4 slots, I need 3 | fits |
| 10 | **close CTA + tagline** | definitions exist, section absent here | **GAP E** |
| 11 | **sticky mobile buy bar** | none | **GAP F** |

Six gaps, but they are not equal. Two need **no new Liquid at all**.

### Cheap: add an existing section to this template, bind existing definitions

**GAP B — mechanism, 3 columns.** `ingredientes_titulo` and `ingrediente_{1,2,3}_titulo/_texto` all exist as PAGE definitions, and `landing-page` already renders them via `multicolumn-ingredients`. Adding that section to `multi-product` is a template edit, not new code.
> Caveat, your own open item from 2026-07-30: this section **renders empty on both live single-product LPs**. Pre-existing bug. It needs fixing before I rely on it, or I use a plain 3-column alternative.

**GAP E — close CTA.** `fechamento_titulo`, `fechamento_texto`, `fechamento_botao` all exist, and `landing-page` renders them as a rich-text close. Same fix: add the section to this template and bind.

### Needs new work

**GAP A — the answer section.** The highest-value gap, because this is what delivers the ad's promise before any selling. `lp-destaques` pills are `single_line_text_field`, one string each, capped at 4, unnumbered. My pages need 4 to 5 items, each a **short title plus a one-line explanation**, ideally numbered.
> Proposal: extend `lp-destaques` rather than build new. Add an optional `texto` per block (`inline_richtext`) and an optional `numerar` boolean on the section. Blank `texto` renders exactly as today, so the boosters and travel-size LPs stay byte-identical. This is the same backward-compatible pattern you used for `promo_note` with `default:`.
> Also needs `intro_ponto_5` plus five `intro_ponto_N_texto` definitions.

**GAP D — social proof.** Real Instagram comments, which is a different object to a Loox review. Simplest honest version: a section with N blocks of quote plus attribution, content from page metafields.
> Note: still gated on your decision about publishing real handles versus first names.

**GAP C — free-shipping progress.** A behaviour, not content: read `/cart.js`, show the gap to R$299, update on cart change. The travel-size LP has adjacent machinery (`cart-aware buttons`) but the progress bar there was **dropped**, so there is nothing to reuse. Needs `design-engineer`.

**GAP F — sticky mobile buy bar.** Also behaviour. Appears once the hero CTA scrolls out, mirrors the primary CTA. Needs `design-engineer`.

---

## What I recommend we do

Build **`efeito-build-up`** first as the reference page, using only what exists today, and treat A/D/C/F as a parallel theme workstream rather than a blocker:

- gaps **B and E**: include in page 1 if the `multicolumn-ingredients` bug is fixable quickly, otherwise fold the mechanism copy into `oquesao` temporarily and note it
- gap **A**: page 1 ships with the answer as plain pills, losing the per-step explanation. This is the compromise I least like and the first thing to fix
- gaps **C, D, F**: absent from page 1, listed here, added once and inherited by all five

That gets a real, reachable page in the theme with zero theme-code edits, proves the metafield path end to end, and gives us a concrete artifact to judge the section specs against instead of arguing them in the abstract.

## Resolved (Lucas, 2026-07-31)

### 1. Why `multicolumn-ingredients` renders empty — diagnosed

Your hypothesis was that the page metafield was not bound to the product's. Close, but the data side is clean: **the values are set and the bindings are correct.** Verified on both live LPs (`ingredientes_titulo`, `ingrediente_{1,2,3}_titulo/_texto` all populated, e.g. Cachos "Wavemax (chia e linhaça)", Liso "Allinea™"), and `page.landing-page.json` binds them properly with `.value` on titles and `| metafield_tag` on rich text.

The break is inside `sections/multicolumn-ingredients.liquid`. **Three nested gates all fail in a page context:**

| line | gate | why it fails here |
|---|---|---|
| 30 | `{% if product.metafields.custom.descricao_longa_com_abas.value.ingredientes != blank or product.metafields.custom.ingredientes_com_foto != blank %}` | wraps the **entire section**. On a page the global `product` object does not exist, so this is always false and nothing renders at all |
| 81 | `{% if block.settings.image != blank %}` | the template's three columns set only title/text/color_scheme/button_text. No image, so the card body never opens |
| 107 | `{% if block.settings.button_text != blank %}` | title and text are nested **inside** this. The template sets `button_text: ""`, so even past the other two gates the copy stays hidden |

So this is not a bug to patch. **It is the wrong section for the job.** It is a PDP component (image plus expand-button accordion, driven by the product's own ingredient metaobject), and it was never going to render page-driven text columns. Rewriting it to serve both contexts risks the PDPs.

**Recommendation: route around it.** Stock **`sections/multicolumn.liquid`** exists on the theme and renders title plus text without requiring an image or a button. Bind the same existing `ingrediente_*` page metafields to it. Zero new Liquid, zero PDP risk, and it also fixes the two live single-product LPs.
> Separately worth logging: this means the Cachos and Liso ingredient copy has been written, bound, and invisible on live pages. Not a blocker for me, but it is live-site content nobody is seeing.

### 2. Proof attribution — real handles, approved

Real Instagram handles ship as-is. Quotes stay verbatim from the five posts.

### 3. Page naming — benefit-led, slug derived

Per your rule, the page name states the main benefit and the slug follows from it.

| # | ad hook | page name (benefit) | slug |
|---|---|---|---|
| 1 | 5 passos para o cabelo mais saudável | **rotina para um cabelo mais saudável** | `/pages/rotina-cabelo-saudavel` |
| 2 | scalp care é o novo skincare | **couro cabeludo equilibrado** | `/pages/couro-cabeludo-equilibrado` |
| 3 | seu cabelo "acostumou" | **fios leves, sem acúmulo** | `/pages/fios-leves-sem-acumulo` |
| 4 | por que o cabelo cai no inverno | **fios mais fortes no inverno** | `/pages/fios-mais-fortes-no-inverno` |
| 5 | não sei qual finalizador escolher | **o finalizador certo para o seu cabelo** | `/pages/finalizador-certo` |

Note the deliberate split: the **page name and slug carry the benefit** (durable, indexable, reads well shared), while **`hero_heading` keeps the ad's exact words** for message match. Those two jobs are different and the template lets us serve both, since the heading is its own metafield.

### 4. SEO ownership — confirmed

Meta titles, descriptions and canonicals go to `content-director` via `marketing:seo-audit`. I will brief it once page 1 exists, so it has real rendered pages to work against rather than a spec.

## Remaining open

Nothing blocking page 1. Carrying forward:
- gap **A** (answer section with per-step explanation) is the compromise page 1 ships with, and the first thing to fix
- gaps **C**, **D**, **F** (free-ship progress, Instagram-proof section, sticky mobile CTA) need `design-engineer`; page 1 goes live without them
- the `lp-destaques` extension needs `intro_ponto_5` plus five `intro_ponto_N_texto` definitions created (ownerType PAGE) before it can bind
