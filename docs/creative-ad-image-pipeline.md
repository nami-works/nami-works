# Creative Ad-Image Pipeline — Canva + Magnific

How we produce paid-ad and web-banner imagery for GE Beauty (and any future CPG Labs brand): generate/extend base imagery in **Magnific**, lay it out and overlay copy + logo in **Canva**, both driven through their hosted MCP connectors from Claude.

This is the canonical playbook. It captures the working recipe **and** every non-obvious thing we had to discover — the tool quirks, the auth walls, the physics failures, and the fixes. Read it before doing Canva/Magnific creative work so you don't re-derive the same lessons.

Related docs: [gebeauty-theme-customization.md](gebeauty-theme-customization.md) (storefront), [shopify-performance-leverage-matrix.md](shopify-performance-leverage-matrix.md). Ad-format clear zones: `sandbox/gebeauty/imagery/primers/primers-ad-format-spec.md`. Mist recipe: `sandbox/gebeauty/imagery/body-hair-mist/mist-magnific-prompts.md`.

---

## 0. The two tools and what each is for

| Tool | MCP | Role | Auth |
|---|---|---|---|
| **Magnific** | `mcp.magnific.com/mcp` (hosted, first-party) | Generate imagery, generative **zoom-out / uncrop**, upscale, remove-bg, relight | OAuth per user; **team uses ONE shared GE Beauty Magnific account** (one credit pool, central cost cap) |
| **Canva** | `mcp.canva.com/mcp` (hosted, first-party) | Layout: place images, overlay/format text, swap logo, resize/position, export | OAuth **per user**, each logged into the GE Beauty Canva **team** so shared templates are visible |

Neither is custom code we own — they are Canva's and Magnific's own hosted servers. What **we** built is the *method*, the *templates*, and the *filesystem conventions* below.

The recipes/brand rules are **not** deliverable as MCP tools — claude.ai does not turn a server's prompts/resources into standing behavior. They live as **claude.ai Project instructions** (block `GBCR` in `inputs/claude-ai-project-instructions.md`) plus the two knowledge files above.

---

## HARD RULE — how to extend any image (read before §1)

When asked to extend / uncrop / widen / add negative space: **only add background around the subject. The main elements (product packaging, real labels, logos, model) stay COMPLETELY UNTOUCHED** — identical pixels, scale, position. The rule is about the subject, not the tool.

**Use tools that fill ONLY the new area, so the original is preserved exactly:**
- **Magnific `images_expand`** (outpaint) — the right Magnific tool for extending a background; keeps original pixels, generates only the added border. Spending credits here is fine and expected.
- **Deterministic PIL** (edge-replicate + smoothed profile) — for uniform / smooth-gradient backgrounds; free; use when it gives a clean result. (This is how the primer LP hero banners were widened 2.5:1 → 3:1 — model+product+copy kept, only the grey/dark background extended sideways.)

**BANNED: never "extend" with a full re-generation** (`images_generate` re-rendering the whole scene, even with the source as reference). It re-renders the subject and silently softens/garbles real labels or repackages the product — off-brand and wasteful (a Cachos banner regenerated this way lost its sharp bottle label). Extend the background; do not regenerate the product. Full rule: Claude memory `feedback_image_extension_rule`.

The generative zoom-out below (§1) is a *different, narrower* job — turning a square studio product shot into ad plates where a little ambient continuation is acceptable — and even there the bottle/label must stay put.

## 1. The generative zoom-out (uncrop) — the core technique

**Goal:** take a square, fully-composed product photo and reveal *more empty space* around it so there's a clean negative-space zone for a headline + `ge` logo, at each ad ratio.

### Engine (this is what works)
- **Nano Banana Pro** — Magnific `images_generate` with `mode: "imagen-nano-banana-2"`.
- Seed with the product's **own square photo** as an image reference (`references: [{type:"image", identifier:<creation id>}]`), or seed by prompt-with-reference.
- **Plain text-to-image / `auto` does NOT work.** It reinvents the scene and hallucinates a physically-impossible **second waterline**. Reference-guided uncrop is mandatory.

### Aspect ratios
`aspectRatio` enum includes `1:1, 4:5, 9:16, 3:2, 2:3, 16:9, 21:9, 2:1, 5:4, 4:3, 3:4, 1:2`.
- 4:5, 9:16, 1:1 map directly.
- **1.91:1 (Meta landscape 1200×628) has no native token.** Generate at `16:9` and crop/pad to 1200×628 (or `2:1` = 1200×600, ~28px shy — a tiny extend, not a crop). Pick per the spec doc.

### The prompt shape
Only the first "frame line" changes per format; the body is constant.

- **4:5** → "into a taller 4:5 vertical frame, revealing more open empty space around the scene"
- **9:16** → "into a much taller 9:16 vertical frame, revealing generous open empty space above and below the scene"
- **16:9 / landscape** → "into a wider frame by extending mainly to the LEFT; keep the product and props in the RIGHT ~45-55% and leave the LEFT side empty" (flip to product-LEFT / copy-RIGHT if the template wants it — match the template, not the habit)

Body (constant): keep the bottle, its label + printed text, the main flower, and existing floating props **exactly as-is, same position and scale**. The new area must be **mostly EMPTY** high-key near-white water. Add **NO** new flowers/petals/fruit/leaves/large elements. You may gently continue only tiny subtle details (small air bubbles). **Remove anything awkwardly cut off at the original edges** so borders look intentional. **ONE continuous body of water — the only waterline is the existing one near the top; no second surface / horizon / reflection / floor.** Keep the same soft high-key lighting and photographic style.

### Physics rules we learned the hard way
- **Two water surfaces is impossible.** Always state "one continuous body of water, no second waterline." (First failure mode.)
- **Bubbles above the waterline are wrong.** If the *source* has bubbles above the surface, prompt to convert them to splash droplets — but **only fix sources that are actually wrong.** Rose needed it; Santal/Pear/Melon were already physically accurate. Do **not** apply the seed-fix blindly.
- **Source waterline at the top edge warps** (Santal, Melon). Prompt explicitly for "one single clean, calm, near-straight, undistorted horizontal surface with air above."
- **Accepted tradeoff:** tiny label print drifts slightly on a generative zoom-out (e.g. `6,76`→`6,78`). Fine at feed size. For pixel-true labels, composite the real bottle region back over the zoom-out (hybrid) — we didn't need to.

### Workflow
Generate `count: 2-3` per format, then pick. Use `creations_wait` to get the final asset URL when you need to chain it. Note the returned pikaso URLs are **public but signature-tokened and expire** — download promptly.

---

## 2. Ad format families + clear zones

Full maps in `primers-ad-format-spec.md`. Summary:

- **Family B — product packshot (primary for product shots):** product cluster biased to one side, logo in a top corner, headline in the empty band. Portrait/square → **bottom band** clear + logo top-corner. Vertical (9:16) → **top ~15% and bottom third** clear (also dodges Stories UI). Landscape → **one half** clear for copy + logo far corner.
- **Family A — model/lifestyle:** subject centered/pushed, headline in a **top** banner, logo bottom.
- **Mist campaign specifically** places product LEFT / copy RIGHT on landscape (opposite of the Primer packshot family). Always match the template you're filling, not the generic rule.

---

## 3. Canva editing mechanics (the MCP quirks)

### The transaction lifecycle — mandatory
1. `start-editing-transaction(design_id)` → returns `transaction_id`, a `richtexts[]` + `fills[]` snapshot (this is how you **discover element IDs, text, positions, dimensions**), a `pages[]` array, and a thumbnail.
2. `perform-editing-operations(...)` with the ops.
3. **`commit-editing-transaction` — REQUIRED.** Draft changes are lost if you don't commit. Never tell the user it's saved before the commit returns `committed`. Use `cancel-editing-transaction` to discard.

### `perform-editing-operations` argument shape (we hit this)
Top level requires **`page_index`** (1-based, first page you touch) **and `pages`** (the array from the last transaction/op response: `{page_id, is_responsive}`). Each operation is an object with a `type`. For `format_text`, the styling goes in a nested **`formatting`** object — **not** at the op root:

```jsonc
{ "type": "format_text", "element_id": "<pageId>-<localId>",
  "formatting": { "color": "#AC6471", "font_weight": "bold", "font_size": 96, "text_align": "start" } }
```
First attempt failed because `color` was at the op root and `page_index`/`pages` were missing. `formatting` supports: `color`, `font_size`, `font_weight` (normal|bold), `font_style` (normal|italic), `text_align`, `line_height`, `decoration`, `strikethrough`, `link`, list controls. **Font family is NOT settable.**

### Useful operations
- `update_fill` — swap the image on an existing element: `{type, element_id, asset_type:"image", asset_id, alt_text}`. This is how you place a new plate or a re-tinted logo into an existing slot.
- `position_element` / `resize_element` — reposition/resize (text: width only, height auto).
- `replace_text` / `find_and_replace_text` — copy edits.
- `insert_fill` — add a new image to a page.

### Element ID structure
`<page_id>-<localElementId>` (e.g. `PBqlM49n1dlDp7fh-LB2yJ9JvKKwW3kj6`). Page IDs and element IDs are stable across sessions for a given design, but the reliable source is always the live `start-editing-transaction` snapshot.

### Responsive pages
On pages flagged `is_responsive`, only `update_title, replace_text, update_fill, delete_element, find_and_replace_text` are allowed. Our fixed-size ad pages are non-responsive, so all ops work.

### The share-link trap (cost us a "link doesn't work")
- The `design_id` (`DAHOV54G2g4`) is **NOT** the URL slug.
- The `edit_design_url` returned inside a *transaction* is ephemeral, not the canonical share link.
- Get the real links from **`get-design(design_id)`** → `urls.edit_url` / `urls.view_url`. Share those.

---

## 4. Getting a Magnific image into Canva

**The wall:** Canva's `upload-asset-from-url` needs a URL Canva's servers can fetch. **Magnific/pikaso signed URLs fail** ("invalid url" / broken signature when encoded). Same for other tokened URLs.

**The fix (dev/Lucas path):** host the file transiently on **Shopify Files** (public `cdn.shopify.com`), ingest into Canva, then delete.

```
stagedUploadsCreate  → PUT bytes to staged target
fileCreate(originalSource=resourceUrl)  → poll nodes until fileStatus READY + image.url
upload-asset-from-url(cdn url)          → returns a Canva asset id
update_fill / insert_fill with that asset id
fileDelete(fileIds=[...])               → clean up
```
Requires Shopify `write_files` + creds from `sandbox/gebeauty/.env`. Reusable scripts: `scratchpad/shopify_files_upload.py` / `shopify_files_delete.py` (lift into `sandbox/gebeauty/scripts/` if this becomes routine).

**Confirmed:** hosting on Shopify Files does **not** affect storefront performance — files are inert unless referenced by the theme, and are deletable. Still, delete after ingestion (transient by policy).

**Team path (no Shopify creds):** teammates generate in Magnific, then **download the render and drag-drop it into Canva** manually. Simpler than it sounds and needs no scripting.

---

## 5. Recoloring a logo / flat-color asset

The `ge` logo in the templates is an **image asset** (`LOGO1000X1000.png`), not text — so **`format_text` cannot recolor it.** To change its color you produce a re-tinted PNG and swap it via `update_fill`.

### Fetching the current asset
`get-assets([asset_id])` returns a **200px** thumbnail URL. To download it:
- Add a browser **`User-Agent`** header, or you get **403**.
- Do **not** rewrite `height:`/`width:` in the signed URL to get full-res — the signature is bound to the params, so it 403s. Work with the 200px and upscale.

### The tint (flat-color transparent PNG)
The logo is flat red ink (~`226,56,47`) on transparent, ~14% opaque pixels. Recolor by **setting RGB to the target color and KEEPING the alpha channel** — the anti-aliased edges live in alpha, so they stay clean. Then upscale (LANCZOS) for the largest placement.

```python
a = np.asarray(Image.open("logo_src.png").convert("RGBA")).copy()
a[...,0], a[...,1], a[...,2] = 0xAC, 0x64, 0x71     # keep a[...,3] (alpha) untouched
out = Image.fromarray(a,"RGBA").resize((600,600), Image.LANCZOS)
```
Then Shopify-Files-host → `upload-asset-from-url` → `update_fill` on every logo element → delete the host file.

---

## 6. Brand-color harmonization (per-line tinting)

**Principle:** GE Red `#DF372F` is the brand anchor, but per product line the **headline, descriptor, and `ge` logo** are tinted to a color **drawn from the product itself**, so the creative reads as one palette. (Rose Ritual → dusty rose.)

### How to pick the color (defensible, not guessed)
Sample the plate, don't eyeball:
```python
# median of the vivid product-colored pixels, then darken for legibility on near-white
mask = (r>g+15)&(r>b+5)&(sat>0.25)&(lum>60)&(lum<210)
med  = np.median(a[mask], 0)                 # Rose → #C37180
while luminance(c) > 130: c *= 0.94          # darken → legible #AC6471
```
Apply the color to headline + descriptor via `format_text` (`formatting.color`), and to a re-tinted logo variant (§5). Target luminance ~120-130 keeps both a bold headline and a caption readable on the high-key near-white water.

**This is a brand decision, not purely mechanical** — surface it. Per-line tinting of the *logo* (vs keeping the mark a fixed brand color) is Lucas's call, not a default.

---

## 7. Canva workspace + template registry

- **Team:** GE Beauty Canva team.
- **Root creative folder:** `Criativos`.
  - `Criativos › Primers` — reference ad decks (`META_*` / `PMAX_*`). Source of the format families + clear zones.
  - `Criativos › Body & Hair Mists` — the Mist campaign.

### The Mist master
- **"Body & Hair Mist | Master Template (Rose)"** — `design_id DAHOV54G2g4`. View: `canva.com/d/WIV1SuqCABJYurz`.
- 4 pages, one per format: **4:5** (1080×1350), **1.91:1** (1200×628), **1:1** (1080×1080), **9:16** (1080×1920). Each page has: a full-bleed background **plate**, a **headline**, a **descriptor**, and the **`ge` logo**.
- Logo asset: red `MAHM2_0BtII`, rose-tinted `MAHOWYtf3mU`. Rose type/logo color `#AC6471`.

### Cloning the master to a new scent
1. `copy-design(DAHOV54G2g4)` → new design; `move-item-to-folder` into `Body & Hair Mists`; `update_title`.
2. Generate that scent's 4 plates (§1), ingest (§4), `update_fill` each page's background element.
3. `replace_text` the product name + descriptor.
4. Sample the new scent's product color (§6), `format_text` the headline + descriptor, and swap in a logo tinted to that color (§5).
5. Reposition copy into the plate's clear zone if the composition shifted (`position_element`).
6. `commit`. Share the `get-design` `view_url`.

---

## 8. Asset filesystem conventions

```
sandbox/gebeauty/imagery/
  <campaign>/                    # e.g. body-hair-mist, primers, amazon-brand-anchor, frizz-scalp
    source/                      # original Shopify/seed imagery
    expanded/                    # generated ad plates
  <campaign>/<recipe>.md         # per-campaign recipe/spec
```
- Plate/file naming: **`[dimensions]_[descriptor].png`** (e.g. `9x16_rose.png`, `3x2_curly-dark-brown.png`) so groups sort/compare by dimension.
- One folder per campaign/family; keep `source` and `expanded` split.

---

## 9. Team enablement (current state)

Chosen model: **direct first-party connectors + a shared workflow via a claude.ai Project.**
- **Magnific** — added at the **claude.ai team** level; each user just activates + auths into the **shared GE Beauty Magnific account** (one credit pool = central cost cap).
- **Canva** — each user enables the connector with their **own** login, which must be a member of the GE Beauty Canva team.
- **Method** — the `GBCR — GE Beauty Criativos` block in `inputs/claude-ai-project-instructions.md`, pasted into a claude.ai Project, plus the two knowledge files (`mist-magnific-prompts.md`, `primers-ad-format-spec.md`).

**Deferred (own session):** hosting Magnific/Canva as first-class tools *inside* the NAMI connector (`apps/connector`). Verdict from this session: **Magnific** is a clean fit (one SSM-held shared key, `src/tools/magnific/` vertical mirroring the existing pattern, central cap, zero per-user setup) and worth doing if usage proves out; **Canva** is not worth centralizing (its rich editing is per-user OAuth + MCP-native, so hosting it either loses per-user identity in the Canva team or requires a new per-user token subsystem). Conventions stay in Project instructions regardless.

---

## 10. Gotchas index (quick scan)

- Magnific plain/`auto` gen invents a **second waterline** → use `imagen-nano-banana-2` reference-guided uncrop.
- Only apply the above-water-bubble **seed-fix to sources that are actually wrong**.
- Source waterline at the top edge **warps** → prompt for one clean undistorted surface.
- Canva **can't fetch Magnific/pikaso signed URLs** → transient Shopify Files host, or manual drag-drop.
- `format_text` needs a nested **`formatting`** object + top-level **`page_index`** + **`pages`**.
- **Font family is not settable** via the Canva MCP (color/size/weight/style are).
- A logo **image asset can't be recolored with `format_text`** → re-tint the PNG (keep alpha) + `update_fill`.
- `get-assets` thumbnail download needs a **User-Agent**; you **can't** upscale via URL param rewrite (signature 403).
- The **`design_id` is not the URL slug**, and the transaction `edit_design_url` is ephemeral → get share links from **`get-design`**.
- **Always `commit`** the Canva transaction; draft edits vanish otherwise.
- Delete transient Shopify Files after Canva ingests (inert to store perf, but keep it clean).
