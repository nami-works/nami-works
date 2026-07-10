# proof-heat-cachos-v1 — ready-to-fire render manifest

**Status:** all keyframes locked on disk. BLOCKED only on Magnific credits (was 407, need top-up).
**Model:** `bytedance-seedance-pro-2.0` · 9:16 · 1080p · 6s · `withSoundEffects: true` · `cameraMotion: static`.
**Structure:** sequential before/after. Edit order = Clip1 (burns) → Clip2 (apply) → Clip3 (survives) → closing card.

## Locked keyframes (seeds/ + Magnific creation ids)

| Clip | Role | Creation id | Local |
|---|---|---|---|
| 1 burn | START (idle peônia + flame) | `LUaQcVbswO` | seeds/seg1_start.png |
| 1 burn | END (scorched/charred) | `rlmCf3nxtc` | seeds/seg1_end_burn.png |
| 2 apply | START (fingertip + gel-creme, single keyframe) | `1stf1yer4r` | seeds/seg2_apply.jpg |
| 3 survive | START (treated peônia + flame) | `J9qrPEEOq4` | seeds/seg2_survive_start.png |
| 3 survive | END (flame on bloom, intact) | `0pP3DnbTfW` | seeds/seg2_survive_end.png |

Canonical cap reference (uploaded): Shopify hero `swfFxoYl8e`. Marcela right hand: `gJCbKReSXO`.

## The 3 video_generate calls (fire verbatim on resume)

**Clip 1 — sem primer (burn), dual-keyframe:**
keyframes.start=`LUaQcVbswO`, keyframes.end=`rlmCf3nxtc`. Prompt: small contained utility-lighter flame at the lower petals; petals scorch, curl, brown, blacken and shrivel from the contact point, thin pale smoke wisp; realistic slow flower combustion, flame stays small. Audio: soft flame whoosh + delicate petal crackle + faint sizzle + quiet room-tone; no music. NEGATIVES: no large fire/blaze/explosion.

**Clip 2 — aplicação (apply), single keyframe:**
keyframes.start=`1stf1yer4r`. Prompt: Marcela's fingertip (coral french-tip, twisted gold middle-finger ring) works a dab of opaque cream-beige gel-creme into the peônia petal, slow circular motion, satin film; coral bottle w/ slim white sprayer cap still beside it. Audio: soft wet cream-gel squish + fingertip-on-petal brush + quiet room-tone; no music.

**Clip 3 — com primer (survive), dual-keyframe:**
keyframes.start=`J9qrPEEOq4`, keyframes.end=`0pP3DnbTfW`. Prompt: same small flame moves into full contact with the treated bloom; flower stays pristine/intact, protective satin sheen glistens, heat slides off; NO burning/browning/char/smoke. Audio: soft flame whoosh + gentle calm hush + quiet room-tone, NO crackle/sizzle; no music.

## Failed dispatch ids (insufficient credits, 2026-06-12) — ignore, re-fire fresh
ONbx6mGynm, MXN2BUrDCm, IazTf3UtvE, Kj8as15kqp.

## Assembly (after the 3 clips land, via imageio_ffmpeg)
Concat Clip1→Clip2→Clip3 (9:16, 1080x1920, 24fps), light crossfades, then closing card.
Captions burned in post: "sem primer" over Clip1, "com primer" over Clip3, offer caption + tagline on the card.

## Open variant
Flat-iron heat variant (chapinha instead of flame) — stills NOT yet built; optional per Lucas.
