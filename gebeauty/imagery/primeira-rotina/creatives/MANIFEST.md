# Wash-Routine Offer (R$95) — creative manifest

Canva folder: **GE Beauty · Rotina de Lavagem (R$95)** — https://www.canva.com/folder/FAHQQH_5AqM
Meta-first (launch scope). Google PMAX deferred. **Creative done, NOT launched.**
Plate asset (shared, all pages): `MAHQVHudr2g` (wash-routine 4-pack on podiums) · logo `MAHM2_0BtII` · frete-grátis badge `MAHQVHT89WE`.

## Final Meta matrix — 10 headline angles × 4 sizes = 40 assets  [WIDTH-FILL REBUILD + QA PASS 2026-07-24]

**2026-07-24 rebuild:** headlines were re-fit to WIDTH-FILL Lucas's safe zone per format (not flat per-format
sizes). 4:5/1:1/9:16 = clean 2-line hero; **1.91:1 = single line** (shallow 82px band). Sub-floor FLAGs removed —
the wider zones resolve them. See the width-fill font table + fit model below.

| Angle (slug) | Hero headline (2-line; 1.91 one-line) | Design ID | View | Notes |
|---|---|---|---|---|
| rotina (canonical) | `seu primeiro ritual / por apenas R$95` | DAHQQMCHFSM | https://www.canva.com/d/mIVIa8hs9kb93h1 | now standardized to explicit 2-line split (was auto-wrap) |
| presente | `comece seu novo / ritual com presentes` | DAHQVVP4ejA | https://www.canva.com/d/Yxtnfl4kR9v2WYm | width-filled 2026-07-24 |
| loyalty | `sua nova rotina / começa aqui` | DAHQVfPJUzo | https://www.canva.com/d/ti-nZ_AxVfGctnN | width-filled 2026-07-24 |
| ritual-menos100 | `seu primeiro ritual / por menos de R$100` | DAHQVWuwQn4 | https://www.canva.com/d/Nc4zuQjysnNLH4F | width-filled |
| completo-menos100 | `seu ritual completo / por menos de R$100` | DAHQVc54bYY | https://www.canva.com/d/yU_AOEEZZKgmByz | width-filled |
| experiencia-menos100 | `sua primeira experiência / por menos de R$100` | DAHQVTBzIJM | https://www.canva.com/d/-9DquxkqGo8TqC_ | width-filled |
| capilar-menos100 | `sua rotina capilar completa / por menos de R$100` | DAHQVd09LtI | https://www.canva.com/d/XDpfTkgVjiom_bV | width-filled |
| completo-95 | `seu ritual completo / por apenas R$95` | DAHQVb6_u-o | https://www.canva.com/d/ZaqotVfM-de6k71 | width-filled |
| experiencia-95 | `sua primeira experiência / por apenas R$95` | DAHQVWK7WW4 | https://www.canva.com/d/QX9kLUnR0gvTysF | width-filled |
| capilar-95 | `sua rotina capilar completa / por apenas R$95` | DAHQVUyShaw | https://www.canva.com/d/z02p8dXKMvd_3zI | width-filled |

Only the hero headline changes per angle. Mechanic block (`COMPRE O SHAMPOO E` / `GANHE A MÁSCARA` /
`+ shampoo a seco ou leave-in mini`), plate, logo, frete-grátis badge, and layout are IDENTICAL across all
angles — verified. All 9 non-canonical designs are fresh clones of the approved canonical DAHQQMCHFSM (Canva
`copy-design` preserves page_ids + element_ids, so the hero element IDs below are stable across every clone).

## Exported PNGs (pro quality) — `creatives/meta/`
Naming `{size}_{slug}.png`; sizes 4x5 (1080×1350) · 1x91 (1200×628) · 1x1 (1080×1080) · 9x16 (1080×1920).
40 files = 10 slugs × 4 sizes. All dimensions verified against Meta targets; pro export confirmed
(4:5 ~1.1MB · 1.91 ~0.67MB · 1:1 ~0.96MB · 9:16 ~1.4MB).

## Per-format hero WIDTH-FILL font sizes (px) — order 4:5 / 1.91:1 / 1:1 / 9:16
Each headline is sized to fill its safe zone: **width-bound** (long headlines) fill ~95-97% of the zone width;
**height-bound** (short headlines) hit the 2-line height cap (or the 1.91 one-line cap) and fill the zone height,
landing lower on width (fill-binding-dimension default, Lucas-approved 2026-07-24).

| Angle | 4:5 | 1.91:1 | 1:1 | 9:16 | binding |
|---|---|---|---|---|---|
| rotina | 108 | 68 | 84 | 112 | height (short) |
| presente | 104 | 62 | 84 | 101 | mixed |
| loyalty | 108 | 68 | 84 | 112 | height (short) |
| ritual-menos100 | 103 | 62 | 84 | 100 | mixed |
| completo-menos100 | 103 | 60 | 84 | 100 | mixed |
| completo-95 | 108 | 66 | 84 | 108 | height |
| experiencia-menos100 | 86 | 52 | 71 | 83 | width (long) |
| experiencia-95 | 86 | 57 | 71 | 83 | width (long) |
| capilar-menos100 | 77 | 49 | 65 | 75 | width (longest) |
| capilar-95 | 77 | 53 | 65 | 75 | width (longest) |

Measured fills (rendered PNGs): width-bound heroes 4:5/9:16/1:1 land ~95-97%; 1.91 one-liners ~96-98%.
Height-bound short heroes (rotina/loyalty) fill the zone HEIGHT and sit ~70-82% on width — correct per the
fill-binding-dimension rule (they read as big, bold, zone-filling; not stranded whitespace).

### Fill zones (Lucas's safe area — set the hero box to these, then size the font)
| format | zone left | zone top | zone w | zone h | lines |
|---|---|---|---|---|---|
| 4:5    | 48 | 171 | 972  | 220 | 2 |
| 1.91:1 | 63 | 124 | 1095 | 82  | 1 (short band) |
| 1:1    | 59 | 73  | 813  | 172 | 2 |
| 9:16   | 70 | 239 | 943  | 229 | 2 |

### Fit model (for future edits, no re-derivation)
- **Width-fill font** = zone_w × 0.97 / (px-per-font of the longest line), capped by height.
- **This template's per-line px-per-font** (font-independent, pixel-measured — do NOT reuse the Rose/Mist k≈0.505):
  `sua rotina capilar completa`=12.09 · `sua primeira experiência`=10.96 · `ritual com presentes`=9.00 ·
  `por menos de R$100`=9.08 · `seu ritual completo`=8.42 · `seu primeiro ritual`=7.89 · `comece seu novo`=7.71 ·
  `por apenas R$95`=7.49 · `sua nova rotina`=6.71 · `começa aqui`=5.72. One-line 1.91 = sum of both lines + ~0.33 (space).
- **Height caps:** 2-line box height ≈ 2.03×font → max font = zone_h/2.03 (4:5=108, 1:1=84, 9:16=112).
  1.91 one-line box height ≈ 1.20×font → max font = 68 (box ≤82, clears mechanic at y213).
- **1.91 is ONE line:** replace_text to remove the `\n` (join with a space); box left63/top124/w1095.
- Verify each apply via the returned box `height`: 2-line ≈ 2.03×font, 1.91 one-line ≈ 1.20×font;
  a ~2.4×font on 1.91 = wrapped to 2 lines → reduce font.
- Logo/mechanic clearance is guaranteed by filling the zone exactly (the zone was drawn safe; the logo is a
  top-corner rect and the headline sits below it — headline may span past the logo's x since it's vertically clear).

## Per-page hero element IDs
Clones (all 9 non-canonical) share these; the canonical **rotina** differs on pages 1 & 2 (always re-snapshot).
| page | format | hero element_id (9 clones) | rotina (canonical) |
|---|---|---|---|
| 1 | 4:5    | PBqlM49n1dlDp7fh-LB2yJ9JvKKwW3kj6 | PBqlM49n1dlDp7fh-LBct7qbHnHX0dPPx |
| 2 | 1.91:1 | PB5LdH8kp0Bs14GS-LBDSvD5d1xLHNsMq | PB5LdH8kp0Bs14GS-LBkxcwhrTL1bWCRV |
| 3 | 1:1    | PB9DZblFtd1mxkBr-LBHMkTbPMmQwWNP6 | (same) |
| 4 | 9:16   | PB5LKWV1N9vjv9j3-LBwsSLcGP3yZHZfY | (same) |

## QA gate — PASS on every asset (40/40) [width-fill rebuild 2026-07-24]
- Hero swapped/re-fit, HERO ONLY — mechanic banner, plate, badge, logo, layout untouched on every page.
- Width-fill verified by pixel-measuring the exported PNGs: 4:5/1:1/9:16 = clean 2-line (box height 2.03-2.06×font,
  no 3-line overflow); 1.91:1 = single line (box height ~1.20×font). No collision with mechanic, logo, or products.
- Fills: width-bound heroes ~95-97% of zone width; 1.91 one-liners ~96-98%; short height-bound heroes fill the
  zone height (~70-82% width) per the fill-binding-dimension default.
- PT-BR diacritics intact (começa, já, experiência, máscara, R$95 / R$100).
- House layout honored: vertical/square = product bottom + copy top; landscape = product left + copy right.

## Orphan / scratch designs to DELETE manually (no delete API — Canva UI) — UNCHANGED
- `DAHQQGalhEw` — old STALE `washroutine_meta_presente`.
- `DAHQQHybw98` — old STALE `washroutine_meta_loyalty`.
- `DAHQQM9mAuc` — STALE travel-size master seed.
