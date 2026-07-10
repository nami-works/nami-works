# `_SHARED/` — canonical reusable asset library (video-director)

Cross-concept reference assets. Reuse these instead of re-rolling identity. Pass the **Magnific creation id** (the trailing token in each filename / the `id:` below) as a `references[].identifier` (`type: image`) in `images_generate` / `video_generate`. Local files are mirrors for browsing; the creation id is the source of truth and persists on Magnific even if the local file is deleted.

Last updated 2026-06-14.

---

## ingredients/  (universal scent-ingredient footage — melon / peônia, underwater + mist)
Reusable for any GE Beauty scent/sensory context (the signature scent = melon, peônia, white musk).

| File | id | What it is |
|---|---|---|
| `melon-underwater-splash_62xlNNQiJO.png` | `62xlNNQiJO` | melon slice plunging in clear water, bubble burst (still) |
| `melon-underwater-splash_clip_LUaQwfTswO.mp4` | `LUaQwfTswO` | ^ as 6s motion clip (native ASMR water audio) |
| `peonia-underwater-drift_brBtblt5Y2.png` | `brBtblt5Y2` | cream peônia bloom drifting underwater, petals (still) |
| `peonia-underwater-drift_clip_mCYVETehJQ.mp4` | `mCYVETehJQ` | ^ as 6s motion clip |
| `melon-slice-mist_A_jSaswJGLD0.png` | `jSaswJGLD0` | melon crescent on cream surface + fine water mist (still) |
| `melon-slice-mist_B_xgvLU7djfW.png` | `xgvLU7djfW` | ^ alt |

### Original brand splash seeds (Magnific uploads of GE Beauty Melon Mood shoot)
| Source photo | id | What it is |
|---|---|---|
| ge-50057.jpg | `IazcXIXtvE` | pure ingredient world — melon + peônia + bubbles, NO product |
| ge-49023.jpg | `62xl435iJO` | Melon Mood bottle submerged + melon + peônia (product splash) |

---

## marcela-hands/  (the GE Beauty persona hands — canonical identity)
**Marcela:** light Brazilian skin, slight olive undertone; crisp **coral-red french-tip** manicure on every nail; **left** middle finger = ornate gold band, **right** middle finger = twisted gold ring; wrists bare. Early-30s, smooth.

**Rules:** single-hand frame → use `canonical_left`/`canonical_right` (NEVER the master — it carries both rings and the model mirrors them). Both-hands frame → use `canonical_master`. Per-finger BARE enumeration when forcing rings (see skill).

| File | id | Use |
|---|---|---|
| `canonical_master.png` | `YV79SyJWeC` | both hands together (identity baseline; both-hand frames) |
| `canonical_left.png` | `SOE5KezUb8` | LEFT hand only (single-left frames) |
| `canonical_right.png` | `gJCbKReSXO` | RIGHT hand only (single-right frames) |
| `shot1_angle1_natural_rest_BmZGifdoQR.png` | `BmZGifdoQR` | per-shot angle (morning/bathroom wardrobe) |
| `shot1_angle2_topdown_gJCQ1lDSXO.png` | `gJCQ1lDSXO` | per-shot angle |
| `shot1_angle3_sideprofile_brX8E8A5Y2.png` | `brX8E8A5Y2` | per-shot angle |
| `shot1b_angle1_typing_ready_hEY0GpMvqL.png` | `hEY0GpMvqL` | per-shot angle (office/cardigan) |
| `shot1b_angle2_palmup_xgmaKtgjfW.png` | `xgmaKtgjfW` | per-shot angle |
| `shot1b_angle3_3-4_sideview_XtRApjuBfo.png` | `XtRApjuBfo` | per-shot angle |
| `shot2_angle1_cup_cradle_y6b12oCPW9.png` | `y6b12oCPW9` | per-shot angle (cafe/cup) |
| `shot2_angle2_palmdown_Pi5rGDR42C.png` | `Pi5rGDR42C` | per-shot angle |
| `shot2_angle3_sideprofile_rltv13yxtc.png` | `rltv13yxtc` | per-shot angle |

---

## objects/canonical_hairdryer/  (champagne-cream salon dryer — Shark FlexStyle silhouette, branding removed)
Takes both a concentrator nozzle and a pronged diffuser. Pass the matching angle when a dryer appears.

| File | id | Angle |
|---|---|---|
| `angle1_horizontal_rest.png` | `kL8b22L16B` | body horizontal, nozzle camera-left (default identity anchor) |
| `angle2_standing_3-4.png` | `jSh1YPkLD0` | standing 3/4 |
| `angle3_diagonal_descent.png` | `NZ1Pudo6D9` | ~30° tilt mid-descent |
| `angle6_near_placement.png` | `l7fjh2Zgv9` | ~10° near surface |
| `angle7_front_ring_inlet.png` | `wPQgEOo7EI` | front ring inlet |
| `angle8_pistol_grip_vertical.png` | `TePWOxnVNR` | vertical pistol-grip |

---

## product/  (canonical product references)
Product texture (both primers): **opaque cream-beige gel-creme**, glossy satin, medium body (absorbs into the proxy). Cap on both = **slim white fine-mist sprayer** (NOT a lotion pump).

| Product | Magnific library id | Hero / canonical | Body color |
|---|---|---|---|
| **primer cachos definidos** | library `1872735` | Shopify hero upload `swfFxoYl8e` (also the cap reference) | CORAL/red body, cream `ge` wordmark, PRIMER CACHOS DEFINIDOS label |
| **primer liso intacto** | library `1877692` | `product/liso-canonical_1sIKpPSr4r.png` (id `1sIKpPSr4r`) · `product/liso-shopify-hero.png` | CREAM body, coral wordmark, PRIMER LISO INTACTO label |

---

## style-refs/
| File | aesthetic |
|---|---|
| `bathroom/pin_893401644883946887_small-european-bathroom.jpg` | small European bathroom (day-arc bathroom scenes) |

---

## Application locked seeds (current ASMR proof build — not in `_SHARED` but recorded here)
`ASMR/_shared-application/{A-flower,B-ribbon}/seeds/` — START/MID/END for the shared application scene.
- **flower:** START `tfYfLDQmZJ` · MID `VdNIybUMMU` · END `cDPB7q70eP`
- **ribbon:** START `po3o5nMehw` · MID `9Rrz5mQNYZ` · END `1smwocVr4r`
