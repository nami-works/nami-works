# Flower · Lighter — end-to-end motion plan (Lucas, 2026-06-15)

Full ASMR ad = application + exposure, ~26s, 9:16, loud ASMR. Render as 5 concatenated Seedance clips. Camera locked + static throughout; both flowers + stems held still; only the described element moves.

| Clip | Keyframes | Move | ASMR audio focus |
|---|---|---|---|
| **1** (~12s) | `01_APP-START` → `02_APP-MID` | move1: left hand gently hits the pump **3×** until a generous drop forms on the right index fingertip. move2: right hand raises to flower height and applies the product with **5–7 clear, deliberate strokes** back and forth across the WHOLE bloom surface (Lucas 2026-06-15: application should take longer, 5–7 visible strokes). | the **spring-valve pump** click ×3, then the **5–7 fingertip strokes on the petals** |
| **2** (~4s) | `02_APP-MID` → `03_APP-END` | move3: finger leaves the petal surface and exits frame by the right-hand edge. | soft petal release + hand leaving |
| **3** (~6s) | `03_APP-END` → `05_EXP-lighter-END_leftBurnt` | move4: lighter enters frame **still OFF**, clicks to ignite, then its flame burns the LEFT flower (chars/curls/smokes). RIGHT untouched. | lighter **click-to-ignite**, then the LEFT flower **burning/crackling** |
| **4** (~4s) | `05_EXP-lighter-END_leftBurnt` → `06_EXP-lighter-BEAT2_flameRight` | move5: lighter is turned OFF (flame extinguishes), then slides sideways over to the RIGHT flower. | lighter **click-release + flame extinguishing**, then **silence** as it moves right |
| **5** (~6s) | `06_EXP-lighter-BEAT2_flameRight` → **(NEW)** flame-traveled-across-right, still pristine | move6: lighter ignites again, flame runs ACROSS the RIGHT flower — but **NOTHING happens to it**: stays pristine, no color change, no char. | lighter **click-to-ignite**, then flame **burning as if in open air, touching nothing** |

### Smoke rule (Lucas 2026-06-15)
The smoke from the LEFT (burnt) flower must CEASE ~2 seconds after the lighter's flame is removed from it. So: smoke rises during clip 3 (flame on left); in clip 4 the flame leaves and the smoke tapers out and is GONE by ~2s; clips 4-END, 5-START and 5-END keyframes show NO smoke. → re-derive smoke-free versions of the clip-4 END (06) and clip-5 END.

### Critical fix for clip 5 (why the last render failed)
Single-keyframe let the model burn the right flower. Clip 5 MUST be **dual-keyframe** with BOTH ends showing the right flower **pristine** (flame at a different position across it), so "no change" is pinned by the end frame. → need ONE new still: flame at the far side of the right flower, right flower still perfect. Prompt hard-negatives: "the right flower does NOT change, NO char, NO browning, NO curl, identical to start."

### Assembly
Concat clips 1–5 via `imageio_ffmpeg` (scale 1080x1920, 24fps, concat with audio). Output = `clips/flower-lighter_FULL-ASMR.mp4`.
