# Prototype 01 — leave-in pluma

**Product:** leave-in pluma · R$149 · lançamento · 5-in-1 leave-in (spray/pump bottle format)
**Concept source:** [docs/video-director-concepts.md](video-director-concepts.md) v2, concept #4
**Lane:** sensorial · faceless + hair-out · calm body with arrested-motion hook
**Target output:** 15s · 9:16 · Meta Reels · sound-on-and-off readable
**Renderer:** Seedance 2.0 via Magnific.com
**Accent color:** `coral-pink` `#f37e72`
**Base:** `bg-cream` `#f8f7f3`

---

## Shot list overview

| # | Beat | Duration in cut | Render duration | Source | Seed image? |
|---|---|---|---|---|---|
| 01 | Hook — feather appears + dissolves + absorbs into product | ~3s | 5s (Seedance min) | Magnific / Seedance 2.0 | YES — pluma product photo |
| 02 | hidrata — water bead into silk | ~1.5s | 5s | Magnific / Seedance 2.0 | no (pure text-to-video) |
| 03 | nutre — golden oil into fiber | ~1.5s | 5s | Magnific / Seedance 2.0 | no |
| 04 | repara — frayed silk knits | ~2s | 5s | Magnific / Seedance 2.0 | no |
| 05 | protege — hot rod over silk | ~1.5s | 5s | Magnific / Seedance 2.0 | no |
| 06 | brilha — light gleam across fiber | ~1.5s | 5s | Magnific / Seedance 2.0 | no |
| 07 | Offer card — bottle + tagline + 'ge' seal | 4s | n/a | Built in editor | n/a |

**Total render budget:** 6 clips × ~5s × ~$0.30/s ≈ **$9** at worst. Cheaper if Magnific routes to a lite tier for the abstract vignettes.

---

## Render in this order

1. **Shot 01 alone first** → drop in `clips/`, ping me for review before continuing.
2. **Shots 02-06** in any order once shot 01 is greenlit.

---

═══════════════════════════════════════════════
▼ START — Shot 01: Hook (image-to-video)
═══════════════════════════════════════════════

SEED / INPUTS
  Wire the **leave-in pluma product photo** (the actual spray bottle) into the Video Generator's image input.
  In your Magnific canvas this is the same setup as your screenshot — the image node connected to the Video Generator node.

PROMPT (copy the code block below):

```
The product remains perfectly static in its current position throughout. A small white feather appears beside the product on the cream surface in the foreground, lit by soft diffused light from upper-left. The feather lies still for about one second. Then the feather slowly dematerializes and transforms into a small, translucent, glossy gel droplet of the same teardrop shape — no falling, no splash, a gentle dissolve. The gel droplet then drifts slowly across the cream surface toward the base of the product and absorbs into it. The product never moves, never rotates, never changes. Camera is static, eye-level macro. Lighting stays warm and diffused throughout. Calm, mature, Aesop-style minimalism. No people, no hair, no hands, no text, no logos other than what is already on the product.
```

UI SETTINGS
  Model:           Seedance 2.0
  Aspect ratio:    9:16
  Duration:        5s
  Resolution:      1080p
  Sound:           off
  Image influence: 70-90% (high — product must stay recognizable)
  Seed:            random (lock only if regenerating with prompt tweaks)

EXPECTED OUTPUT
  Filename:        01-hook.mp4
  Destination:     inputs/video-prototypes/leave-in-pluma/clips/01-hook.mp4
  Post-process:    in editor, trim to ~3s using the cleanest segment of motion

═══════════════════════════════════════════════
▲ END — Shot 01
═══════════════════════════════════════════════

═══════════════════════════════════════════════
▼ START — Shot 02: hidrata (text-to-video)
═══════════════════════════════════════════════

SEED / INPUTS
  No seed image. Disconnect any image input from the Video Generator.

PROMPT (copy the code block below):

```
Extreme macro on a warm cream-colored linen surface. A single piece of dry, slightly rough natural silk thread lies horizontally across the frame. From above, one perfectly clear water droplet falls slowly and lands on the silk thread. As it lands, the droplet immediately absorbs INTO the silk — not rolling off, not pooling — sinking downward into the fiber, leaving the silk's surface visibly more saturated and softly glistening. Calm, slow motion. Soft warm key light from the right. Static camera, eye-level macro. Aesop-style sensorial product photography in motion. No people, no hair, no hands, no skin, no logos, no text.
```

UI SETTINGS
  Model:           Seedance 2.0
  Aspect ratio:    9:16
  Duration:        5s
  Resolution:      1080p
  Sound:           off
  Image influence: n/a (no seed)
  Seed:            random

EXPECTED OUTPUT
  Filename:        02-hidrata.mp4
  Destination:     inputs/video-prototypes/leave-in-pluma/clips/02-hidrata.mp4
  Post-process:    in editor, trim to ~1.5s — keep the absorption moment

═══════════════════════════════════════════════
▲ END — Shot 02
═══════════════════════════════════════════════

═══════════════════════════════════════════════
▼ START — Shot 03: nutre (text-to-video)
═══════════════════════════════════════════════

SEED / INPUTS
  No seed image.

PROMPT (copy the code block below):

```
Extreme macro on warm cream linen. A coarse-textured silk or wool fiber stretches horizontally across the frame. From above, a single drop of warm golden oil (the color of light honey) falls slowly and lands at the center of the fiber. The oil immediately begins to spread outward along the fiber's length in both directions, the fiber visibly softening, becoming smoother and glossier as the oil travels. The motion is slow and continuous — like watching life return to the strand. Side-light from the left catches the oil's gleam. Static camera, eye-level macro. No people, no hair, no hands, no skin, no logos, no text.
```

UI SETTINGS
  Model:           Seedance 2.0
  Aspect ratio:    9:16
  Duration:        5s
  Resolution:      1080p
  Sound:           off
  Image influence: n/a
  Seed:            random

EXPECTED OUTPUT
  Filename:        03-nutre.mp4
  Destination:     inputs/video-prototypes/leave-in-pluma/clips/03-nutre.mp4
  Post-process:    in editor, trim to ~1.5s — keep the oil-spread moment

═══════════════════════════════════════════════
▲ END — Shot 03
═══════════════════════════════════════════════

═══════════════════════════════════════════════
▼ START — Shot 04: repara (text-to-video)
═══════════════════════════════════════════════

SEED / INPUTS
  No seed image.

PROMPT (copy the code block below):

```
Extreme macro on a cream-colored surface. A single piece of natural silk thread lies in frame, but it is visibly damaged — frayed at the middle, split into many fine fly-aways like a broken strand. In a calm time-lapse, the frayed fibers slowly retract and knit back together into a single smooth thread over the duration of the shot, ending as a perfectly intact strand. The repair is visible but subtle — fibers slide back into alignment, the break heals end-to-end. Soft warm overhead light. Static camera, eye-level macro. No people, no hair, no hands, no skin, no logos, no text, no magical sparkles.
```

UI SETTINGS
  Model:           Seedance 2.0
  Aspect ratio:    9:16
  Duration:        5s
  Resolution:      1080p
  Sound:           off
  Image influence: n/a
  Seed:            random

EXPECTED OUTPUT
  Filename:        04-repara.mp4
  Destination:     inputs/video-prototypes/leave-in-pluma/clips/04-repara.mp4
  Post-process:    in editor, trim to ~2s — keep the strongest repair segment. This shot is the riskiest (complex motion); be ready to regenerate 2-3 times.

═══════════════════════════════════════════════
▲ END — Shot 04
═══════════════════════════════════════════════

═══════════════════════════════════════════════
▼ START — Shot 05: protege (text-to-video)
═══════════════════════════════════════════════

SEED / INPUTS
  No seed image.

PROMPT (copy the code block below):

```
Extreme macro on cream linen. A polished matte chrome metal rod glows with faint heat-shimmer rising off it. The rod is held horizontally, just above a perfectly aligned silk panel laid flat below. The rod slowly approaches the silk panel from the right, lowers until it almost touches, hovers, then lifts away. The silk panel stays perfectly intact, no scorch, no curl, no discoloration. The visible heat haze in the air is the only motion besides the rod itself. Static camera, slight forward dolly. No people, no hair, no hands, no skin, no fire, no smoke, no logos, no text.
```

UI SETTINGS
  Model:           Seedance 2.0
  Aspect ratio:    9:16
  Duration:        5s
  Resolution:      1080p
  Sound:           off
  Image influence: n/a
  Seed:            random

EXPECTED OUTPUT
  Filename:        05-protege.mp4
  Destination:     inputs/video-prototypes/leave-in-pluma/clips/05-protege.mp4
  Post-process:    in editor, trim to ~1.5s — keep the moment the rod hovers and lifts away with silk intact

═══════════════════════════════════════════════
▲ END — Shot 05
═══════════════════════════════════════════════

═══════════════════════════════════════════════
▼ START — Shot 06: brilha (text-to-video)
═══════════════════════════════════════════════

SEED / INPUTS
  No seed image.

PROMPT (copy the code block below):

```
Extreme macro on a cream-colored surface. A polished natural silk fiber stretches diagonally across the frame. A slow, soft band of light begins at one end of the fiber and travels along its length to the other end over the full duration of the shot, illuminating each section as it passes — the fiber gleams sequentially, then the entire fiber holds a soft glow at the end. The light is warm-cream colored, soft, never harsh. Static camera, eye-level macro. No people, no hair, no hands, no skin, no rainbow colors, no sparkles, no logos, no text.
```

UI SETTINGS
  Model:           Seedance 2.0
  Aspect ratio:    9:16
  Duration:        5s
  Resolution:      1080p
  Sound:           off
  Image influence: n/a
  Seed:            random

EXPECTED OUTPUT
  Filename:        06-brilha.mp4
  Destination:     inputs/video-prototypes/leave-in-pluma/clips/06-brilha.mp4
  Post-process:    in editor, trim to ~1.5s — keep the moment the light has traveled the full length

═══════════════════════════════════════════════
▲ END — Shot 06
═══════════════════════════════════════════════

═══════════════════════════════════════════════
▼ START — Shot 07: Offer card (built in editor, NOT rendered)
═══════════════════════════════════════════════

SEED / INPUTS
  Built directly in After Effects / DaVinci Resolve / CapCut. No Seedance render needed.

COMPOSITION (4s static-with-subtle-animation)

```
┌─────────────────────────────────────────┐
│                                         │
│      [bg-cream #f8f7f3 background]      │
│                                         │
│   [leave-in pluma bottle, centered]     │
│                                         │
│   [coral-pink #f37e72 horizontal band]  │
│                                         │
│         5 em 1, sem pesar.              │  ← caption: coral lowercase, Italian Plate
│                                         │
│                                         │
│      no seu tempo, do seu jeito.        │  ← tagline: coral lowercase, Italian Plate No2 Expanded Extrabold
│                                         │
│              [ge seal]                  │  ← A/B test: static vs animated
│                                         │
└─────────────────────────────────────────┘
```

ASSETS NEEDED
  - High-res leave-in pluma bottle photo (transparent BG or cream BG)
  - Italian Plate font family (or your editor's closest match)
  - 'ge' ligature SVG/PNG (extract from brandbook or product photo)

A/B VARIANTS
  Variant A: static 'ge' seal, ~0.5s hold
  Variant B: animated 'ge' formation, ~0.7s
  Ship both, let Meta decide

═══════════════════════════════════════════════
▲ END — Shot 07
═══════════════════════════════════════════════

---

## After rendering — what I do

When you ping me with "clips ready" (and the 6 mp4s are in `clips/`), I will:

1. **Review each clip** against its prompt and the calm/hair-out constraints.
2. **Flag any that need regenerating** — I'll send back targeted prompt tweaks per shot in the same framework above.
3. **Write the assembly script** for your editor of choice (DaVinci Resolve, After Effects, or CapCut — let me know which) including:
   - Timeline order and exact in/out points per clip
   - Caption styling (font, color, size, position, duration)
   - Audio mix: ASMR per shot + ambient pad + hook sting (will reference free stock libraries you can pull from)
   - Offer card composition steps with the 'ge' seal A/B variants
4. **Watch v1 with you** and decide if the approach validates the broader skill direction.

---

## Audio direction (for assembly, not render)

Build the audio stack in your editor — Seedance audio output is variable, plan to replace it with curated layers:

| Layer | Source suggestion | When |
|---|---|---|
| ASMR sensorial | Splice / Artlist / hand-recorded foley | One sound per shot: feather dissolve, water absorption, oil spread, silk-repair whisper, heat shimmer, light gleam |
| Ambient pad | Stock warm-piano or soft-synth bed at -18 dB | Continuous under shots 02-06 |
| Hook sting | Single soft piano note (C4 or G4) | At 0:01 on the feather dissolve in shot 01 |
| Captions | Italian Plate fonts, coral on cream | Hook caption at 0:00.5; vignette captions per shot; offer card 11.0-15.0 |

---

## Caption schedule (for assembly)

| Time in final cut | Caption text | Style |
|---|---|---|
| 0:00.5 - 0:02.5 | `pluma.` | small, coral, lowercase, lower-third |
| ~2.0 - ~3.5 | `hidrata` | coral lowercase, lower-third |
| ~3.5 - ~5.0 | `nutre` | coral lowercase, lower-third |
| ~5.0 - ~7.0 | `repara` | coral lowercase, lower-third |
| ~7.0 - ~8.5 | `protege` | coral lowercase, lower-third |
| ~8.5 - ~10.0 | `brilha` | coral lowercase, lower-third |
| 11.0 - 13.0 | `5 em 1, sem pesar.` | larger, coral, centered above bottle |
| 13.0 - 15.0 | `no seu tempo, do seu jeito.` | largest, coral, Italian Plate No2 Expanded Extrabold, centered, with 'ge' seal |
