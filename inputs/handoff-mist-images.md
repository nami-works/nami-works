# Handoff — Generate product images for the 3 new Body & Hair Mists

**Created:** 2026-06-22 · **For:** a fresh session running `/video-director` (image mode) + Magnific
**Status of the 3 products:** DRAFT skeletons on Shopify (created + renamed Splash→Mist this session)

## Task
Generate **images only** (no video) for the 3 new Body & Hair **Mists**, to enrich their Draft Shopify products up to Melon Mood parity. Use `/video-director` in image mode via the **Magnific** MCP (`images_*` tools, never `video_*`).

## The 3 products (currently DRAFT)
| Scent | SKU | Notes / color story | Draft product ID |
|---|---|---|---|
| Rose Ritual | GEB 025 | rosas, musk, sândalo → rose / pink | 10163564183872 |
| Pear Fresh | GEB 026 | pêra, frésia, lírio → pear / green-white | 10163564216640 |
| Santal Skin | GEB 027 | sândalo, cardamomo, patchouli → sandalwood / amber / warm | 10163564249408 |

Format: 200ml bottle, 50×50×175mm. Label/copy naming is **"Body & Hair Mist"** (the line was just renamed from "Splash"; do not render "Splash" anywhere).

## Visual anchor (anti-hallucination — the critical one)
These are **line extensions of Melon Mood**, so they must look like the same product line and the same bottle — only the scent / color story changes. The live **Melon Mood** product is the bottle + photographic-style reference:
- Melon Mood product ID: `9946377617728` (7 media images). Pull its real images and feed them to Magnific as references so the new scents match bottle shape, lighting, background, and composition (cohesive PDP + collection grid).
- Full Melon structure (media count, metafields, tags, category) already saved at `sandbox/gebeauty/scripts/_melon_template.json`.

**Resolve first:** confirm whether **real packshots / label art exist** for the 3 new scents. The primary PDP packshot must show the *actual* bottle and label. If AI-generating, base it on the Melon bottle with per-scent color treatment, and flag that the real label (text + colors) must be verified before publish. Do not ship an invented label as the canonical product image.

## Image set per scent (mirror Melon's 7 media)
- 1 hero packshot (clean background, e-commerce primary)
- 2 lifestyle (faceless, hair-out, scent-mood)
- 3 benefit shots (style of Melon's `beneficio_em_destaque_*` images)

## Tools & access
- Shopify creds: `sandbox/gebeauty/.env` (resolve `__file__`-relative). Store `ge-beauty-cosmeticos.myshopify.com`, API `2026-01`.
- Scopes include `write_products` + `write_files` → can upload media directly to the Draft products.
- Magnific connection is live (primary backend since 2026-06-08).
- Price-source HARD RULE (if reading any prices): only `productType` in (`product`, `acessorio`); never `rappi`/`brinde`/kit.

## Brand grammar
- Constitution: `docs/ip.md`. Faceless + hair-out for any human/lifestyle shot. Benefit-only language. No em dashes in alt text / copy. Tagline lock: "no seu tempo, do seu jeito."

## Output + where this fits
- Save renders to scratchpad or `inputs/`, then attach as media to the 3 Draft product IDs above. Set PT alt text (no em dashes).
- **Keep the products DRAFT.** Publishing is gated on Lucas.
- Images are one piece of the enrichment pack (images + INCI + stock + copy) needed to flip Draft→Live. That in turn unblocks the launch and the pre-purchase checkout cross-sell engine spec'd in `inputs/growth-gebeauty-mist-checkout-aov-2026-06-22.md`.

## Reference files in repo
- `sandbox/gebeauty/scripts/_melon_template.json` — full live Melon Mood product structure (the parity target)
- `sandbox/gebeauty/products.json` — fiscal catalog (scent notes, dims, EAN, NCM for GEB 025/026/027)
- `inputs/growth-gebeauty-mist-checkout-aov-2026-06-22.md` — the launch monetization plan these images feed
