# /video-director — handover (brain transfer)

**Date:** 2026-05-25
**From:** cpg-labs session (originating repo)
**To:** nami-works/sandbox/gebeauty/ (this repo, going forward)
**Status:** mid-build, validated through Phase 4. Resume from Phase D (assembler).

---

## TL;DR

- **What this is:** `/video-director` is an autonomous video-creative director skill for GE Beauty (extensible to future CPG Labs brands). It reads product benefits from Shopify, reasons through a locked brand constitution, dispatches image-to-video renders to fal.ai (Seedance / Veo 3 / Kling 2.5 / Hailuo), auto-reviews each clip, regenerates failures, assembles ship-ready Meta ad packages, and drops them in `state/<concept>/output/` for the traffic specialist to upload.
- **Where we are:** Phases 0-4 are complete. The brain (Steps 1-5 reasoning) was validated end-to-end on `primer-cachos-definidos-v1`. All 3 base shots rendered, reviewed PASS, and live at [state/primer-cachos-definidos-v1/clips/](state/primer-cachos-definidos-v1/clips/).
- **What's left:** ffmpeg assembler (Phase D/6), variants A+B (Phase E/F/8), drop-folder writer + README (Phase G/9). All scaffolding exists; no architectural decisions remain open.
- **Budget:** $3.42 spent of $20 cap (Lucas approved $20 for this work block). Plenty of headroom for remaining phases.
- **Critical lesson:** Lucas's redirect mid-build — "the texture of the product won't add recognition; the sound of blowdryer would go a long way." This reframed Shot 1 from a texture-mound demo to an absence-of-effect demo (chrome dryer present, bottle untouched), with the **audio carrying the meaning**. Same principle applies to all future shots: visuals stay subtle and on-brand, **audio carries the day-arc narrative**.

---

## What `/video-director` is

**The skill that takes a Shopify product GID and produces a Meta-ready ad package, autonomously, with one approval gate (budget).**

### The 5-step in-session brain

| Step | Type | What it does |
|---|---|---|
| 1. Ingest | deterministic + Shopify MCP | Reads product metafields (finalidade, beneficio_em_destaque_1/2/3, imagem_beneficio_em_destaque_1/2/3, caracteristicas), validates, populates state |
| 2. Benefit → Moment mapper | LLM (in-session) | Each benefit gets mapped to ONE moment in Marcela's day with sensory + audio anchor |
| 3. Narrative sequencer | LLM (in-session) | Moments → ordered 3-5 shot arc (day-arc default for daily-routine products) |
| 4. Shot synthesizer | LLM (in-session) | Per shot: Seedance/Veo/Kling/Hailuo prompt + seed image + model routing + audio layers |
| 5. Ad copy generator | LLM (in-session) | Meta-ready text in Marcela voice (primary_text ≤125, headline ≤27, link desc ≤30, CTA enum) |

After Step 5, **mandatory budget gate**. After approval, the pipeline:

- Step 6: dispatch to fal.ai (parallel via ThreadPoolExecutor)
- Step 7: download MP4s, extract frames
- Step 8: auto-review with 1-5 rubric (hook strength / sensorial / brand match); regen on FAIL with prompt mutation, max 3 attempts per shot
- Step 9: ffmpeg assembler — concat shots, 9:16 conform, burn captions, mix audio, append closing card with tagline + 'ge' seal
- Step 10: drop folder + README for the traffic specialist

### Why this lives in nami-works (not cpg-labs)

- **nami-works = brand operational tooling.** GE Beauty's creative tooling belongs here alongside `cashback/`, `hexagon/`, `quiz/`, etc.
- **cpg-labs = the platform.** Embedded Shopify app code. `/video-director` is brand-specific (Marcela persona, Italian Plate font, the locked palette), so it doesn't belong in the platform repo.
- The originating session ran in cpg-labs because the Shopify MCP was wired there and the brandbook PDF lived under nami-works as a working directory; the work was always destined for this repo.

---

## Status as of 2026-05-25

### Build phases

| Phase | Description | Status |
|---|---|---|
| 0 | IP constitution — persona + brand grammar + shot archetypes + anti-patterns | ✅ Done — [docs/ip.md](docs/ip.md) |
| 1 | Shopify metafield map — discover canonical benefit fields | ✅ Done — [docs/metafield-map.md](docs/metafield-map.md). Pattern verified on `primer cachos definidos` + `leave-in pluma`: every product has `custom.finalidade` + `custom.beneficio_em_destaque_1/2/3` + paired `custom.imagem_beneficio_em_destaque_1/2/3` + `custom.caracteristicas` rich-text |
| 2 | fal.ai wrapper + 4-model bake-off | ✅ Done — [scripts/fal_wrapper.py](scripts/fal_wrapper.py), [scripts/bake_off.py](scripts/bake_off.py). Bake-off ran on the heat-deflection shot; routing locked: Veo 3 wins deflection (cleanest anti-prompt fidelity), Seedance Pro wins drop hooks, Kling 2.5 wins high-motion, Hailuo for sun/warmth. Cost reference: Seedance Pro $0.74/5s, Veo 3 $0.60/6s, Kling 2.5 $0.50/5s, Hailuo $0.20/6s @ 768P |
| 3 | state.json schema + Python helpers | ✅ Done — [docs/state-schema.md](docs/state-schema.md), [scripts/state.py](scripts/state.py). 10-state top-level machine (DRAFT → DELIVERED), 8-state per-shot machine, file-lock discipline, atomic writes, event audit log, lifecycle invariants enforced. Self-test PASSED including negative validation cases |
| 4 | The brain (Steps 1-5) + SKILL.md protocol | ✅ Done — [../../../.claude/skills/video-director/SKILL.md](../../../.claude/skills/video-director/SKILL.md). Validated end-to-end on `primer-cachos-definidos-v1`: 3 benefits → 3 moments → 3-shot day-arc → 3 prompts with model routing → ad copy → budget gate. State at ALL_PASS |
| 5 | Dispatch + poll + auto-review scripts | ⏳ Partial — dispatch logic exists inline in run scripts; **need `scripts/dispatch.py` + `scripts/poll.py` + `scripts/review.py` extracted**. Auto-review rubric still manual (I scored by reading frames; no Python automation yet) |
| 6 | ffmpeg assembler | ❌ Not started — `imageio-ffmpeg` is installed (`python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"` confirms ffmpeg 7.1 bundled). **Need `scripts/assemble.py`** that: concats shots in order, per-shot 9:16 conform (crop or letterbox), burns captions per `state.ad_copy`, mixes audio layers, appends closing card with tagline + 'ge' seal |
| 7 | Ad copy in brain | ✅ Covered by Step 5 of the brain |
| 8 | Variant mode (1+2 default) | ⏳ Designed, not implemented. **Variant A direction locked for primer-cachos: reverse-teaser arc** (open with evening warm light, then morning, then afternoon — zero new render cost). **Variant B: copy-only** (different angle on same benefits, no new render). Need `scripts/variants.py` |
| 9 | Drop folder writer + README generator | ❌ Not started — **need `scripts/deliver.py`** that writes `state/<concept>/output/base/` `output/variant-a/` `output/variant-b/` each with `creative.mp4` + `thumbnail.jpg` + `captions.srt` + `copy.txt` + a top-level `README.md` for the traffic specialist |

### primer-cachos-definidos-v1 — current snapshot

- **State:** `ALL_PASS` (all 3 base shots reviewed PASS)
- **Spent:** $3.42 of $10 brief cap
- **Shots:**

| ID | Model | Render | Verdict | Notes |
|---|---|---|---|---|
| 01-morning-styling | seedance-pro (smoke-test reuse, $0) | [state/primer-cachos-definidos-v1/clips/01-morning-styling.mp4](state/primer-cachos-definidos-v1/clips/01-morning-styling.mp4) | PASS 12/15 | Chrome dryer enters from right, bottle untouched. Meaning carried by blow-dryer audio in assembly. **Reused the Phase 2 smoke-test clip** after Lucas rejected the texture-mound v2. |
| 02-afternoon-rain | veo-3 ($0.60 + $0.60 regen = $1.20) | [state/primer-cachos-definidos-v1/clips/02-afternoon-rain.mp4](state/primer-cachos-definidos-v1/clips/02-afternoon-rain.mp4) | PASS 15/15 | Torrential downpour with dramatic cascading deflection arcs around the bottle. v2 regen after v1 was "too gentle". Veo 3 nailed it. |
| 03-evening-arrival | seedance-pro ($0.74) | [state/primer-cachos-definidos-v1/clips/03-evening-arrival.mp4](state/primer-cachos-definidos-v1/clips/03-evening-arrival.mp4) | PASS 14/15 | Slow warm golden light sweeps right-to-left, revealing the gleam on the glossy bottle. Lighting transitions neutral → golden. Clean, on-brand, no regen needed. |

- **Ad copy (Marcela voice):**
  - primary_text: *"definição leve, 24h sem frizz, brilho que dura. seus cachos, do começo ao fim do dia."*
  - headline: *"24h sem frizz, sem peso."*
  - link_description: *"conheça primer cachos."*
  - cta_button: `Saiba mais`
  - caption_offer: `24h sem frizz.`
  - caption_tagline (locked, every video): `no seu tempo, do seu jeito.`

- **Per-shot audio direction (for assembly):**
  - Shot 01: **blow-dryer hum dominant continuous** (THE storytelling carrier per Lucas) + soft warm pad swell + bathroom-tile ambience
  - Shot 02: rain on glass + droplet impacts on cream marble + wet-street ambient
  - Shot 03: indoor calm + soft household ambience + subtle pad resolve at 0:03
  - Captions: only 2 per video — `definição.` hook caption (0:00.5-2.5s) + `24h sem frizz.` + tagline + 'ge' seal in closing card

Full state with all 29 events + budget breakdown: [state/primer-cachos-definidos-v1/state.json](state/primer-cachos-definidos-v1/state.json)

---

## Locked decisions log

Every creative or technical decision Lucas made, with the reasoning. If you find yourself wanting to override one of these, surface the call to him first.

### Creative constitution (from [docs/ip.md](docs/ip.md))

1. **Faceless + hair-out.** No AI-generated humans or hair. Reason: misleading-claim risk on Meta. Hands OK (manipulating product), skin/arms OK in body-splash context only.
2. **Marcela Costa, 34 — the persona.** Brazilian, restless, mature, smart-friend tone. "Yoga e hambúrguer." Always moving except in sacred self-care windows. Rejects clichés, joke-y voice, arrogance. **Day shape: morning (hurried styling), midday (transit + sun), afternoon (weather/demands), evening (arrival home decompression), exercise overlay (outdoor sports, sweat + sun — anchored to `dupla protetor solar do cabelo` R$174 kit).**
3. **Tagline LOCKED:** `no seu tempo, do seu jeito.` — closing card every video, Italian Plate No2 Expanded Extrabold, coral on cream, lowercase.
4. **Color palette LOCKED:** 9 colors from brandbook page 14. `bg-cream #f8f7f3` is the default BG (warm, never pure white). Coral `#df3630` is the brand primary. Per-product accent: shampoo/máscara/leave-in = cream-only; pluma = coral-pink #f37e72; mayday = red-mayday; primer liso = teal #80cecc; primer cachos = yellow-sun #ffd48d; melon mood = orange #f58939; shampoo a seco = pink-lilac #d1a6cc; all 5 boosters = mint-booster #aed2c2.
5. **Calm body + kinetic moment at hook.** Every hook is "arrested motion" (droplet about to fall, foam just blooming, feather suspended) that completes calmly. No explosions, no fast cuts, no camera shake.
6. **Invisible field via behavior only.** When the brief calls for protection (heat, humidity, sun), describe the behavior of the environment AROUND the product — never the field itself. **Banned nouns in prompts:** field, bubble, dome, boundary, shield, barrier, halo, aura. They trigger visible-substance hallucination.
7. **Light caption density.** Exactly 2 captions per video: hook caption (0:00.5-2.5s) + offer caption. Plus the tagline in the closing card. No sub-line captions per beat.
8. **Witness-prop archetype CUT.** Originally discovered as a workaround for "invisible airflow" (paper fluttering as proof of wind), then Lucas rejected: "Don't really like the paper reacting to invisible force metaphor. Cut it." Use pure deflection demonstration without secondary props.
9. **Lançamento framing CUT.** No "new!" badges or animated burst moments — product carries itself.
10. **The brand at large uses faces + hair** (Instagram, print). But this skill's output is AI-generated-creative-only, so the stricter rule applies. Don't push back on the brand-wide use of faces; the constraint is production-method.

### Technical stack (from [docs/state-schema.md](docs/state-schema.md), [scripts/](scripts/), .env)

11. **Renderer: fal.ai** (cleaner API than Magnific, per-call billing, 4-model access). `FAL_KEY` already in `.env` for cpg-labs; **need to copy that env var to nami-works .env when resuming**. Verify with `python -c "from dotenv import load_dotenv; load_dotenv(); import os; assert os.environ.get('FAL_KEY')"`.
12. **Model routing locked:**
    - Heat / deflection / "absence of effect" → **Veo 3** (`fal-ai/veo3/image-to-video`, `extra_args={"duration": "6s"}` since Veo only accepts 4s/6s/8s)
    - Drop hook (droplet, foam, pour) → **Seedance Pro** (`fal-ai/bytedance/seedance/v1/pro/image-to-video`)
    - High-motion (fluttering, fabric, fluid) → **Kling 2.5 Pro** (`fal-ai/kling-video/v2.5-turbo/pro/image-to-video`)
    - Sun / golden-hour / warmth → **Hailuo 02** (`fal-ai/minimax/hailuo-02/standard/image-to-video`, `extra_args={"duration": "6", "resolution": "768P"}`)
    - Default fallback: Seedance Pro
13. **Aspect ratio: native per model**, post-conform in Phase 6 assembler (crop or letterbox per shot's `rendered_aspect`). Veo and Hailuo each have their own native preference; let them render at their native and conform in post. **Verified in dispatch: when `aspect_ratio="9:16"` is passed via the standard arg (not just `extra_args`), Veo DOES output 9:16. Hailuo at standard tier is locked to 768P square or 512P.**
14. **In-session reasoning, no Anthropic API key needed.** The brain (Steps 2-5) runs as in-session LLM reasoning (this Claude session). The polling/dispatch/assemble layers are pure Python.
15. **Local Claude Code session as the host** (not Lightsail cron). Lucas explicitly chose simpler architecture: dedicated machine keeps a session open. Production cron deferred until we're producing 5+ videos/week.
16. **No Meta API integration.** Output is files in `state/<concept>/output/` — traffic specialist uploads by hand. Meta API integration explicitly out of scope.
17. **Variant default: 1+2.** Every brief produces 3 packages: base + variant A (hook variation) + variant B (copy variation). Variant B is copy-only (no new render). Variant A re-runs Step 3 (narrative sequencer) with constraint twist. Cost ≈ 1.4× base.
18. **High-strictness auto-review.** Each clip rated 1-5 on hook strength, sensorial quality, brand match. PASS ≥ 12/15. Max 3 attempts per shot with prompt mutation between attempts. After 3 failures, escalate.

### Operational discipline

19. **Mandatory budget gate**, after Step 5, before any render. User explicitly approves estimated spend.
20. **Brand assets canonical location:** `nami-works/sandbox/gebeauty/.brand-assets/Logo/` (Google Drive-synced from `G:\Drives compartilhados\GEB_Marketing\Materiais da marca`). Use `ge_beauty_logo-01.png` (210KB, official vector-derived) or `1500x1500.png` for hi-res. **Vector .ai source is `.brand-assets/Logo/ge_beauty_logo.ai`** for any rebuild work.
21. **Font for tagline:** Italian Plate No2 Expanded Extrabold (Klim Type Foundry, licensed). **Currently not in `.brand-assets/fonts/` — empty except __MACOSX cruft.** Substitute: Inter ExtraBold (downloaded but only in cpg-labs/nami-works/sandbox/gebeauty/brand-assets/, NOT this repo's .brand-assets). Decide before assembly: use Inter for v1 and re-export when Italian Plate arrives, or get the .ttf from Lucas.
22. **External-tool handoff framework:** any chunk meant for an external tool (renderers, etc.) wraps each chunk in clear START/END boundaries + raw-markdown prompt block + explicit UI settings + expected output. See `memory/feedback_external_tool_handoff_framework.md` in the cpg-labs memory.
23. **No em-dashes in customer-facing copy.** Use commas/periods. Locked feedback rule.

---

## Lessons learned this session

### The four failed renders + what each taught

1. **v1 heat haze with "orange-tinted" prompt** → Seedance rendered FIRE. Lesson: any color hint pushes models toward fire interpretation. Strip color from anti-renderable physics.
2. **v2 heat haze with "transparent refractive distortion"** → Seedance rendered WATER swirl around bottle. Lesson: "refractive" triggers liquid interpretation. Use behavioral-only language.
3. **v3 with "invisible bubble surrounds the bottle"** → Seedance rendered a literal GLASS DOME. Lesson: ANY noun for a boundary (bubble, field, dome, shield) gets rendered visibly. **Never name the protection — only describe the BEHAVIOR around it.**
4. **v4 with "three paper pieces at graduated distances"** (witness-prop hook) → Lucas rejected: "Don't really like the paper reacting to invisible force metaphor. Cut it." Lesson: clever creative workarounds can still feel kitsch. Pure absence-of-effect + audio storytelling beats props.

### The texture-mound pivot

- **Initial Shot 1 (Seedance):** clear glossy gel POOL appeared around the bottle base. Wrong texture — primer cachos is gel-creme (pale ivory, slight opacity), not transparent.
- **v2 with corrected texture description + reference to PDP "Textura Gel Creme" callout:** Seedance produced a beautiful pale-ivory soft-serve mound next to the bottle. Visually striking.
- **Lucas's verdict:** "The texture of the product won't add recognition by the audience. Rather, the sound of blowdryer would go a long way on that." → texture-mound is the wrong creative direction. The bottle IS the recognition vehicle.
- **Final Shot 1 (smoke-test reuse):** the Phase 2 smoke-test clip that just showed "chrome dryer + bottle untouched + nothing dramatic happening" — turns out THAT'S the right answer. Meaning lands via audio (blow-dryer hum) in assembly.
- **Generalizable rule:** when a creative beat feels "weak" visually, the answer is usually MORE audio + LESS visual drama, not a flashier visual.

### What "torrential rain" looks like via Veo 3

The first rain shot read as "gentle drops" — not dramatic enough. v2 prompt added: *"TORRENTIAL DOWNPOUR, dense sheets of water, hundreds of droplets per second, like a tropical storm. The rain is visible as continuous streaks and falling sheets, not as individual drops."* Plus described the deflection as "cascading sheets" arcing left/right. Veo 3 delivered exactly that. Capital letters for emphasis on "TORRENTIAL DOWNPOUR" appears to help. Lesson: be loud and specific about magnitude when models default to subtle.

### Model-specific quirks discovered

- **Veo 3** has the cleanest anti-prompt fidelity but its default aspect is 16:9. Pass `aspect_ratio="9:16"` explicitly via the standard arg, not just `extra_args`, and it complies.
- **Hailuo 02 standard** tier is locked to 512P or 768P (no 1080p), and 6s or 10s (no 5s). Use `extra_args={"duration": "6", "resolution": "768P"}`.
- **Seedance 2.0** is referenced by Lucas (Magnific routes there) but the fal.ai endpoint we used was Seedance 1.0 Pro. 2.0 isn't on Western aggregators yet as of 2026-05.
- **Kling 2.5 Pro** adds subtle warm halos around heat sources by default — useful for moments where warmth IS the point, problematic when you want pure "absence of effect."

---

## Budget tracking

| Item | Cost | Notes |
|---|---|---|
| Phase 2 smoke test (Seedance Pro) | $0.74 | First validation of the wrapper. Clip was later reused as Shot 1. |
| Phase 2 bake-off (Kling + Veo + Hailuo) | ~$1.30 | Heat-deflection prompt across 4 models for routing decisions. |
| Base 3 shots dispatch | $2.08 | Seedance Pro + Veo 3 + Seedance Pro |
| Shot 1 v2 regen (texture mound, rejected) | $0.74 | Lesson: texture doesn't sell, audio does. |
| Shot 2 v2 regen (torrential rain) | $0.60 | Final v2 PASS 15/15. |
| **Total spent** | **$5.46** | Across both bake-off and primer-cachos-definidos-v1 work |
| Remaining of $20 cap | **$14.54** | Plenty for variants + future concepts |

Note: the `state.json` records spent_usd = $3.42 because the bake-off renders aren't booked against this specific concept (they were Phase 2 infrastructure). The $5.46 figure is total session spend on fal.ai.

---

## Next steps in priority order

Resume from here. Each step has its acceptance criteria spelled out.

### 1. Set up env in nami-works (5 min, must do first)

```bash
# Copy FAL_KEY from cpg-labs to nami-works .env
# Check the cpg-labs .env (don't print value):
grep "^FAL_KEY=" "C:\Users\Lucas Guimarães\Desktop\cpg-labs\.env" | sed 's/=.*/=<redacted>/'
# Verify nami-works .env doesn't have it yet:
grep "^FAL_KEY=" .env 2>/dev/null || echo "not in nami-works .env yet"
# Then manually add the value to nami-works .env (don't paste it in chat)
```

Verify:
```bash
python -c "from dotenv import load_dotenv; load_dotenv(); import os; assert os.environ.get('FAL_KEY'), 'FAL_KEY missing'; print('env OK')"
```

### 2. Build Phase 6: ffmpeg assembler (~2h)

**File:** `scripts/assemble.py`

**Requirements:**
- Take `--concept-id` arg (default to `primer-cachos-definidos-v1` for first test)
- Read `state/<concept-id>/state.json`
- Verify `state.state == "ALL_PASS"` (else error)
- For each variant (base + A + B):
  - Concat shots in `narrative_arc[]` order
  - Per-shot 9:16 conform (crop or letterbox per `rendered_aspect`)
  - Mix audio layers (need to find/generate audio assets — see open question below)
  - Burn captions: hook caption at 0:00.5-2.5s + offer caption + tagline in closing card
  - Build closing card: cream BG + tagline in Italian Plate / Inter ExtraBold + 'ge' seal from `.brand-assets/Logo/ge_beauty_logo-01.png`
  - Output to `state/<concept-id>/output/<variant>/creative.mp4`
- Write thumbnail.jpg (best cover frame from shot 1)
- Write captions.srt (subtitle file)
- Update state: transition to `ASSEMBLED`, fill `state.assembly{}`

**ffmpeg binary:** use `imageio_ffmpeg.get_ffmpeg_exe()` to avoid PATH issues.

**Estimate:** 2 hours focused work. No render spend.

### 3. Resolve the audio question (~30 min decision + 30 min execution)

Lucas said "try seedance" for audio (Seedance 2.0 has audio generation per ByteDance). **But our wrapper uses Seedance 1.0 Pro on fal.ai, and the `sound: false` param is currently set.** Three options:

- **A. Use Pixabay / CC0 audio.** Download blow-dryer hum, torrential rain, indoor calm pad from Pixabay's free audio library. License: CC0, commercial OK. Drop in `state/<concept>/audio/`. Reference in `assemble.py`. Fastest path, decent quality.
- **B. Re-render with Seedance audio enabled.** Costs ~$2.20 if 3 base shots re-rendered with `sound: true` (assuming Seedance accepts it — not yet verified). Risk: 1.0 Pro may not have audio at all; that's a 2.0 feature.
- **C. Ship silent v1, audio in v2.** Captions carry meaning. Traffic specialist adds audio post-upload. Cleanest scope.

Recommendation: **A** (Pixabay) for first ship. Validates the assembler. Re-render with Seedance audio in v2 if Lucas wants higher-fidelity audio later.

### 4. Build Phase 8: variant mode (~1.5h)

**File:** `scripts/variants.py`

For `primer-cachos-definidos-v1` specifically, the variant directions are LOCKED:

- **Variant A — reverse-teaser arc** (zero new render cost): same 3 shots, sequenced as `03-evening-arrival` → `01-morning-styling` → `02-afternoon-rain` (the "after-state hook" — open with the gleam, then show how the day got there). Same ad copy as base.
- **Variant B — alternative angle copy** (zero new render cost): same 3 shots in base order, but `ad_copy` re-runs Step 5 with a constraint twist. Suggested angle: ritual-led instead of benefit-led. Example: *"todo dia, do seu jeito. cachos definidos por 24h."* Headline: *"cachos do começo ao fim do dia."*

For future products, the variant generator should:
- Variant A: re-invoke Step 3 (narrative sequencer) with the constraint "different opening shot than base" OR "same shots, reversed order"
- Variant B: re-invoke Step 5 with the constraint "different angle on same benefits"

### 5. Build Phase 9: deliver.py (~30 min)

**File:** `scripts/deliver.py`

For each variant produced by Phase 6:

```
state/<concept-id>/output/
├── README.md                    # written by deliver.py — see template below
├── base/
│   ├── creative.mp4
│   ├── thumbnail.jpg
│   ├── captions.srt
│   └── copy.txt                 # primary_text, headline, link_description, CTA, formatted for Meta Ads Manager copy-paste
├── variant-a/
│   ├── creative.mp4
│   ├── thumbnail.jpg
│   ├── captions.srt
│   └── copy.txt
└── variant-b/
    ├── creative.mp4
    ├── thumbnail.jpg
    ├── captions.srt
    └── copy.txt
```

**README.md template (for the traffic specialist):**

```markdown
# <Concept label> — Meta package
Generated: <date>
Product: <product title> (gid: <gid>)
Concept: <concept_id>

## Files
3 variants ready for Meta Ads Manager upload.

## Recommended A/B split
- 33% base
- 33% variant-a
- 33% variant-b

(or whatever split makes sense)

## Copy per variant
[for each variant: primary_text, headline, link_description, CTA button name]

## Render history
- Shots: <N> at <total duration>s, total cost $<X>
- Models used: <list>
- Audio: <source>

## Notes
- Aspect: 9:16 vertical
- Length: <N>s
- Brand: GE Beauty
- Tagline: no seu tempo, do seu jeito.
```

Transition state to `DELIVERED` when done.

### 6. (Future) Phase 5: extract dispatch + poll + auto-review into proper scripts

Currently the brain inline-dispatches via ad-hoc Python in chat. To make truly autonomous (run without me babysitting):

- `scripts/dispatch.py --concept-id <id>` — reads state, dispatches all PENDING shots to fal.ai, sets to RENDERING
- `scripts/poll.py --concept-id <id>` — polls fal.ai job statuses, downloads MP4s when ready, marks DOWNLOADING → AUTO_REVIEW
- `scripts/review.py --concept-id <id> --shot-id <sid>` — extracts frames, scores against rubric (manual scoring me-in-chat OR future automated vision pass), marks PASS or REGEN_QUEUED

For now (v1) these are inlined. Build them out before scaling to 2nd product.

---

## How to resume — quick start

Once the env is set up:

```bash
cd "C:\Users\Lucas Guimarães\Desktop\nami-works"

# 1. Verify the state from the previous session is intact
python sandbox/gebeauty/video-director/scripts/state.py 2>&1 | head -3
# Should print: state.py smoke test PASSED (or similar)

# 2. Read the snapshot
python -c "
import sys
sys.path.insert(0, 'sandbox/gebeauty/video-director/scripts')
from state import read_state
s = read_state('primer-cachos-definidos-v1')
print(f'state: {s[\"state\"]}')
print(f'shots: {[(sh[\"shot_id\"], sh[\"status\"]) for sh in s[\"shots\"]]}')
print(f'spent: \${s[\"budget\"][\"spent_usd\"]}')
"

# 3. Confirm clips exist
ls -la sandbox/gebeauty/video-director/state/primer-cachos-definidos-v1/clips/

# 4. Pick up at Phase 6 (assembler) per "Next steps" above
```

To use the skill in a session:
```
/video-director status --concept-id primer-cachos-definidos-v1
```

Or for a new product:
```
/video-director start --product-gid gid://shopify/Product/<id> --concept-id <slug>
```

---

## Critical gotchas

1. **The 4 banned noun-classes for prompts:** field, bubble, dome, boundary, shield, barrier, halo, aura. Trigger visible-substance hallucination in Seedance / Kling / Hailuo. Veo handles them better but still risky. **Always describe behavior, not the protective thing.**
2. **Three color/substance traps:** "orange-tinted" → fire; "refractive" → water; "invisible <noun>" → visible <noun>. Strip all three from any new prompt.
3. **Hailuo can't do 1080p at standard tier.** 768P max. Plan accordingly OR upgrade to pro tier.
4. **Veo's `duration` accepts only `'4s'` / `'6s'` / `'8s'`.** Hailuo's accepts only `'6'` / `'10'`. Encode in `extra_args`.
5. **state.py file lock has 30s timeout.** If a script dies mid-write, the .lock file persists. Check `state.json.lock` exists; if older than 30s and no process holds it, safe to delete.
6. **The smoke-test clip is at `state/primer-cachos-definidos-v1/clips/01-morning-styling.mp4`** in this repo, but originated as `seedance-pro_heat-deflection_smoke.mp4` in cpg-labs Phase 2 bake-off. Its prompt history (smoke-test version, not what's in the current state.json) is preserved in `state.events[]`.
7. **The texture-mound clip (rejected v2) was deleted from cpg-labs but its existence is logged in `state.shots[0].history`.** If someone asks "what was the v2 that got rejected" — that's the answer.
8. **Brand assets in nami-works are at `sandbox/gebeauty/.brand-assets/Logo/`** (hidden dotfile, Google-Drive-synced). The `fonts/` subfolder is currently empty (just __MACOSX cruft). Italian Plate .ttf needs to come from Lucas before final assembly OR use Inter as substitute and re-export later.
9. **No Anthropic API key needed.** All reasoning is in-session. Don't add `ANTHROPIC_API_KEY` to .env "to be safe" — it's not used by any script in this skill, and could be confused for a different feature.
10. **The brain reasons in Portuguese context but emits English structured data.** Captions, primary_text, etc. are PT-BR. Code (status enums, shot_ids) is English. Don't translate the enums.

---

## Open creative/tech questions (deferred, don't block on these)

1. **Should the closing card 'ge' seal be static or animated (0.7s formation)?** SKILL.md notes A/B test in production. Default to static for v1 simplicity.
2. **Italian Plate font sourcing.** Lucas's Google Drive sync has the fonts/ folder but it's empty. Need to push him on this OR ship with Inter and swap later.
3. **Seedance audio: 1.0 Pro vs 2.0.** Magnific routes to 2.0 which has audio. fal.ai only has 1.0 Pro. Worth a test request to fal.ai support to see if 2.0 is on roadmap.
4. **Variant C ("audio variation") deferred.** SKILL.md mentions it as an off-by-default option. Implement once base 1+2 is shipping.
5. **Auto-review automation.** Currently I score manually by reading frames. To go truly autonomous (overnight runs), need a frame-comparison + claude-api-based scoring pass. Defer until shipping > 5 packages/week.

---

## File inventory (what's in this directory)

```
sandbox/gebeauty/video-director/
├── HANDOVER.md                    ← you are here
├── README.md                       ← quick orientation, one screen
├── docs/
│   ├── ip.md                      ← THE constitution. Read first when reasoning.
│   ├── metafield-map.md           ← Shopify metafield discovery, the 4 content layers
│   ├── state-schema.md            ← state.json shape, lifecycle invariants
│   ├── concepts.md                ← v2 per-product concept doc, 14 hero SKUs
│   ├── prototype-pluma.md         ← parked: leave-in pluma prototype, never built
│   └── prototype-primers.md       ← parked: primers concept, never built (used learnings)
├── scripts/
│   ├── fal_wrapper.py             ← thin wrapper around fal-client SDK
│   ├── state.py                   ← state.json helpers with file-lock discipline
│   └── bake_off.py                ← reusable script for model bake-offs
└── state/
    └── primer-cachos-definidos-v1/
        ├── state.json             ← full lifecycle snapshot, 29 events, ALL_PASS
        └── clips/
            ├── 01-morning-styling.mp4         ← Seedance Pro, heat deflection, 5s, 1088x1920
            ├── 02-afternoon-rain.mp4          ← Veo 3, torrential rain, 6s, 1080x1920
            └── 03-evening-arrival.mp4         ← Seedance Pro, warm light reveal, 5s, 1088x1920
```

Plus:
- **Skill:** `nami-works/.claude/skills/video-director/SKILL.md`
- **Brand assets:** `nami-works/sandbox/gebeauty/.brand-assets/Logo/` (canonical, Google Drive-synced)
- **Brandbook:** `nami-works/sandbox/gebeauty/brandbook/_manualGEbeauty_final.pdf` (43 pages)

---

## References (external)

- **fal.ai docs:** https://fal.ai/models/fal-ai/bytedance/seedance/v1/pro/image-to-video
- **Inter font (substitute for Italian Plate):** https://github.com/rsms/inter (download Bold + ExtraBold .otf)
- **Pixabay free audio:** https://pixabay.com/sound-effects/ (CC0)
- **Brand palette source:** brandbook PDF page 14
- **Persona source:** brandbook PDF page 5

---

## Companion skills in nami-works

- **`/growth-hacker`** — campaign brief originator. Hands off briefs to `/video-director` via the contract in [docs/state-schema.md](docs/state-schema.md) `state.brief{}`.
- **`/integrations-engineer`** — for fal.ai API integration questions, auth issues, rate limits.

---

## Final note from the originating session

Lucas's redirects this session were sharp and right every time:
- "Cut the witness-prop hook" — saved us from a kitsch cliché
- "Texture doesn't add audience recognition; blow-dryer sound would" — flipped the meaning carrier from visual to audio, unlocked the smoke-test reuse
- "Torrential rain, not gentle drops" — got us Veo 3's best work
- "Native formats per platform, I'll assess later" — saved hours of re-rendering for aspect compliance

The system works because it has a strong opinion (the constitution) AND it surfaces blind spots (the budget gate, the per-shot review). Trust both halves when resuming.

Total spent: $5.46 of $20. Real videos generated. Brain validated. **Phase 6 assembler is the unlock to ship-ready packages — start there.**
