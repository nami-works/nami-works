# Body & Hair Mist — Magnific zoom-out (uncrop) recipe

Validated 2026-07-03 on Rose Ritual 4:5 (winner: `expanded/rose-4x5-zoomout-v2-C.png`).
Goal: take a square ambiented shot and reveal MORE open, empty water around it to fit each ad ratio, so there is clean negative space for the headline + `ge` logo overlay.

## Engine + settings (this is what worked)
- Model (`mode`): **`imagen-nano-banana-2`** (Nano Banana Pro) — high-fidelity reference-guided edit. `auto`/plain text-to-image does NOT work: it reinvents the scene and adds a second waterline.
- `references`: the scent's own square as `type: image` (upload the Shopify CDN URL via `creations_upload_image`; the URLs are public).
- `resolution`: `2k`. `count`: 2-3, then pick.
- `aspectRatio` per format:
  - 4:5 portrait → `4:5`
  - 9:16 vertical → `9:16`
  - 1.91:1 landscape → `16:9` (Nano Banana has no 2:1/1.91), then crop/pad to 1200×628
  - 1:1 square → no zoom-out needed, use the source as-is

## The reusable prompt
Only the first sentence's frame orientation changes per format. Body is identical.

**Frame line (pick one):**
- 4:5 → "into a taller 4:5 vertical frame, revealing more open empty space around the scene"
- 9:16 → "into a much taller 9:16 vertical frame, revealing generous open empty space above and below the scene"
- 16:9 (landscape) → "into a wider 16:9 horizontal frame by extending mainly to the LEFT; keep the bottle and all props together in the RIGHT ~45-55% and leave the entire LEFT side empty open water for copy"

**Full prompt:**
> Zoom out and uncrop this exact photo <FRAME LINE>, as if the camera pulled back. Keep the bottle, its label and printed text, the main [flower], and the existing floating [scent props] exactly as they are, in the same positions and scale. The newly revealed area must be mostly EMPTY negative space: clear, calm, bright high-key near-white water with lots of open room. Do NOT add any new flowers, petals, fruit, leaves, or large elements. For ambience continuity and realism you may keep and gently continue only small, subtle details such as tiny air bubbles rising in the water. Remove any petal, fruit, leaf or object that is awkwardly cut off at the edges of the original frame, so the borders look clean and intentional rather than cropped. This is ONE single continuous body of clear water; the only water surface is the existing waterline near the top. Do NOT add any second water surface, waterline, horizon, reflection or floor. Keep the same soft high-key lighting and photographic style.

Swap `[flower]` / `[scent props]` per scent: Rose (pink rose; petals, lychees, red currants, leaf) · Pear (white water lily; pear halves and slices) · Santal (sandalwood; sandalwood sticks, cardamom pods, leaf) · Melon (cream peony; honeydew melon slices).

## Known tradeoff (accepted)
Because this is a generative zoom-out, the **tiny label print drifts** (e.g. "6.76" may render as "6.78", the micro-line above the logo garbles). Bottle shape, color and `ge` logo stay right. Accepted for ad use at feed size. If a pixel-true label is ever required, do a hybrid: composite the real bottle region from the seed back over the zoom-out.

## Batch matrix
Scents: Rose, Pear, Santal, Melon. Formats per scent: 4:5, 9:16, 16:9(→1.91:1). 1:1 = source as-is. Seed each scent from its own `source/<scent>-underwater.*` (Santal also has `-stilllife`).
