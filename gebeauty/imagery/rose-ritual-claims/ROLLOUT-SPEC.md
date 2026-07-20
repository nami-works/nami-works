# Rose Ritual Claims — Whitespace-First Rollout Spec

Source of truth for re-tuning all 19 claims × 2 platforms (152 assets) to Lucas's
approved treatment. Survives session reset — a fresh session executes from this.

## The treatment rules (Lucas, approved 2026-07-17..19)
1. **Readability-against-contrast is the hard constraint (general rule).** Copy may sit
   ONLY where it stays clearly legible — over a clean, high-contrast area of the
   background. Never place text where it overlaps composition/ambience elements
   (product, imagery, props) or any region whose color/texture would hurt contrast and
   reduce readability. The "clean whitespace band above the product" is merely how this
   manifests on the current underwater plate; on any other image, apply the same
   contrast test to wherever the clean zone is. When "fill" vs "readability" conflict,
   READABILITY WINS.
2. **Fill the whitespace WIDTH** — widen the descriptor box into the clear area; size
   the font so the copy fills most of the width.
3. **Fewest rows.** 1 line if the whole claim fits at a readable font (≈>=40 on wide
   formats); else multi-line.
4. **Regressive line length + phrase consistency.** Multi-line: break ONLY at phrase
   boundaries AND step line lengths DOWN (longest line on top). No short-then-long.
   (Lucas I4 9:16 = COM ATIVOS QUE ESTIMULAM / A HIDRATAÇÃO DA PELE / DE DENTRO PARA FORA = 24/20/19.)
5. **Hug** the name block (descriptor top unchanged — see per-format tops below).
6. Uppercase, accent-safe. Font-size varies per asset to fill; set uniformity irrelevant.

## Calibration (from Lucas's hand-tuned proofs)
- I5 1:1 (square): ONE line "MANTÉM A PELE HIDRATADA POR ATÉ 72H" (35 ch), box width
  **1013**, font **~48**. → char width factor ≈ **0.52 × font × chars = text_px**.
- **1-line font ≈ 1.63 × usable_width / chars** (fills ~85% width). Cap by band height.
- Line-height ≈ 1.33 × font (Meta), ≈1.30 (PMAX). Band-height cap: font ≤ band_h/(1.33×rows).
- Readable 1-line only if resulting font ≥ ~40 (wide) / ≥ ~30 (landscape col); else split.

## Per-format geometry
Element-id suffix stable across clones; page-id prefix stable within a platform.

### META (clones of DAHOV54G2g4). Descriptor element_ids:
- p1 4:5 1080×1350 — `PBqlM49n1dlDp7fh-LB9J5b4Lc3NJnqX8` left 70.35 top 303.65 fillW≈940
- p2 1.91:1 1200×628 — `PB5LdH8kp0Bs14GS-LBz3Bxh7gHQkHbS5` left 711.19 top 313.84 fillW≈462 (right col)
- p3 1:1 1080×1080 — `PB9DZblFtd1mxkBr-LBhH00kSwrHFVRFX` left 51.19 top 228.87 fillW≈1013
- p4 9:16 1080×1920 — `PB5LKWV1N9vjv9j3-LBL0xj4YWgbfHHyx` left 69.01 top 315.68 fillW≈985
- pages: [PBqlM49n1dlDp7fh, PB5LdH8kp0Bs14GS, PB9DZblFtd1mxkBr, PB5LKWV1N9vjv9j3]

### GOOGLE PMAX (clones of DAHPk8KFG0A / master DAHPZmyFS9k). Descriptor element_ids:
- p1 4:5 960×1200 — `PBWdx1JhwW00qYnn-LBWPsRX4FW9d75Wv` left 62.53 top 273.24 fillW≈835
- p2 1.91:1 1200×628 — `PBQYBTTKwTBbl86N-LBjRx0zl595KCHfs` left 711.19 top 313.84 fillW≈460 (right col)
- p3 1:1 1200×1200 — `PBBdxVYpzRQVY3N4-LBgG7hpYl1KdL6JS` left 56.88 top 250.97 fillW≈1090
- p4 9:16 1080×1920 — `PBPLfNJFF7XYwMf1-LBVqMHVK02QBffnx` left 69.01 top 315.67 fillW≈950
- pages: [PBWdx1JhwW00qYnn, PBQYBTTKwTBbl86N, PBBdxVYpzRQVY3N4, PBPLfNJFF7XYwMf1]

## Line-break map (WIDE formats 4:5/1:1/9:16 = one line unless noted; landscape = regressive multi in right col)
Regressive multi-line splits given for the long claims; short claims are single-line on wide,
2-line regressive on the narrow landscape column.

| ID | Wide-format lines | Landscape lines (right col) |
|----|-------------------|------------------------------|
| I1 | CONFERE BRILHO AOS FIOS E HIDRATA A PELE | CONFERE BRILHO AOS FIOS E / HIDRATA A PELE |
| I2 | HIDRATA A PELE E CONFERE BRILHO AOS FIOS | HIDRATA A PELE E CONFERE / BRILHO AOS FIOS |
| I3 | COM ATIVOS QUE SELAM A CUTÍCULA / E AUMENTAM O BRILHO DOS FIOS | COM ATIVOS QUE SELAM A CUTÍCULA / E AUMENTAM O BRILHO DOS FIOS |
| I4 | COM ATIVOS QUE ESTIMULAM / A HIDRATAÇÃO DA PELE / DE DENTRO PARA FORA | COM ATIVOS QUE ESTIMULAM / A HIDRATAÇÃO DA PELE / DE DENTRO PARA FORA |
| I5 | MANTÉM A PELE HIDRATADA POR ATÉ 72H | MANTÉM A PELE / HIDRATADA POR ATÉ 72H |
| I6 | BRUMA PERFUMADA PARA CABELO E CORPO | BRUMA PERFUMADA / PARA CABELO E CORPO |
| I7 | FRAGRÂNCIA DE ROSAS COM LICHIA / E FRUTAS VERMELHAS | FRAGRÂNCIA DE ROSAS COM LICHIA / E FRUTAS VERMELHAS |
| C1 | DÁ BRILHO PARA O CABELO E HIDRATA A PELE | DÁ BRILHO PARA O CABELO E / HIDRATA A PELE |
| C2 | HIDRATA A PELE E DÁ BRILHO PARA O CABELO | HIDRATA A PELE E DÁ BRILHO / PARA O CABELO |
| C3 | REALÇA O BRILHO DO CABELO | REALÇA O BRILHO DO CABELO |
| C4 | HIDRATA A PELE | HIDRATA A PELE |
| C5 | PELE HIDRATADA POR ATÉ 72H | PELE HIDRATADA POR ATÉ 72H |
| C6 | PERFUMA O CABELO E A PELE | PERFUMA O CABELO E A PELE |
| C7 | CHEIRO DE ROSAS COM LICHIA / E FRUTAS VERMELHAS | CHEIRO DE ROSAS COM LICHIA / E FRUTAS VERMELHAS |
| C8 | SENSAÇÃO DE LEVEZA E PLENITUDE! | SENSAÇÃO DE LEVEZA / E PLENITUDE! |
| C9 | VIBES DE BRUNCH COM AS AMIGAS! | VIBES DE BRUNCH / COM AS AMIGAS! |
| C10 | FRAGRÂNCIA FEMININA E DELICADA | FRAGRÂNCIA FEMININA / E DELICADA |
| C11 | VIBES VIAGEM PARA PARIS | VIBES VIAGEM PARA PARIS |
| C12 | MOOD DO DIA: VIAGEM PARA PARIS | MOOD DO DIA: / VIAGEM PARA PARIS |

## Per-asset op recipe (Canva MCP)
Per design: start-editing-transaction → for each page: replace_text (break string),
resize_element (fillW), format_text (font_size = computed, verify render, nudge if wraps/orphans
or bleeds band) → commit → export → download to creatives/<platform>/<size>_<slug>.png.

## Design ID registry — EDIT existing designs in place, do NOT re-clone
All 38 designs already exist (19 claims × Meta + Google PMAX), one per claim per platform,
4 sizes as pages. **The complete, verified claim → design-ID table is in
`creatives/MANIFEST.md`** (both platforms, incl. Meta C7-C12). Use it directly; if any ID
fails, fall back to `search-designs("ROSE RITUAL Claims")` and match by title
`ROSE RITUAL Claims / <ID> <desc> / <META|PMAX>`.
- Seeds: Meta I4 = DAHPpQXFnQ0 · Google PMAX I4 = DAHPk8KFG0A.
- Canonical masters (do NOT edit): Meta DAHOV54G2g4 · Google PMAX DAHPZmyFS9k.

## Status (verified on disk 2026-07-19)
- All 152 PNGs already exist in `creatives/{google,meta}/` (76 each) in the OLD narrow-box
  treatment. This rollout RE-TUNES them in place, then re-exports + re-downloads (overwrite).
- ALREADY at the approved treatment (do not redo): Meta I4 (all 4 pages, whitespace-first) ·
  Meta I5 page-3 1:1 (Lucas's one-row edit). Note Meta I5 pages 1/2/4 are NOT yet conformed.
- TODO: apply the treatment to every other claim/page on BOTH platforms; QA every asset
  (readability-vs-contrast + regressive + width-fill + hug); refresh MANIFEST + open folders.
- Reference look: proof/ folder + the two Canva designs above.
