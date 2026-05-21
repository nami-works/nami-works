# Prototype 02 — primers resistance (heat · rain · time)

**Products (twin render):**
- **primer liso intacto** · R$139 · 150ml · teal `#80cecc` accent · caption *24h intactos.*
- **primer cachos definidos** · R$149 · 250ml · yellow `#ffd48d` accent · caption *24h sem frizz.*

**Concept:** the primer bottle stands centered on a cream surface. Heat, rain, and a passing day all assault it, but an invisible field deflects everything. The product itself becomes the visual stand-in for the hair the primer protects — the product takes the beating the hair would take.

**Lane:** sensorial · faceless + hair-out · calm body with arrested-motion hook · invisible-field (most-on-brand, implied by behavior only).
**Target output:** 15s · 9:16 · Meta Reels · sound-on-and-off readable.
**Renderer:** Seedance 2.0 via Magnific.com (image-to-video with product photo as seed).

---

## Twin-render strategy

The script renders **TWICE** — once with each primer as the seed image. Same prompts, same UI settings, different seed image. You produce two parallel videos:

- **A-series** (primer liso intacto): A1-heat, A2-rain, A3-time, A4-closer
- **B-series** (primer cachos definidos): B1-heat, B2-rain, B3-time, B4-closer

The only differences between A and B are: (1) seed image, (2) closing caption ("intactos." vs "sem frizz."), (3) accent color (teal vs yellow).

## Shot list overview

| # | Beat | Duration in cut | Render duration | Source | Seed image |
|---|---|---|---|---|---|
| 01 | Heat — blow-dryer haze deflects around product | ~4s | 5s | Seedance 2.0 | YES — primer photo |
| 02 | Rain — droplets bead off invisible dome | ~4s | 5s | Seedance 2.0 | YES — primer photo |
| 03 | Time — sun shifts, shadows sweep, product stays lit | ~4s | 5s | Seedance 2.0 | YES — primer photo |
| 04 | Blur + lettering — closing card with tagline + 'ge' seal | 3s | n/a | Editor | n/a |

**Total:** 12s of rendered material + 3s of editor graphic = 15s output per video × 2 videos = **30s total finished output**.

**Render budget:** 6 Seedance clips × 5s × ~$0.30/s ≈ **$9 per video × 2 = ~$18 worst case**.

---

## How the "invisible field" reads on screen

The field is never drawn. The viewer reads it from how the environment BEHAVES around the product:

- **Heat:** visible warm-orange heat haze curves UP and around the bottle like water flowing around a stone. The haze never enters the volume of space the bottle occupies. The cream backdrop near the bottle stays unmoved while the haze ripples elsewhere.
- **Rain:** droplets fall straight down from above. About 3-5cm above the bottle they hit an invisible curved surface, bead briefly, then slide left and right onto the cream surface beside the product (where they continue beading away). The product surface itself stays bone-dry. No splash on the bottle.
- **Time:** warm sunlight enters and casts a long shadow of the bottle on the cream behind it. Over the shot, the shadow sweeps in a smooth arc (right → down → left), and the light's color shifts (warm-cream → bright-white → warm-orange). The product's own surface stays evenly lit throughout — never gets harsh shadows or hot spots. The world moves; the product doesn't.

**No glowing dome. No coral aura. No sci-fi shimmer.** The protection is implied by the absence of effect on the product itself.

---

═══════════════════════════════════════════════
▼ START — Shot 01: Heat (image-to-video)
═══════════════════════════════════════════════

**SEED / INPUTS**
Wire the **primer product photo** into the Video Generator's image input.
- For A-series (liso intacto): use the primer liso intacto product photo.
- For B-series (cachos definidos): use the primer cachos definidos product photo.

**PROMPT (copy the code block below):**

```
The product remains perfectly static in the center of frame on a warm cream-colored surface, never moving, never rotating. From the right side of frame, visible warm heat haze and shimmering air flow into the scene from off-camera — distortion ripples in the air, faintly orange-tinted, like the output of a powerful hair dryer at full blast. As the heat haze approaches the product, it visibly curves UPWARD and around both sides of the bottle, flowing past it like water around a stone, never touching the bottle's surface and never disturbing the cream background near the bottle. The heat continues to stream past, with the curving deflection pattern remaining consistent throughout the shot. The product stays evenly lit, untouched, unmoved. Camera is static, eye-level, slight forward dolly of about 5 percent over the duration. Calm, mature, Aesop-style minimalism. No people, no hair, no hands, no fire, no smoke, no visible energy field or glow, no logos other than what is already on the product.
```

**UI SETTINGS**
```
Model:           Seedance 2.0
Aspect ratio:    9:16
Duration:        5s
Resolution:      1080p
Sound:           off
Image influence: 70-90% (high — product must stay stable)
Seed:            random (lock only if regenerating)
```

**EXPECTED OUTPUT**
```
A-series: A1-heat-liso.mp4    → inputs/video-prototypes/primers-resistance/clips/
B-series: B1-heat-cachos.mp4  → inputs/video-prototypes/primers-resistance/clips/
Post-process: in editor, trim to ~4s — keep the strongest deflection segment
```

═══════════════════════════════════════════════
▲ END — Shot 01
═══════════════════════════════════════════════

═══════════════════════════════════════════════
▼ START — Shot 02: Rain (image-to-video)
═══════════════════════════════════════════════

**SEED / INPUTS**
Same primer product photo as Shot 01 (A: liso; B: cachos).

**PROMPT (copy the code block below):**

```
The product remains perfectly static in the center of frame on a warm cream-colored surface, never moving, never rotating, never getting wet. From directly above, heavy clear rain droplets fall straight down into frame in slow motion. About three to five centimeters above the top of the product, each droplet meets an invisible curved barrier — the droplets bead, hold for a fraction of a second, then slide outward to the left and to the right along the curve, landing on the cream surface beside the product where they continue beading and gently rolling away from the bottle. No water ever touches the bottle's surface. The bottle stays bone-dry, perfectly clean, evenly lit. The rain continues to fall steadily throughout the shot. Camera is static, eye-level, no movement. Calm, mature, Aesop-style minimalism. No people, no hair, no hands, no visible energy field or glow, no logos other than what is already on the product, no text.
```

**UI SETTINGS**
```
Model:           Seedance 2.0
Aspect ratio:    9:16
Duration:        5s
Resolution:      1080p
Sound:           off
Image influence: 70-90%
Seed:            random
```

**EXPECTED OUTPUT**
```
A-series: A2-rain-liso.mp4
B-series: B2-rain-cachos.mp4
Destination: inputs/video-prototypes/primers-resistance/clips/
Post-process: in editor, trim to ~4s — keep the steadiest rain segment with cleanest bead-and-slide motion
```

═══════════════════════════════════════════════
▲ END — Shot 02
═══════════════════════════════════════════════

═══════════════════════════════════════════════
▼ START — Shot 03: Time / sun (image-to-video)
═══════════════════════════════════════════════

**SEED / INPUTS**
Same primer product photo as Shots 01 and 02.

**PROMPT (copy the code block below):**

```
The product remains perfectly static in the center of frame on a warm cream-colored surface, never moving, never rotating. Warm sunlight enters from the upper-left, casting a long soft shadow of the bottle onto the cream surface behind and to the right of the product. Over the duration of the shot, the shadow sweeps in a smooth slow arc from the right side of frame, down to directly below the product, then to the left side — as if a full day's sun is passing overhead in accelerated time. As the shadow sweeps, the color temperature of the light shifts: starts warm cream-colored at the beginning (morning), becomes bright neutral white at the midpoint (noon), and ends warm-orange at the end (sunset). Despite the shifting light and sweeping shadow on the surrounding cream surface, the product itself stays evenly lit throughout — no harsh shadow ever falls on the bottle, no hot spot ever appears on its label, the bottle's appearance is identical at the start and end of the shot. Camera is static, eye-level, no movement. Calm, mature, Aesop-style minimalism. No people, no hair, no hands, no logos other than what is already on the product, no text.
```

**UI SETTINGS**
```
Model:           Seedance 2.0
Aspect ratio:    9:16
Duration:        5s
Resolution:      1080p
Sound:           off
Image influence: 70-90%
Seed:            random
```

**EXPECTED OUTPUT**
```
A-series: A3-time-liso.mp4
B-series: B3-time-cachos.mp4
Destination: inputs/video-prototypes/primers-resistance/clips/
Post-process: in editor, trim to ~4s — keep the cleanest full-arc shadow sweep
```

═══════════════════════════════════════════════
▲ END — Shot 03
═══════════════════════════════════════════════

═══════════════════════════════════════════════
▼ START — Shot 04: Blur + lettering (built in editor)
═══════════════════════════════════════════════

**SEED / INPUTS**
Built in After Effects / DaVinci Resolve / CapCut. No Seedance render.

**COMPOSITION (3s)**

```
Frame -2s to -3s:
  Take the last frame of Shot 03.
  Apply gaussian blur, ramping from 0 to ~25px over 1 second.
  The bottle dissolves into a soft cream cloud.

Frame -2s to -0.5s:
  Hold the blurred cream background.
  Lettering enters with a gentle fade-up (0.5s fade):

  ┌─────────────────────────────────────────┐
  │                                         │
  │          [blurred cream background]     │
  │                                         │
  │           [accent color band]           │  ← teal for A, yellow for B
  │                                         │
  │            24h intactos.                │  ← A-series caption (liso)
  │              OR                         │
  │            24h sem frizz.               │  ← B-series caption (cachos)
  │                                         │
  │       no seu tempo, do seu jeito.       │  ← tagline, Italian Plate No2 Expanded Extrabold
  │                                         │
  │              [ge seal]                  │  ← A/B test: static vs animated
  │                                         │
  └─────────────────────────────────────────┘

Frame -0.5s to 0:
  Hold the final card. Optional: 0.3s 'ge' seal animation.
```

**ASSETS NEEDED**
- Italian Plate font family (or your editor's closest match)
- 'ge' ligature SVG/PNG
- Accent color hex: teal `#80cecc` (A) / yellow `#ffd48d` (B)
- Brand red for tagline: `#df3630`

═══════════════════════════════════════════════
▲ END — Shot 04
═══════════════════════════════════════════════

---

## Render in this order

1. **Shot 01 of A-series only** (A1-heat-liso) — drop it in `clips/`, ping me for review. If the "heat curves around the product" reads cleanly, the other shots will too. If it reads as "heat just stops near the product" or "the product is on fire", we tune the prompt before burning more budget.
2. Then **Shots 02 and 03 of A-series**.
3. Then **Shots 01-03 of B-series** (swap seed image to primer cachos definidos, same prompts).
4. Total: 6 Seedance renders.

---

## After rendering — what I do

When you ping me with "primers clips ready" (and the 6 mp4s are in `clips/`), I will:

1. **Review each clip** against its prompt — flag any that violate the calm/hair-out/no-glow constraints.
2. **Send back targeted prompt tweaks** in the same framework above for any clip needing a regen.
3. **Write the assembly script** for both videos (A and B) in your editor of choice — timeline order, crossfades, caption timing, audio mix per series.
4. **Watch v1 of both with you** and decide which lands harder.

---

## Audio direction (for assembly, not render)

| Layer | Source suggestion | When |
|---|---|---|
| ASMR sensorial | Splice / Artlist / hand-recorded | Per shot: hair-dryer hum (shot 01), gentle rain (shot 02), faint wind / passing-day ambience (shot 03), soft pad whoosh on the blur (shot 04) |
| Ambient pad | Stock warm-piano or soft-synth bed at -18 dB | Continuous under shots 01-03 |
| Hook sting | Single soft piano note | At 0:01 on the first heat-haze deflection in shot 01 |
| Captions | Italian Plate fonts, coral on cream | Single hook caption + offer card only (light density per locked rule) |

---

## Caption schedule

| Time in final cut | Caption text | Style |
|---|---|---|
| 0:00.5 - 0:03.0 | `protegido.` (or none — test both) | small, coral, lowercase, lower-third |
| 12.0 - 14.0 (A) | `24h intactos.` | larger, coral, centered |
| 12.0 - 14.0 (B) | `24h sem frizz.` | larger, coral, centered |
| 14.0 - 15.0 (both) | `no seu tempo, do seu jeito.` | largest, coral, Italian Plate No2 Expanded Extrabold, centered, with 'ge' seal |

---

## Why this concept is right for the brand

- **Hair-out by design** — the product IS the protected hero, no need for hair proxies.
- **Calm body, kinetic moments at the hook of each shot** — heat haze entering, first raindrop falling, first shadow sweeping. Aesop-tempo, never explosive.
- **Invisible-field implementation** stays inside brandbook *Não é fun* by avoiding sci-fi glow or particle effects.
- **Product as singular hero** ties to brand persona Marcela (mature, calm, equilibrium) — the product holds its center while the world rages around it.
- **Single concept covers both primers** with a one-line swap — efficient line-campaign asset.
