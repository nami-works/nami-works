# Theme budget, cut specs, and video placement

Target: `templates/page.lp-multi-product.json` on main theme **181379236160**. Shared by `/pages/nossos-boosters`, `/pages/lp-e4fa5694b3a8` and the build-up LP. Everything below verified against the live theme 2026-07-31.

---

## Part 1 — Two platform limits that belong in the initiative

Neither is documented in `landing-page-replication.md`, and both produce misleading errors. I lost three write attempts to them.

### The 100-dynamic-source ceiling per template file

A JSON template setting may hold either a literal or a **dynamic source** — a Liquid binding resolved at render, e.g. `"image": "{{ page.metafields.custom.carrossel_1.value }}"`. Shopify caps **100 per template file**, validated on write:

```
422  "Template has more than the maximum 100 dynamic sources allowed."
```

Properties that make it bite:

- **Per file, not per page.** All pages sharing a template share one budget.
- **Counts bindings, not distinct keys.** The same metafield bound across 8 card sections costs 8.
- **All bindings count**, not only metafields. Metaobject and resource bindings count too.
- **Raw Liquid inside a `custom_liquid` setting is exempt** — it is a string the section renders, not a registered binding. This is the escape hatch.
- The error names no setting, so it reads like a settings bug. Count first, don't guess.

Measured state at the time of writing:

| template | dynamic sources | note |
|---|---|---|
| `lp-multi-product` | 69 → **79** after the native slideshow | was 90, cut 1 freed 21 |
| `lp-acquisition` | **90 / 100** | same 48-binding benefit strip; equally boxed in |
| `lp-single-product` | 46 / 100 | roomy |

**`lp-acquisition` is the r95 template.** It will hit this wall the moment anything native is added, and it is next in line for revamp.

### `slideshow` allows a maximum of 5 blocks

```
422  "Block count exceeds maximum of 5 for section 'carrossel'."
     "Block type 'slide' cannot be used more than 5 times."
```

Any carousel of more than 5 slides cannot use the native `slideshow` section. Options are to cut to 5, use two stacked slideshows, or fall back to custom Liquid.

### Also confirmed: the double-hop restriction applies in raw Liquid

The initiative frames `page → product → field` as a dynamic-source restriction. It also fails in raw Liquid: `kit.url` resolves off a metafield-referenced product, `kit.metafields.custom.…` returns blank. Any product metafield needed inside a page-level section must come from its own single-hop page metafield (`passo_N_produto`), not by hopping through another reference.

---

## Part 2 — Where the budget goes

Before cut 1, the 90 sources broke down as:

| what | cost | share |
|---|---|---|
| benefit icon strip across the 8 card slots | **48** | 53% |
| `trust` static brand-icon strip | 12 | 13% |
| page-level content (hero, intro, faq, colecao, produtos) | 30 | 33% |

The benefit strip is six bindings per card — `beneficio_em_destaque_1..3` and `imagem_beneficio_em_destaque_1..3` — repeated per slot. The initiative describes these as riding "for FREE" off the product context. They are free of *per-page setup*, not free of *budget*: they were over half the template's ceiling.

### Cut 1 — DONE 2026-07-31

Removed card slots 6, 7 and 8. Freed **21** (90 → 69). Usage audit first: boosters uses slots 1-5, travel-size 1-3, build-up 1; slots 6-8 were empty on all three and rendered nothing. Backup: `BACKUP_precut1_page.lp-multi-product.json`, reversible via `cut1_trim_card_slots.py --restore`.

The freed budget was spent immediately on the native `slideshow` carousel (+10), leaving **79/100**.

---

## Part 3 — Cut 2 spec: benefit strip → one `custom_liquid` block

**Owner:** `design-engineer`. **Frees:** up to 48. **Risk:** medium, touches how every card renders on three live pages.

### Current

Each `card_N` (a `featured-product` section) carries an `icon-with-text` block whose six settings are individually bound:

```
image_1   {{ section.settings.product.metafields.custom.imagem_beneficio_em_destaque_1.value }}
heading_1 {{ section.settings.product.metafields.custom.beneficio_em_destaque_1.value }}
… ×3
```

Six bindings × 8 slots (now 5) = 48 (now 30).

### Target

Replace that block with one `custom_liquid` block per card, looping the same three product metafields in raw Liquid. `featured-product.liquid` aliases `product = section.settings.product` at line 31, so both `product.…` and `section.settings.product.…` resolve inside it.

```liquid
{%- assign p = section.settings.product -%}
{%- assign has = false -%}
{%- for i in (1..3) -%}
  {%- assign tk = 'beneficio_em_destaque_' | append: i -%}
  {%- if p.metafields.custom[tk] != blank -%}{%- assign has = true -%}{%- endif -%}
{%- endfor -%}
{%- if has -%}
  <ul class="gbben" role="list">
  {%- for i in (1..3) -%}
    {%- assign tk = 'beneficio_em_destaque_' | append: i -%}
    {%- assign ik = 'imagem_beneficio_em_destaque_' | append: i -%}
    {%- assign t = p.metafields.custom[tk] -%}
    {%- if t != blank -%}
      <li class="gbben__i">
        {%- assign img = p.metafields.custom[ik].value -%}
        {%- if img != blank -%}
          <img src="{{ img | image_url: width: 160 }}" alt="" width="80" height="80"
               loading="lazy" decoding="async">
        {%- endif -%}
        <span>{{ t.value }}</span>
      </li>
    {%- endif -%}
  {%- endfor -%}
  </ul>
{%- endif -%}
```

### Acceptance criteria

1. Icon size and label styling match today's render at 60px base / 80px desktop (the parity fix logged 2026-07-08). Compare screenshots before and after on all three pages.
2. Cards with only 1 or 2 benefits set render without gaps.
3. Cards with no benefits render nothing, no empty list.
4. Dynamic-source count drops by 6 per card; verify with the counter in `cut1_trim_card_slots.py`.
5. `nossos-boosters` and `lp-e4fa5694b3a8` visually unchanged.

### Trade-off to accept explicitly

These six settings stop being customizer-editable. In practice nobody edits them per page because the values come from the product, but this is a governance decision, not a purely technical one. It is also the single largest budget win available.

---

## Part 4 — Cut 3 spec: `trust` strip → `custom_liquid`

**Owner:** `design-engineer`. **Frees:** 12. **Risk:** low.

Four brand icons bound as 4 metaobjects × `imagem` / `texto` / `link`:

```
{{ metaobjects.icones["formulas-limpas"].imagem.value }}   … ×3 each
formulas-limpas · nao-testado-em-animais · produtos-veganos · embalagens-reciclaveis
```

Identical on every page and every LP. Twelve dynamic sources for four static icons is the worst value in the file.

Replace with one `custom_liquid` section looping a hardcoded handle list:

```liquid
{%- assign handles = 'formulas-limpas,nao-testado-em-animais,produtos-veganos,embalagens-reciclaveis' | split: ',' -%}
{%- for h in handles -%}
  {%- assign ic = metaobjects.icones[h] -%}
  {%- if ic != blank -%}
    …render ic.imagem.value, ic.texto.value, ic.link.value…
  {%- endif -%}
{%- endfor -%}
```

**Acceptance:** identical render on all three pages; count drops by 12.

**Note:** hardcoding handles in the template is acceptable here precisely because the strip is brand-static. If a page ever needs a different trust set, promote the handle list to a page metafield (1 binding, not 12).

---

## Part 5 — Video placement

Two MP4s exist, both 1080×1350: `CARROSSEL_HAIRCARE3.mp4` (3.1s, 1.9 MB) and `CARROSSEL_HAIRCARE5.mp4` (14s, 6.2 MB). Both are already represented as still frames in the carousel (slides 3 and 5).

Vehicle: **`sections/video.liquid`**, which is native and customizer-editable and takes `video` (Shopify-hosted), `cover_image`, `enable_video_looping`, `heading`, `description`. Using `cover_image` keeps it off the LCP critical path.

### Recommendation: ship video 5 only, between `passos` and `card_1`

**Why there.** The page currently argues the problem thoroughly and then asks for R$259 without ever showing the product in use. The three numbered steps are abstract (limpa / nutre / refresca). Video 5 shows the bottle, the pump and hands lathering — product-in-action at exactly the moment the visitor is deciding. It also fills the body-imagery gap.

Recommended settings: looping on, cover image = the still already uploaded as slide 5, heading left blank (the section above already carries the argument), `full_width` off to match the contained carousel.

**Why not video 3.** It duplicates carousel slide 3 exactly — same copy, same mechanism beat — and adds 1.9 MB for no new information. If motion is wanted earlier, the better experiment is video 3 as a hero background, not a second inline section. Hold it.

**Why not both.** Their publish gate requires LCP under 2.5s. One 6.2 MB below-the-fold video with a poster is manageable; 8.1 MB across two sections is not.

### Blocking caveat on this asset

Slide/video 5 carries two copy errors: a duplicated opening line ("para obter brilho, volume e maciez não devemos" appears twice, the first time truncated) and **"GE BEAUY"** missing its T. They persist for the full 14 seconds, so they are in the source file, not a frame artifact. The same asset is live on Instagram.

This is already displayed on the page as carousel slide 5. The page's own HTML copy carries the solution argument correctly via the `oquesao` pills, so the argument survives, but the image repeats it with errors. **Get the source fixed before paid spend points here.** Do not re-render the text locally — the initiative's own §3e records that a PIL re-render was rejected as off-brand; the fix belongs in the original Canva design where the correct brand font lives.

---

## Order of work

1. ~~Cut 1~~ done, freed 21.
2. Fix the slide-5 copy errors at source (design), then re-export slide 5 and the video.
3. Add video 5 via `sections/video.liquid` between `passos` and `card_1` (costs 0 dynamic sources if the video is picked directly rather than bound to a metafield; costs 1 if bound for per-page reuse — bind it, the template is shared).
4. Cut 3 (low risk, frees 12).
5. Cut 2 (largest win, needs before/after QA on three pages).
6. Apply cuts 2 and 3 to `lp-acquisition` as well, before the r95 revamp needs headroom there.
