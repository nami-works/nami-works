# Ingredient-card imagery — art-direction brief

**Purpose:** generate the `imagem` for the 22 ingredient cards (metaobject
`ingredientes_com_descri_o`) feeding the redesign PDP `custom.ingredientes_com_foto`
carousel. Engine: Magnific + Nano Banana Pro. Text/matrix already validated in
`catalog-ingredient-cards-matrix.json`.

## Reference read (existing 2 stub cards)
- `manteiga-de-murumuru`: cream butter in a clear glass bowl + raw nuts, soft daylight, white bg.
- `camomila`: chamomile flowers in a field, bokeh, warm natural tones.
- Both are lorem-ipsum stubs and stylistically inconsistent; the V3 mockup leans more
  premium/editorial (high-key, texture-forward). **Decision needed: match the mockup's
  premium texture look, or the natural raw-ingredient stock look.** (Recommended: mockup.)

## Style spec — LOCKED to V3 mockup (extreme texture macro)
Confirmed by Lucas 2026-07-02 against the mockup's murumuru card (a full-frame close-up of
smooth white butter texture, high-key, near-monochrome).
- **Format:** 1:1 square, generate ≥1024×1024 (cards render ~square; current stubs are 300×300).
- **Look:** EXTREME macro close-up of the ingredient's own texture/surface, **filling the entire
  frame edge to edge** — no bowl, no props, no context, no background objects.
- **Light/tone:** high-key, soft diffused lighting, luminous and airy; near-monochrome light
  palette (let each ingredient's natural hue read subtly, but keep it bright and desaturated,
  not saturated stock photography).
- **Feel:** smooth, tactile, premium clean-beauty editorial; shallow depth of field; sharp
  micro-texture detail.
- **Consistency:** same high-key macro treatment across all 22 so the carousel reads as one
  system (the current stubs fail this — one studio bowl, one field shot).
- **No text, no logos, no hands, no packaging, no bowls/containers, no scene** — texture only.

## Per-ingredient TEXTURE (what fills the frame — macro, edge to edge)
| Card | Texture subject |
|---|---|
| manteiga de murumuru | whipped white murumuru butter, smooth peaks, folds and soft cracks |
| manteiga de cupuaçu | pale ivory cupuaçu butter, creamy smooth surface |
| óleo de abacate | glossy green-gold avocado oil surface, light refraction |
| óleo de girassol | luminous golden sunflower oil surface, fine bubbles |
| óleo de macadâmia | pale golden macadamia oil surface, soft sheen |
| óleo de gergelim | amber sesame oil surface with scattered sesame seeds |
| óleo de oliva | green-gold olive oil surface, glossy |
| óleo de coco | white semi-solid coconut oil, creamy melting texture |
| óleo de mamona | thick clear castor oil surface, viscous glossy strands |
| crambe | pale golden crambe oil, smooth glossy surface |
| chia | dense bed of black-and-grey chia seeds, macro |
| linhaça | dense bed of golden-brown flaxseeds, macro |
| algas vermelhas | red marine algae surface texture, wet sheen |
| alcaçuz | fibrous pale licorice root surface, macro |
| chá verde | fresh crushed green tea leaves, dewy macro |
| sálvia | soft velvety sage leaf surface, macro veins |
| mentol | fresh mint leaf surface, dewy, cool green |
| extrato de angico | fine angico bark powder / smooth bark surface |
| pantenol | clear viscous serum, glossy droplets and strands (high-key) |
| biotina | fine pale powder with soft peaks, luminous white |
| arginina | white crystalline powder, fine micro-crystals |
| trehalose | fine white sugar crystals, sparkling micro-texture |

> The 4 non-botanicals (pantenol, biotina, arginina, trehalose) are rendered as clean
> serum/powder/crystal textures to stay on-style. Confirm with Lucas if a botanical source is
> preferred instead.

## Nano Banana Pro prompt template (per card)
> Extreme macro close-up photograph of {TEXTURE}, filling the entire frame edge to edge, high-key
> soft diffused lighting, luminous and airy, near-monochrome light palette, smooth tactile
> micro-texture detail, shallow depth of field, premium clean-beauty editorial style, 1:1 square.
> No props, no bowl, no container, no background scene, no text, no hands.

Example (murumuru): *"Extreme macro close-up photograph of whipped white murumuru butter with
smooth peaks, folds and soft cracks, filling the entire frame edge to edge, high-key soft
diffused lighting, luminous and airy, near-monochrome white palette, smooth tactile micro-texture
detail, shallow depth of field, premium clean-beauty editorial style, 1:1 square. No props, no
bowl, no container, no background scene, no text, no hands."*

## Blockers (as of 2026-07-02)
1. **Magnific MCP is disconnected** this session — generation can't run until it's reconnected.
2. **`/art-director` is not a loaded skill** here. Options: reconnect + use `/video-director`
   (Magnific/Nano Banana Pro capable) for stills, or confirm the correct skill name.
3. **Card `imagem` is REQUIRED** — cards can't be created until images exist (or the definition is
   changed to make imagem optional). So the metaobject build is gated on this imagery.
