# Rose Ritual — Claims Test creative manifest

> ✅ **Whitespace-first re-tune COMPLETE (2026-07-20), font-hierarchy correction COMPLETE (2026-07-21).**
> All 152 PNGs (19 claims × 4 sizes × Meta + Google PMAX) at the approved whitespace-first
> treatment per `../ROLLOUT-SPEC.md`, committed to git (`creatives/meta` + `creatives/google`,
> 76 each). The "Treatment (locked)" section below describes the ORIGINAL narrow-box build and
> is retained for history only. The claim → design-ID table is current. Reference look: `proof/`.
>
> **Re-tune mechanics (as executed, current formula after the 2026-07-21 whitespace fix below):**
> descriptor tops unchanged (hug preserved); copy re-fit to fill the clean band width, fewest
> rows. Font = `min(round(1.85 × fillW / longest-line-chars), ceiling)`. The `1.85` coefficient
> is pixel-measured (see whitespace-fix note below) — do NOT revert to the original `1.63`
> estimate, it under-fills. Line-height 1.34 (Meta) / 1.30 (PMAX).
> Per-claim break map + fillW/element-id geometry in `../ROLLOUT-SPEC.md`.
> **40-char claims (I1/I2/C1/C2):** rendered 2-line regressive on ALL formats (Lucas's call,
> to stay above the readable-1-line floor).
> Meta I4 (all pages) is the ONE grandfathered exception — 3-line, already approved, deliberately
> left untouched even though it doesn't satisfy the max-2-rows rule below. Meta I5 1:1 (page 3)
> is also grandfathered (Lucas's original hand-tuned proof, untouched).
>
> **2026-07-21 correction — type-scale ceiling.** Lucas flagged that several claims (worst: C4
> "HIDRATA A PELE", then C11, then C12) rendered with copy way oversized relative to the
> "body & hair splash" subtitle line, breaking the info hierarchy. Fixed with a precise,
> reusable rule (see `../ROLLOUT-SPEC.md` "Type-scale CEILING"): **max 2 rows · row1 length >=
> row2 · copy font <= 1.1x subtitle font · respect existing box width/height**. Subtitle font
> size was measured via a non-destructive calibration transaction (widen box to 1 line, set a
> known test font, read height, derive the ratio, cancel — zero side effects). Resulting
> ceilings: Meta 4:5=58 / 1.91:1=44 / 1:1=56 / 9:16=66 · Google 4:5=51 / 1.91:1=44 / 1:1=62 /
> 9:16=66. Google I4 was also re-broken from 3 lines to 2 (max-2-rows) since it wasn't
> grandfathered like Meta I4. Three landscape-column breaks (I5, I6, C12) were re-split to fix
> row1<row2 violations. All 19×2=38 designs re-verified against this ceiling; some were already
> compliant (no change), 27 needed a font/text correction.
>
> **2026-07-21 correction — whitespace under-fill (same day, second pass).** Even after the
> ceiling fix above, Lucas spotted several assets (worst: Google I4, Meta C1, C8) still leaving
> large dead whitespace despite being under their ceiling. Root cause: the original width-fill
> formula (`1.63 × fillW/chars`) targeted only ~85% fill and was never checked against real
> renders, so any page where the ceiling *didn't* kick in was silently left under-filled — we'd
> only ever corrected DOWN to the ceiling, never UP toward it. Fixed by pixel-measuring the
> actual rendered text width on 2 independent real PNGs (crop the red glyphs, threshold, measure
> x-extent) — found the true per-character width constant is **k ≈ 0.505-0.512** (not the
> assumed 0.52 that produced the 1.63 coefficient), and recalibrated the fill target to ~93% of
> box width, giving the corrected **1.85 × fillW/chars** coefficient (still clamped to the same
> ceiling, still respecting max-2-rows/row1>=row2/box-fit — no rule changed, just the formula
> that feeds into it). 35 of 38 designs needed a font bump (font-size-only change, same text/box
> width); 98 pages total. Biggest jump: Google I4 (30→42 / 17→23 / 47→54 / 34→48 across its 4
> pages) since its long 2-line text had been most under-filled by the old formula.

Campaign: **Rose Ritual (body & hair splash)** claims test.
Built 2026-07-17 via /creative-producer. Source copy: `Claims Test_Body Hair Splash.xlsx`.
19 claims × 4 sizes × 2 platforms = **152 PNGs**.

Deliverable = the exported PNGs in `creatives/google/` and `creatives/meta/`.
Naming: `<size>_<claim-slug>.png`. Sizes: `4x5`, `1x91` (1.91:1 landscape), `1x1`, `9x16`.

## Treatment (locked)
- Clone-and-swap off the finished Rose Ritual masters. Product plate NEVER touched.
- Descriptor = the swappable slot; product name "Rose Ritual" + line label "body & hair splash" fixed.
- Uppercase, accent-safe (HIDRATAÇÃO, MANTÉM, FRAGRÂNCIA).
- **Hug rule applied**: descriptor repositioned to ~30px below the line label on every page
  (was ~58-70px on 4:5 + 9:16 on both masters). Per-page hug tops baked into each seed.
- Google PMAX: per-page hard breaks (wider boxes). Meta: one break pattern per claim (~≤17ch/line,
  narrower boxes + larger font).
- I3 copy corrected: "celam" → **"selam"** a cutícula (source typo).

## Masters / seeds
- Google PMAX master (canonical, untouched): `DAHPZmyFS9k` (PMAX_BODYHAIR_ROSERITUAL)
- Google hug-fixed seed = **I4 deliverable**: `DAHPk8KFG0A`
- Meta master (canonical, untouched): `DAHOV54G2g4`
- Meta hug-fixed seed = **I4 deliverable**: `DAHPpQXFnQ0`

## Claim → design IDs

| Claim | Copy | Google PMAX | Meta |
|---|---|---|---|
| I1 | Confere brilho aos fios e hidrata a pele | DAHPlkFtrds | DAHPpYPVQ6s |
| I2 | Hidrata a pele e confere brilho aos fios | DAHPlnL3Dos | DAHPpdm9two |
| I3 | Com ativos que selam a cutícula e aumentam o brilho dos fios | DAHPllMKn9s | DAHPpUeQc4Q |
| I4 | Com ativos que estimulam a hidratação da pele de dentro para fora | DAHPk8KFG0A | DAHPpQXFnQ0 |
| I5 | Mantém a pele hidratada por até 72h | DAHPlnCrHp4 | DAHPpYccfpQ |
| I6 | Bruma perfumada para cabelo e corpo | DAHPlkg3LuU | DAHPpWsXm1U |
| I7 | Fragrância de rosas com lichia e frutas vermelhas | DAHPlrUXGCw | DAHPpcry6FI |
| C1 | Dá brilho para o cabelo e hidrata a pele | DAHPl6BqUGE | DAHPpURWu-8 |
| C2 | Hidrata a pele e dá brilho para o cabelo | DAHPl5Z6dF4 | DAHPpXOFoIk |
| C3 | Realça o brilho do cabelo | DAHPl7bFf8c | DAHPpbhe1v4 |
| C4 | Hidrata a pele | DAHPlwC8SVs | DAHPpbKbk-A |
| C5 | Pele hidratada por até 72h | DAHPl6D1WNY | DAHPpW4ie9Y |
| C6 | Perfuma o cabelo e a pele | DAHPl2TjFkk | DAHPpfwzgc8 |
| C7 | Cheiro de rosas com lichia e frutas vermelhas | DAHPpabwm4Q | DAHPplGZiss |
| C8 | Sensação de leveza e plenitude! | DAHPpUPqDMY | DAHPps2UueM |
| C9 | Vibes de brunch com as amigas! | DAHPpV2Szxk | DAHPpoBoECA |
| C10 | Fragrância feminina e delicada | DAHPpS83_Uk | DAHPpjbeLjI |
| C11 | Vibes viagem para Paris | DAHPpdtbXfs | DAHPpi7TmwI |
| C12 | Mood do dia: viagem para Paris | DAHPpaDGNWQ | DAHPpnEF8tE |

## QA (2026-07-21 — whitespace under-fill correction, current)
- Counts: google 76 (19×4), meta 76 (19×4) = 152 total. PASS. No 0-byte/corrupt files.
- 35 of 38 designs (98 pages) had font bumped from the old (under-filling) `1.63×` formula to
  the pixel-measured `1.85×` formula, still clamped to the same 1.1x-subtitle ceiling.
- Spot-checked renders (Google I4, Meta C1, Google C8 — the three Lucas flagged as still too
  small) confirm copy now genuinely fills the clean whitespace band, no overflow, no
  product/logo overlap, no unwanted extra line-wrap.
- I4 (Google, biggest jump, longest text) individually verified on all 4 pages — 2-line wrap
  held, no overflow.

## QA (2026-07-21 — font-hierarchy ceiling correction)
- Counts: google 76 (19×4), meta 76 (19×4) = 152 total. PASS. No 0-byte/corrupt files.
- All 38 designs (19 claims × 2 platforms) checked against the 1.1x-subtitle ceiling; 27
  needed a correction (font shrink and/or row-length rebreak), applied and re-verified.
- Spot-checked renders (Google C6, Meta C11, Google C12 — the three Lucas flagged) confirm
  copy now reads clearly subordinate to "Rose Ritual" / roughly subtitle-scale, matching the
  approved C12 proportions. No overflow, no product/logo overlap.
- Google I4 re-broken 3→2 lines, row1(38)>=row2(27), clears the 9:16 waterline/leaf cleanly.

## QA (2026-07-20 — whitespace-first re-tune, superseded by above for font sizing)
- Counts: google 76 (19×4), meta 76 (19×4). PASS.
- Dimensions per size verified programmatically across all 152. PASS.
- Width-fill + hug + accents + regressive line-breaks + logo/product clearance verified on renders.
- **Foliage open-flag from 2026-07-17 RESOLVED:** the long claims (I3/I4/I7/C7) now break to 2–3
  wide lines instead of the old 4–5 narrow stack, so every 9:16 clears the top rose leaf.
- Landscape (1.91:1) copy sits in the clean right column beside the product on all claims.

### QA (2026-07-17 — superseded narrow-box build, retained for history)
- Counts/dimensions PASS; open flag: longest 9:16 claims touched foliage (now resolved above).

## Scratch / cleanup
- No orphan scratch designs: every clone became a deliverable. Canonical masters
  (`DAHPZmyFS9k`, `DAHOV54G2g4`) untouched.
- Canva folder: GE Beauty team; designs titled "ROSE RITUAL Claims / <id> <desc> / <PLATFORM>".

## Next
- Hand to /growth-hacker for Meta + Google PMAX ad-set load. Creative done, NOT launched.
