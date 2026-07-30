# NAMI Works — Brand System

Canonical reference for the NAMI Works identity. This is the source of truth; the site (`src/`, `public/brand/`) implements it. A rendered visual companion lives in `brand-guide.html`. If code and this file ever disagree, fix the mismatch — don't let them drift.

For voice/copy rules see `CLAUDE.md` (§ Content & copy). This file covers the *visual* system.

## Positioning in one line

NAMI Works reads as a **quiet operator, not an AI-hype demo**. Deep ink on warm off-white, one restrained accent, one characterful mascot. The mark carries the personality; type, palette, and copy stay deliberately restrained around it. Don't let the mascot's energy justify loosening the voice or crowding the layout.

## The mark

A monkey-in-goggles mascot, drawn as clean line art. Loosely: monkey (primate = "natural") + goggles (augmentation = "artificial"), a soft nod to "Natural + Artificial Merged Intelligence." Treat that as flavor, not a story that must be retold.

### Two distinct assets — do not confuse them

This is the single most common mistake to avoid: **there are two different drawings, not one drawing at two sizes.**

| Asset | Use | Never |
|---|---|---|
| **Detailed mark** (`mark-*.png`) | Anywhere it renders at roughly 32px or larger: nav, headers, hero, print, social avatars | Never shrink below ~24px — the fine strokes turn to mud |
| **Simplified glyph** (`favicon-glyph*.png`) | Anywhere tiny: favicon, app icon, ≤24px chips | Never use as the primary logo at large sizes; it's intentionally reduced |

The wired favicon (`public/favicon.png`) is a copy of the simplified black glyph, **not** the detailed mark. Keep it that way.

### Colorways

All marks are transparent PNGs (RGBA), 1536×1536 master canvas, produced by color substitution on one master so they stay pixel-consistent.

| File | Color | Put it on |
|---|---|---|
| `mark-black.png` | Ink `#1c1b19`-black | Light / off-white backgrounds |
| `mark-teal.png` | Forest teal `#1f5c4e` | Light theme (this is the light-mode nav mark) |
| `mark-teal-dark.png` | Light teal `#4fa88f` | Dark backgrounds (dark-mode nav mark) |
| `favicon-glyph.png` | Black | Favicon / tiny, light contexts |
| `favicon-glyph-teal.png` | Teal | Favicon / tiny, when a teal tab icon is wanted |

Rule of thumb: **match the mark's accent tone to the theme** — `mark-teal` on light, `mark-teal-dark` on dark — because `#1f5c4e` is too dark to read on the dark surface and `#4fa88f` is too light to read on off-white. The nav does exactly this swap via CSS (`Nav.astro`, `:global([data-theme="dark"])`).

### Lockup

The logo is **mark + wordmark**: the detailed mark followed by "NAMI Works" set in Geist 600. The wordmark is live text, not an image — so it inherits the theme text color. In the nav the mark is 28px with a 10px gap to the wordmark at 16px/600. Keep the wordmark in the site font; never substitute a decorative face.

The mark may also stand alone (avatar, favicon, watermark) where the wordmark is redundant or won't fit.

### Clear-space & minimum size

- **Clear-space:** keep padding around the mark of at least **50% of the mark's height** on all sides — nothing (text, edges, other logos) intrudes. The master PNGs already carry ~37% internal canvas margin; that is *not* a substitute for layout clear-space.
- **Minimum size:** detailed mark ≥ **24px**; below that, switch to the simplified glyph.
- **Aspect:** the detailed mark's artwork is slightly taller than wide (~966×1050). Scale proportionally — never stretch to fill a square.

### Don'ts

Don't recolor the mark outside the five approved files. Don't add a drop shadow, gradient, or "holo/AI" glow. Don't place the mark on a busy photo without a solid backing. Don't put copy or the mark on top of a product or over another logo. Don't stretch, rotate, or outline it. Don't resize the detailed mark down to favicon size (use the glyph).

## Color

Tokens are defined once in `src/styles/global.css` as CSS custom properties and themed by `[data-theme]`. **Reference the token, never hard-code the hex** in components.

### Light (`:root`, `[data-theme="light"]`)

| Token | Hex | Role |
|---|---|---|
| `--site-bg` | `#faf8f4` | Page background (warm off-white) |
| `--site-surface` | `#f1ede4` | Cards, raised surfaces |
| `--site-text` | `#1c1b19` | Primary text (ink) |
| `--site-text-secondary` | `#6b6860` | Secondary / muted text |
| `--site-border` | `#ddd7c9` | Hairlines, dividers |
| `--site-accent` | `#1f5c4e` | Forest teal — CTAs, links, focus |
| `--site-accent-text` | `#ffffff` | Text on accent |
| `--site-nav-bg` | `rgba(250,248,244,0.86)` | Scrolled nav (blurred) |

### Dark (`[data-theme="dark"]`)

| Token | Hex | Role |
|---|---|---|
| `--site-bg` | `#161512` | Page background |
| `--site-surface` | `#1f1e1a` | Cards, raised surfaces |
| `--site-text` | `#f1efe8` | Primary text |
| `--site-text-secondary` | `#a6a299` | Secondary / muted text |
| `--site-border` | `#33322c` | Hairlines, dividers |
| `--site-accent` | `#4fa88f` | Light teal — CTAs, links, focus |
| `--site-accent-text` | `#0d1310` | Text on accent |
| `--site-nav-bg` | `rgba(22,21,18,0.86)` | Scrolled nav (blurred) |

No purple, no blue, no gradient accents — those belong to the sibling `omnify-site` and must never cross over.

## Typography

**Geist** (variable, weights 400–700), self-hosted as one `public/fonts/geist-variable.woff2` (~29KB) via `@font-face` in `global.css`, `font-display: swap`. The stack keeps `-apple-system, BlinkMacSystemFont` first so Apple devices render SF Pro; Geist is the near-match for everyone else. Mono is the system mono stack (`--site-font-mono`) for small technical labels.

Do not load fonts from a third-party CDN. Do not reintroduce Inter (the former placeholder).

### Type scale (as implemented)

| Role | Size (mobile → ≥900px) | Weight | Tracking / leading |
|---|---|---|---|
| Hero title | 32 → 52px | 700 | -0.02em / 1.15 |
| Hero subtitle | 20 → 24px | 500 | — / 1.4 |
| Section title | 26 → 34px | 700 | -0.015em / 1.2 |
| Card title | 17px | 700 | -0.01em |
| Body / lede | 16 → 18px | 400 | 1.65–1.7 |
| CTA button | 15px | 600 | — |
| Nav wordmark | 16px | 600 | — |
| Nav link | 14px | 400 | — |
| Eyebrow / kicker | 11px | 600 | 0.1em, UPPERCASE |
| Mono label | 13px | 700 | accent color |

Headlines are tight (negative tracking, ~1.15–1.2 leading); body is generous (~1.65). Use sentence case everywhere except the uppercase eyebrow.

## Assets

```
public/
  favicon.png                    # = simplified black glyph
  brand/
    mark-black.png               # detailed, ink-black
    mark-teal.png                # detailed, forest teal  (light-theme nav)
    mark-teal-dark.png           # detailed, light teal   (dark-theme nav)
    favicon-glyph.png            # simplified, black
    favicon-glyph-teal.png       # simplified, teal
  fonts/
    geist-variable.woff2         # Geist 400–700, one file
```

### Optimized variants

The master marks ship at 1536×1536 and are heavy (`mark-teal*` ~1.5MB, `mark-black` ~1MB), so downscaled variants live in `public/brand/optimized/` — a `-128.png` (nav/@2x, ~13–28KB) and a `-512.png` (social/cards, ~95–260KB) for each of the five marks. The masters remain the high-res source for print/large social.

The nav (`Nav.astro`) references the `-128` teal variants, not the masters — this cut ~3MB off every page load. When adding the mark elsewhere, reach for the smallest variant that covers the render size at ~2x; only use a master where you truly need 1536px.
