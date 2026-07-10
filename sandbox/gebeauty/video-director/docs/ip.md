# /video-director — IP constitution

**Purpose:** this document is the reasoning constitution for the `/video-director` skill. Every step of the brain (benefit→moment, narrative sequencer, shot synth, ad-copy gen) reads this as system context. It encodes the brand grammar, the locked rules, the proven shot vocabulary, and the failure modes we have seen.

**Source authority:**
- GE Beauty brandbook v1 (M.M.MODE 2020, 43 pages)
- v2 concept doc: [video-director-concepts.md](video-director-concepts.md)
- Prototype storyboards: [prototype-leave-in-pluma.md](prototype-leave-in-pluma.md), [prototype-primers-resistance.md](prototype-primers-resistance.md)
- Session learnings from 3 failed Seedance renders (fire, water, glass dome) and the witness-prop discovery

When this doc conflicts with anything else, this doc wins. Update this first, propagate to the concept docs second.

---

## 1. Persona — Marcela Costa, 34

(Brandbook page 5, extended with day-shape inferences for the day-arc shot archetype.)

**Who she is.** Brazilian, 34, restless, dona de uma segurança invejável. Curious about everything — uma novidade pra compartilhar a qualquer hora. Humor inteligente, elegância, respeito. Equilíbrio é seu lema. Adora gente. Atenta a quem fala. Solar, risonha, doce e firme.

**How she moves through her day.** Always on the move. Mil compromissos. Glued to her phone — except in the windows when she's caring for herself. In those windows, time disappears and she recharges.

**Her shape of the day (inferred for the day-arc):**
- **Morning:** quick, efficient, sometimes hurried — but the self-care window is sacred. Hair styling happens here.
- **Midday:** transit, work, sun. Phone-led. Outdoor between meetings. Sun + busy street as the texture.
- **Afternoon:** the day demands. Possibly weather (rain in São Paulo summer, sun in winter). The product's promise gets tested.
- **Evening:** arrival home, decompression. Warm interior light. The day didn't dim her hair.
- **Exercise / outdoor activity** (may overlay morning, midday, or evening — not every day): outdoor runs, gym, beach. Hair faces sun + sweat + ambient humidity. The brand follows her here too. The specific product anchor for this moment: **dupla protetor solar do cabelo** (kit combining leave-in com proteção térmica + booster antioxidante, R$174) — sealed against UV and oxidation, doesn't weigh hair down during physical activity. When the brain detects a product whose benefits map to outdoor / sport contexts (protetor solar line, antioxidante alone), this becomes a primary beat in the narrative arc.

**Her aesthetic.** "Yoga e hambúrguer" — refuses false purity, refuses heavy indulgence. The narrative tone she likes is: **smart friend, mature confidence, never selling at her**. Plain language. No exclamation marks. No professoral voice.

**What she rejects:** popular clichés, repetitive patterns, joke-y voice, arrogance, anything that feels affected or "fun for fun's sake."

The brain must reason like Marcela is the audience AND the persona projection of the brand. The product speaks to her, in her voice.

---

## 2. Brand grammar — the locked rules

### 2.1 Visual constraints

| Rule | Why | Source |
|---|---|---|
| **Faceless** (no AI-generated humans) | AI-generated faces carry misleading-claim risk on Meta | Production rule, Lucas-locked |
| **Hair-out** (no AI-generated hair) | AI-generated hair carries the same risk; users should never see misrepresented hair | Production rule, Lucas-locked |
| **Hands OK** | When manipulating product (pour, scoop, dropper). Not as beauty shots in themselves | Lucas-locked |
| **Skin / arms** | Allowed in body-splash contexts (e.g., melon mood). No hair-on-skin | Lucas-locked |
| **Cream BG dominant** (`#f8f7f3`) | Brandbook palette, page 14. Warm, soft, never pure white | Brandbook locked |
| **Per-product accent** | Each product line carries its color (see §6) | Brandbook page 42 lineup |
| **Geometric, organized, calm composition on light bg** | Verbatim brandbook rule | Brandbook page 21 |
| **Calm body, kinetic moment in hook** | Aesop-grade tempo; the eye is hooked by impending motion, not explosion | v2 concept doc, Lucas-locked |
| **Invisible field via behavior only** | No glowing dome, no aura, no visible shield. Protection reads from how environment behaves around the product | Lucas-locked; 3 failed renders confirmed |
| **Eye-level macro, slight forward dolly OK** | Camera language for product hero shots | Prototype-tested |
| **Soft diffused warm light from upper-left as default** | Sets the consistent visual identity across all videos | Empirically locked |
| **Italian Plate fonts** | Family for display + body; Italian Plate No2 Expanded Extrabold for tagline | Brandbook page 17 |

**Forbidden visuals (anti-prompts to inject in every render):**

- No people, no faces, no hair, no full bodies
- No flames, no fire, no smoke, no orange glow, no red light (Seedance fire-mode trigger)
- No water, no liquid, no mist, no fog, no visible haze (Seedance water-mode trigger) — **EXCEPTION: the ingredient-splash ASMR lane (§3.6).** This forbidden-water rule exists to stop Seedance from hallucinating uncontrolled water-swirl around a *dry* deflection-demo product. It does NOT apply when water is the *art-directed hero subject*, seeded from real GE Beauty splash photography (the Melon Mood shoot). In that lane, water + bubbles are intentional and controlled by the seed image. Default everywhere else stays no-water.
- No visible dome, no transparent bubble, no glass sphere, no shield, no halo, no aura, no visible barrier of any kind (Seedance dome-mode trigger)
- No logos other than what's already on the product
- No text overlay (captions added in post)

### 2.2 Audio architecture

Every video ships with **four locked layers**, mixed so the video works at any volume:

1. **ASMR sensorial** — per-shot diegetic sound (foam crackle, cream pour, spray hiss, dropper click, droplet impact, blow-dryer hum, rain on glass, etc.). Carries the sensorial truth of each beat.
2. **Ambient pad** — low-volume warm synth or piano bed at -18 dB. Continuous under the body of the video.
3. **Hook sting** — one short chord or note at the 0-2s mark to anchor the hook.
4. **Sound-off readable captions** — exactly 2 captions per video: hook caption + offer card. Marcela voice. Coral lowercase on cream.

The brain MUST emit audio direction per shot. Audio is not decoration — it carries the day-arc narrative (blow-dryer = morning, busy street = midday, rain = afternoon, indoor calm = evening).

### 2.3 Voice & captions

**Tagline (locked, every video):** `no seu tempo, do seu jeito.`
- Lowercase always.
- Font: Italian Plate No2 Expanded Extrabold.
- Position: closing offer card only. One appearance per video.
- Color: coral `#df3630` on cream `#f8f7f3`.

**Captions:** lowercase always. No exclamations. No hashtags. No em-dashes. Two per video maximum:
- **Hook caption** (0:00.5-2.5s): one-word or short-phrase, e.g. `pluma.` `5 minutos.` `24h intactos.`
- **Offer caption** (after the visual body, before tagline): benefit-led, e.g. `5 em 1, sem pesar.`

**Marcela voice rules (for captions and ad copy):**
- Simple, direct, calm assertions
- Smart-friend tone, never teacher, never influencer
- Mature confidence — the product doesn't beg
- Brazilian Portuguese
- Never em-dashes (saved in memory as a hard rule)
- No exclamation marks
- The customer review verbatim from the PDP is the ground truth for tone: *"deixou o cabelo bem hidratado não fico pesado leve solto cheiroso"*

### 2.4 Brand anti-references

**Things GE Beauty does NOT look or sound like** (brandbook page 7, *Dos & Dont's*):

- **Não é popular** — no mass-market clichés
- **Não é fun** — no playful-for-the-sake-of-fun, no kitsch, no kawaii
- **Não é professoral** — no teaching, no "here's how it works"
- **Não é piadista / jocosa** — no jokes
- **Não é arrogante** — no exclusionary aspiration
- **Não é flat** — but also not loud

If a shot or caption draft reads as any of these, regenerate.

---

## 3. Shot archetypes — the proven hook formulas

The brain picks from these archetypes per shot. Each archetype has a known signature, a known sound profile, and known prompt patterns that Seedance handles reliably.

### 3.1 The drop hook

A single droplet, cream rope, foam puff, or mist suspended at the cusp of motion. The fall or bloom completes calmly within 1-1.5s. The eye is hooked by *arrested motion*, not explosion.

- **Sound:** sting + ASMR impact
- **Use for:** essenciais (shampoo, máscara, leave-in), boosters in their "drop into your ritual" idiom
- **Prototype:** shot 01 of leave-in pluma (feather→gel dissolve into tube)

### 3.2 The metaphor hook

A non-product object morphs or transitions into the product's texture, framing, or essence. Example: feather dissolves into pluma's gel droplet. Used sparingly for lançamentos with a strong concept-name link.

- **Sound:** soft single piano note + subtle texture sound
- **Use for:** lançamentos with concept-name product (pluma = feather, mayday = rescue)
- **Risk:** verges on "fun" if not done with restraint. Keep it still and Aesop-grade.

### 3.3 The proof hook

A side-by-side or sequential demonstration of a claim. UV-faded silk vs treated silk. Stretched thread that doesn't snap. Water beading off treated surface. The protection is shown via the proxy's behavior.

- **Sound:** silent or soft pad; emphasis on visual change
- **Use for:** boosters (antioxidante, fortificante, hidratante), claims-heavy shots
- **Prototype:** shots 02-06 of leave-in pluma (hidrata, nutre, repara, protege, brilha)

### 3.4 The deflection demonstration

The product stands centered. An environmental aggressor (heat, water, sun, etc.) enters frame, approaches the product, and is visibly redirected around it without touching. The deflection is the proof.

- **Critical:** describe the deflection BEHAVIOR, not the field. Never use "bubble", "field", "shield", "barrier", "dome", "halo", "aura" — these all trigger visible-substance hallucination.
- **Sound:** the aggressor's diegetic sound, fading as it deflects
- **Use for:** primers (heat, humidity, sun), protection-claim products

### 3.5 The day-arc structure (the narrative pattern)

The product stays centered on cream BG. Each beat marks a different time of Marcela's day. Lighting and audio carry the temporal signal. The product is the protected hero through all of them.

**The four-beat skeleton** (default; can be 3 or 5 with adjustments):

| Beat | Time | Visual cue | Audio cue | Lighting |
|---|---|---|---|---|
| 1 | Morning | Hair-styling tool aggressor (blow dryer / flat iron) deflected around the product | Blow-dryer hum, bathroom ambience | Cool morning, soft from upper-left |
| 2 | Midday | Sun overhead, time-passage signal (shadow sweep, optional sun-flare) | Busy street, urban background | Harsh white shifting to warm |
| 3 | Afternoon | Environmental aggressor #2 (rain, humidity, wind) deflected | Rain on glass, ambient wet | Overcast cool, slight blue tint |
| 4 | Evening | Arrival home, the day's promise sustained | Indoor warm calm, soft household ambience | Golden warm, low angle |

Use this when the product's benefits map naturally onto a day cycle (primers, leave-ins, daily-routine products). For single-moment products (mayday, shampoo, a single booster), use a single-archetype hook from §3.1-3.4 instead.

**Optional exercise variant of the arc.** For products whose benefits map to outdoor / sport contexts (the dupla protetor solar, booster antioxidante, melon mood splash), swap one of the four beats — typically beat 2 (midday) — for an exercise beat:

- Visual cue: outdoor light, the product against a setting suggested by a park bench, asphalt texture, or beach-sand surface (the product stays the hero; the environment is suggested by minimal context props)
- Audio cue: footfalls + breath + park / street / beach ambience
- Lighting: bright outdoor sun, warmer than midday-city
- Deflection: UV rays visible as warm light beams flowing past the product (never touching), or ambient sweat-humidity beading off an invisible curve around the bottle (behavior-only, never named)

### 3.6 The ingredient-splash ASMR lane (sanctioned 2026-06-12)

A sensory lane for translating an **invisible scent** into its ingredient sources, rendered as underwater / waterline ASMR, then revealing the product as the hero "wearing" that scent. Sanctioned by Lucas 2026-06-12 for the GE Beauty signature scent (melon, peônia/peony flowers, white musk), shared across the line. Seeded from the real Melon Mood Body & Hair Splash photography (`ge-50057.jpg` = pure ingredient world; `ge-49023.jpg` = product-in-splash).

- **Water is the hero, art-directed, seeded.** This lane is the explicit exception to the §2.1 no-water rule. Always pass a real splash seed image as a reference so the model anchors to controlled water + bubbles rather than hallucinating a swirl.
- **Scent → sensation, never a claim.** Scent can't be seen or heard, so it is carried by its ingredient sources rendered as multisensory ASMR (melon = juicy-cool plunge + fizz; peônia = soft floral hush, petals unfurling; white musk = clean warmth + the product itself). Copy never makes an on-screen scent *claim* — it stays benefit-led per §2.3 and the "benefit-only, no technical ingredient names" tenant rule. Fragrance NOTES (melon, peony, musk) are allowed as sensory language; technical ingredients are not.
- **3-note scent arc** (default): melon → peônia → white musk + product reveal. Each note is one ~6s beat with its own dominant sensation + ASMR diegetic audio (water glug, bubble fizz, petal rustle, the airy hush of musk, the bottle settling).
- **Faceless + hair-out still hold.** No people, no faces, no hair. Hands only if manipulating an ingredient (and usually unnecessary underwater).
- **Motion = Pattern B dual-keyframe** for plunges/descents (melon falling in, bottle settling) so physics read naturally; ambient bubble-drift for hold beats.
- **Per-product differentiation by grade + motion energy:** primer cachos definidos = warm yellow-sun grade, livelier/bouncier splash (mirrors curl movement); primer liso intacto = cool teal grade, sleek vertical glide (mirrors alignment/smoothness).

---

## 4. Hair-proxy library

When a concept needs to demonstrate a hair claim WITHOUT showing hair:

| Hair concept | Proxy |
|---|---|
| Cascade / hair-fall | Natural silk thread or satin ribbon in slow motion |
| Strand under tension | Single silk thread between two fingertips |
| Frizz vs smooth | Frayed fabric weave vs polished silk surface |
| Curl pattern | Coiled silk ribbon; spiral of piped gel on marble |
| Hair gloss | Light reflection on a polished surface (porcelain, brushed metal) |
| Brush glide | Wide-tooth comb passing through silk fibers |
| Heat protection demonstration | Cream-coated metal rod under hot iron; droplets bead off |
| Humidity resistance | Water beads on treated silk swatch vs absorbed on untreated |
| Volume / lift | Satin ribbon rising into a soft arch on an air puff |

The brain should pick the proxy per benefit and stay consistent within a single video.

---

## 5. Color palette (brandbook page 14, all 9 colors)

| Token | Hex | RGB | Use |
|---|---|---|---|
| `bg-cream` | `#f8f7f3` | 248, 247, 243 | Default background. Always warm, never pure white. |
| `coral` (primary brand) | `#df3630` | 225, 54, 48 | The 'ge' ligature, primary callouts, tagline color |
| `red-mayday` | matches coral or slightly deeper | — | Used only for máscara mayday (the jar IS red) |
| `yellow-sun` | `#ffd48d` | 255, 212, 141 | Warm secondary — primer cachos definidos accent |
| `mint-booster` | `#aed2c2` | 174, 210, 194 | Booster line accent (all 5 boosters) |
| `coral-pink` | `#f37e72` | 243, 126, 114 | Lighter coral — leave-in pluma accent (feather-light) |
| `pink-lilac` | `#d1a6cc` | 209, 166, 204 | Light, quick — shampoo a seco accent |
| `teal` | `#80cecc` | 128, 206, 204 | Cool, structured — primer liso intacto accent |
| `orange` | `#f58939` | 245, 137, 57 | Warm summer — melon mood splash accent |
| `pink-light` | `#e49dc4` | 228, 157, 196 | Available accent, unassigned |

**Forbidden:** any color outside this palette (brandbook page 13: *Não usar cores fora da paleta cromática*).

### Per-product accent mapping

| Product | Accent |
|---|---|
| shampoo sem sulfato | cream-only (essencial, neutral) |
| máscara condicionadora | cream-only |
| leave-in com proteção térmica | cream-only |
| leave-in pluma | `coral-pink` |
| máscara mayday | `red-mayday` (the jar's actual color) |
| primer liso intacto | `teal` |
| primer cachos definidos | `yellow-sun` |
| melon mood splash | `orange` |
| shampoo a seco | `pink-lilac` |
| booster antifrizz | `mint-booster` |
| booster antioxidante | `mint-booster` |
| booster definição | `mint-booster` |
| booster fortificante | `mint-booster` |
| booster hidratante | `mint-booster` |

---

## 6. Seed image selection — from Shopify directly

The brain fetches product imagery from the Shopify PDP at render time, never from a local stash. This ensures the seed image is always the current canonical product photo.

### Fetch contract

```
   Per product:
     query: product(id: gid://shopify/Product/<id>) {
       featuredMedia { preview { image { url, width, height } } }
       media(first: 10, query: "media_type:IMAGE") {
         edges { node {
           preview { image { url, width, height, altText } }
           position
         }}
       }
     }
```

### Selection rules (the brain picks per shot, not per product)

| Shot intent | Best seed image |
|---|---|
| Hero product macro (drop hook, deflection demo) | **`featuredMedia`** — the canonical product photo on cream BG |
| Product in a day-arc context shot | Same as above; the brain describes the context in the prompt rather than seeding a contextual image |
| Per-benefit demonstration shot (one benefit, one shot) | **`custom.imagem_beneficio_em_destaque_N`** — the merchandiser-curated image for that specific benefit (see [metafield map](video-director-metafield-map.md)) |
| Texture vignette (proof hooks, hair-proxy shots) | **No seed** — pure text-to-video, since these don't show the product |
| Multi-product lineup | Find an image with multiple products visible; if none, **no seed** + text-to-video with product names in prompt |
| Detail / swatch shot | A non-featured image with the relevant detail; otherwise `featuredMedia` |

**Fallback:** if the featured image has poor composition (lifestyle context, model present, multi-product), iterate through `media[]` array in `position` order and pick the first single-product cream-BG image.

### Image fetch + cache

- Fetch to `inputs/video-prototypes/<concept>/seeds/<product-handle>.jpg`
- Cache by `(product_id, image_id, version)` so we don't re-download for variant renders
- The downloaded image is what fal.ai receives; we don't pass the Shopify CDN URL directly (avoids signed-URL expiry and CDN rate limits on the fal.ai side)

### Open question (defer to first build)

Should the brain ever PRE-PROCESS the seed image (crop to 9:16, color-correct, remove a tagline overlay)? **For v1: no.** Use the Shopify image as-is. If composition fails the auto-review consistently, revisit.

---

## 7. Caption schedule template

Light density (per locked rule):

```
   Time    | Caption                       | Style
   --------|-------------------------------|-----------------------------
   0:00.5  | <hook caption, 1-3 words>     | coral lowercase, lower-third
   0:02.5  | (fade out hook caption)        |
   ...
   12.0    | <offer caption, benefit-led>  | larger coral lowercase, centered
   14.0    | no seu tempo, do seu jeito.   | tagline, Italian Plate No2 Expanded Extrabold, centered
   15.0    | (end)                         |
```

The brain emits both caption strings per shot list.

---

## 8. Prompt anti-patterns — Seedance hallucination triggers

What we have learned the hard way (3 failed renders, session 2026-05-17):

| Prompt phrase | Renders as | Why it fails |
|---|---|---|
| "warm heat haze, orange-tinted" | Visible flame glow / fire | Color hint pushes to fire interpretation |
| "transparent refractive distortion" | Water swirl around the product | Model latches onto "refractive" → liquid |
| "invisible bubble surrounds the bottle" | Literal glass dome | "Bubble" is a noun the model renders |
| "invisible field / boundary / shield" | Some kind of visible shape | Boundary nouns trigger visible boundary rendering |

**Successful patterns:**

- **Behavioral-only language** — describe what happens (heat curves around, water beads off) without naming the protection
- **Visible source device** — a blow-dryer nozzle in frame anchors the meaning of "heat" without needing to render heat. A rain cloud or shower-head silhouette anchors "rain." Sun angle + warm light anchors "sun."
- **Capitalized anti-prompts** for known failure modes — NO flames, NO dome, NO bubble, etc.

The brain MUST inject the full anti-prompt list from §2.1 into every prompt it emits.

---

## 9. The brain's reasoning template

Four steps, each with structured I/O. Each step's output is inspectable in `state.json`.

### Step 1: Ingest

```
   INPUT: product_gid (e.g. gid://shopify/Product/9668674879808)
   ACTION: read metafields per the metafield map (docs/video-director-metafield-map.md):
           - custom.finalidade (positioning sentence)
           - custom.beneficio_em_destaque_1/2/3 (the 3 curated benefits)
           - custom.imagem_beneficio_em_destaque_1/2/3 (paired benefit images)
           - custom.caracteristicas (expanded rich-text list)
           - custom.dosagem, tipo_de_cabelo, necessidade, finalizacao
           + read title, description, price, featuredMedia, media list
   OUTPUT: state.benefits[] = [<the 3 beneficio_em_destaque values>]
           state.benefit_images[] = [<the 3 imagem_beneficio_em_destaque URLs>]
           state.finalidade = "<positioning sentence>"
           state.caracteristicas[] = [<expanded characteristic bullets>]
           state.product_meta { title, handle, price, accent_color, hero_image_url, dosagem, ... }
   VALIDATION: refuse if finalidade or any beneficio_em_destaque_1/2/3 is empty
```

### Step 2: Benefit → moment mapper

```
   INPUT: state.benefits[], persona constitution (this doc §1)
   REASONING: for each benefit, find ONE moment in Marcela's day where it
              becomes tangible. Include sensory anchor + diegetic audio.
   OUTPUT: state.moments[] = [
     {
       benefit: "proteção térmica até 230°C",
       moment: "morning bathroom styling",
       sensory_anchor: "blow dryer at full blast",
       audio: "blow-dryer hum + bathroom tile ambience",
       archetype: "deflection demonstration" (§3.4)
     },
     ...
   ]
```

### Step 3: Narrative sequencer

```
   INPUT: state.moments[], persona §1, shot archetypes §3, day-arc §3.5
   REASONING: sequence moments into ordered shot list (3-5 shots).
              If moments map cleanly onto day-arc, use that.
              Otherwise pick single-archetype hook + body + offer.
              Each shot gets time-of-day, lighting, audio, witness-prop choice.
   OUTPUT: state.narrative_arc[] = [
     {
       shot_id: "01-morning",
       time: "morning",
       intent: "demonstrate heat protection",
       archetype: "witness-prop hook",
       lighting: "cool morning, upper-left soft key",
       audio_primary: "blow-dryer hum",
       audio_ambient: "bathroom tile ambience"
     },
     ...
   ]
```

### Step 4: Shot synthesizer

```
   INPUT: state.narrative_arc[], brand grammar §2, hair-proxy §4,
          accent color §5, seed image rules §6, anti-patterns §8
   REASONING: for each shot, write a Seedance prompt grounded in the rules.
              Pick model (Kling for motion, Seedance for texture, etc.).
              Pick seed image (featured / no seed) per §6 rules.
              Inject full anti-prompt list from §2.1.
   OUTPUT: state.shots[] = [
     {
       shot_id: "01-morning",
       model: "kling-2.5",
       seed_image: "seeds/primer-cachos-definidos.jpg",
       prompt: "<full Seedance prompt with anti-prompts>",
       duration_s: 5,
       aspect: "9:16",
       resolution: "1080p",
       caption_hook: "protegido.",
       audio_layers: { ASMR: "...", ambient: "...", sting: "..." }
     },
     ...
   ]
```

### Step 5: Ad copy generator

```
   INPUT: state.narrative_arc[], state.benefits[], persona §1, voice §2.3
   REASONING: produce Meta-ready copy in Marcela voice
   OUTPUT: state.copy = {
     primary_text: "<≤125 chars>",
     headline: "<≤27 chars>",
     link_description: "<≤30 chars>",
     cta_button: "Saiba mais" | "Comprar agora",
     caption_offer: "<benefit-led>"
   }
```

After Step 5, render budget is computed and the brain pauses for the mandatory budget gate. Approval → dispatch to fal.ai pipeline.

---

## 10. Variant mode (1 base + 2 by default)

When variant mode runs, the brain re-runs Step 3 (narrative sequencer) twice more with constraint twists:

- **Variant A — hook variant:** same moments, sequencer is told to OPEN with a different one. Cheapest variant — only the first shot differs.
- **Variant B — copy variant:** same shots, but Step 5 (ad copy) is re-run with a different angle (benefit-led vs ritual-led vs claim-led). No new renders.

Variant cost ≈ 1.4× base cost for the triple package. Other variant types (audio variant, arc variant) available but off by default.

---

## 11. Reference docs

- Brandbook PDF: `c:/Users/Lucas Guimarães/Desktop/nami-works/sandbox/gebeauty/brandbook/_manualGEbeauty_final.pdf`
- v2 concepts: [video-director-concepts.md](video-director-concepts.md) — 14 per-product hero concepts
- Pluma prototype: [prototype-leave-in-pluma.md](prototype-leave-in-pluma.md)
- Primers prototype: [prototype-primers-resistance.md](prototype-primers-resistance.md)
- Memory: `feedback_external_tool_handoff_framework.md`, `feedback_no_em_dash.md`, `project_brand_model.md`

---

## 12. Living-document rules

- When a new shot archetype is discovered (like the witness-prop hook), add it to §3.
- When a new anti-pattern is found, add it to §8.
- When a product line color assignment changes, update §5.
- When the brain misjudges a moment or arc, write the corrective rule into §1 (persona refinement) or §3.6 (day-arc refinement).
- This is the brain's memory across sessions.
