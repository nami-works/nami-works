# GE Beauty website icon standard (the locked spec)

This is the **canonical standard** every icon `/iconographer` ships must match. It was
reverse-engineered from the four institutional icons live on the GE Beauty storefront
(the `icones` metaobject set): `noun-organic-3801980_1.svg` (fórmulas limpas),
`icon-nao-testado-em-animais.svg`, `icon-vegano.svg`, `icon-100-reciclavel.svg`.

New icons must be **drop-in siblings** of that family — same canvas, weight, and
register — so a page mixing old and new icons reads as one set. When in doubt, open the
four reference SVGs and match what you see; this doc is the summary, the files are the
truth.

## Canvas

- `viewBox="0 0 51 51"` — square. Keep `width="51" height="51"` for exact parity (viewBox
  is what actually governs scale; the attrs just mirror the family).
- Root `<svg>` carries `fill="none"`; all painting happens on child `<path>` elements.
- Content sits centered with modest padding — the family fills roughly the inner
  ~44 of the 51 box, never bleeding to the edge.

## Construction

- **Outline-as-fill, NOT stroke.** The family draws linework as thin *filled* shapes
  (the noun-project convention). There are no `stroke` attributes anywhere. Match this:
  express outlines as closed filled paths, not `stroke-width` lines.
- **One even line weight** throughout, delicate — roughly 1.2–1.6 units at the 51 grid.
  No thick/thin modulation, no calligraphic contrast.
- Rounded, organic terminals and joins. The register is **illustrative / botanical /
  hand-drawn**, not geometric-grid-strict, not corporate-flat. It should feel like the
  same hand drew it.
- Flat and single-color. **No** gradients, shadows, highlights, multiple tones, or
  photorealism.

## Color (this is where the new standard IMPROVES on the family)

- The **master** SVG paints with `fill="currentColor"` so CSS controls the color.
- The legacy family hardcodes `fill="#DF3630"` (GE Red) because it is consumed as an
  `<img>` — and **`<img src="…svg">` ignores `currentColor`** (the SVG renders with its
  own internal fill; the document's `color` never reaches it). So every icon ships as a
  **pair**:
  1. `icon-<name>.svg` — the GE-red baked variant (`fill="#DF3630"`), the drop-in for the
     current `<img>`/metaobject embed path. This is what goes live today.
  2. `icon-<name>.currentcolor.svg` — the themeable master (`fill="currentColor"`), for
     any future context that **inlines** the SVG or uses it as a CSS `mask-image`.
- GE Red is `#DF3630` (memory `project_gebeauty_design_system`). Never introduce a second
  color unless the concept genuinely requires it (e.g. a two-state mark) and Lucas okays it.

## Content rules

- **No lettering or wordmarks inside an icon** — no brand name, product name, or on-pack
  text (memory `feedback_magnific_no_brand_text`; AI re-letters garbage). The one
  exception is when a number/symbol IS the mark itself (the family's "100" recyclable
  glyph); keep those crisp and legible, nothing else.
- Say it with **one clear metaphor**. If a concept needs a caption to be read, the icon
  isn't working — redraw, don't annotate.

## Acceptance (an icon is "on-standard" only if ALL pass)

1. Renders cleanly at **48px and 24px** — linework holds, nothing turns to mush at 24.
2. Sits beside the four reference icons and reads as the **same family** (weight, padding,
   register) — do the side-by-side, don't eyeball in isolation.
3. `viewBox="0 0 51 51"`, root `fill="none"`, no `stroke` attributes, no gradients.
4. Both color variants emitted; the currentColor master actually recolors when dropped
   inline and set to a test color.
5. Optically centered; consistent visual weight with the set.
6. No stray text, no clipped paths, no off-canvas geometry, valid single `<svg>`.
