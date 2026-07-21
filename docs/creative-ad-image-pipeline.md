# Creative Ad-Image Pipeline — Canva + Magnific

How we produce paid-ad and web-banner imagery for GE Beauty (and any future CPG Labs brand): generate/extend base imagery in **Magnific**, lay it out and overlay copy + logo in **Canva**, both driven through their hosted MCP connectors from Claude.

This is the canonical playbook. It captures the working recipe **and** every non-obvious thing we had to discover — the tool quirks, the auth walls, the physics failures, and the fixes. Read it before doing Canva/Magnific creative work so you don't re-derive the same lessons.

Related docs: [gebeauty-theme-customization.md](gebeauty-theme-customization.md) (storefront), [shopify-performance-leverage-matrix.md](shopify-performance-leverage-matrix.md). Ad-format clear zones: `gebeauty/imagery/primers/primers-ad-format-spec.md`. Mist recipe: `gebeauty/imagery/body-hair-mist/mist-magnific-prompts.md`.

---

## 0. The two tools and what each is for

| Tool | MCP | Role | Auth |
|---|---|---|---|
| **Magnific** | `mcp.magnific.com/mcp` (hosted, first-party) | Generate imagery, generative **zoom-out / uncrop**, upscale, remove-bg, relight | OAuth per user; **team uses ONE shared GE Beauty Magnific account** (one credit pool, central cost cap) |
| **Canva** | `mcp.canva.com/mcp` (hosted, first-party) | Layout: place images, overlay/format text, swap logo, resize/position, export | OAuth **per user**, each logged into the GE Beauty Canva **team** so shared templates are visible |

Neither is custom code we own — they are Canva's and Magnific's own hosted servers. What **we** built is the *method*, the *templates*, and the *filesystem conventions* below.

The recipes/brand rules are **not** deliverable as MCP tools — claude.ai does not turn a server's prompts/resources into standing behavior. They live as **claude.ai Project instructions** (block `GBCR` in `inputs/claude-ai-project-instructions.md`) plus the two knowledge files above.

---

## GLOBAL layout rule (read first)

Whitespace (for headline/copy + `ge` logo) placement depends on orientation:
- **Horizontal** (16:9, 1.91:1, 21:9) → **product LEFT, whitespace RIGHT.**
- **Vertical** (4:5, 9:16, and 1:1 square) → **product BOTTOM, whitespace TOP.**

When extending a background, reveal the new empty space accordingly (right for horizontals, top for verticals) and keep the product untouched. House default for all products/campaigns (set 2026-07-09). Memory: `feedback_product_left_whitespace_right`.

## Copy fill + placement rules (whitespace-first) — read before laying any headline (set 2026-07-19, Rose Ritual claims)

How copy sits in the clear zone. Learned the hard way on the Rose Ritual claims test; applies to every still ad.

1. **Readability-against-contrast is the hard constraint (general rule).** Copy goes ONLY where it stays clearly legible — over a clean, high-contrast area. Never over the product, imagery, props, or any textured/similarly-colored region that hurts contrast. ("Don't touch the leaves/water" was just how this showed up on the underwater plate; the real rule is contrast/legibility on ANY image.) When fill vs readability conflict, **readability wins**.
2. **Whitespace-first: fill the WIDTH, don't stack narrow.** Widen the text box into the clear area and size the font to fill most of that width. Do NOT keep a fixed narrow box and let copy stack into many short lines (that both under-fills the whitespace and marches into the product). Widening + fewer, longer lines is the goal.
3. **Fewest rows.** One line if the whole claim fits at a readable font; else the minimum lines. Short claims → one big line filling the width.
4. **Regressive line length + phrase consistency.** Multi-line: break ONLY at phrase boundaries AND step line lengths DOWN (longest on top). No short-then-long. The trailing "e" is a balancing element — attach it wherever keeps the phrase clean and the shape regressive.
5. **Hug** the name/title block (small consistent gap ~30px), and **re-hug on every resize**.
6. Font size **varies per asset to fill** — set-uniformity across a set is irrelevant (nobody sees two assets side by side); optimize each for fill + readability.

When does per-claim width-fill (this section) vs one-flat-size-for-the-set (§3 "Match the SET's type scale") apply? **Per-claim fill is for claim sets whose lengths vary WIDELY** (Rose Ritual ran 14-60+ char descriptors under a fixed name+subtitle) — a flat size would either strand short claims in whitespace or crush long ones. **Flat-size is for sets of similar-length hooks** (Travel-Size, Eleonora's first PMAX pass) where a single calibrated size reads consistent across the set and shrink-per-hook is the failure mode. Per-claim fill still needs the ceiling below to stop it overpowering the hierarchy.

### Type-scale CEILING — set this BEFORE building the master (Lucas, 2026-07-20/21)
Fill-to-width without a ceiling overshoots: a short, wide-filled claim can render LARGER than the product name it sits under, breaking info hierarchy. Four rules, cheap to set up front, expensive to redo after 30+ assets are built:
1. **Max 2 rows of text.** Never 3+, even if the natural regressive split wants more.
2. **Row 1 length >= row 2 length**, always (no short-then-long).
3. **Copy font size <= 1.1x the subtitle's font size** (the fixed "body & hair splash"-style line under the product name), per page. This is the precise, general form of "copy must read subordinate to the title" — anchored to the subtitle, not eyeballed.
4. **Respect the existing text box width/height** — reduce font to fit, never let the box grow past its original footprint.

**How to derive the ceiling (subtitle font size isn't in any Canva snapshot):** (1) open a transaction on a committed design, (2) widen the subtitle's box temporarily so its text renders on ONE line, (3) `format_text` a known test `font_size` (e.g. 100) and read the resulting box `height`, (4) `factor = height / test_font`, (5) `original_subtitle_font = original_height / factor`, (6) `ceiling = round(1.1 * original_subtitle_font)`, (7) `cancel-editing-transaction` — zero side effects, nothing saved. Repeat once per platform template (fonts differ across templates even in the same brand). Set the ceiling per format BEFORE cloning the master, not after 27 of 38 assets need a rescue pass.

### Corrected width-fill formula (2026-07-21 — replaces the original 0.52/1.63 estimate)
The original estimate (`font ≈ 1.63 × usable_width / chars`, from an assumed `0.52 px per font-unit×char`) was never re-verified against real renders and under-filled most claims to only ~85% of box width. **Measure the real char-width constant by pixel-sampling a rendered export**: crop the descriptor text region, threshold on its known color, measure the x-extent of matched pixels, divide by (font_size × char_count). Two independent samples across two platform templates gave **k ≈ 0.505-0.512** consistently (not the assumed 0.52). Corrected formula, targeting ~93% fill (safety margin for kerning variance):

**`font = round(1.85 × usable_width / longest_line_chars)`**, then clamp to the type-scale ceiling above.

**Re-derive `k` (and the resulting coefficient) per template/font-family before trusting this on a new campaign** — don't assume `1.85` transfers to a different brand font. And when applying a ceiling correction, **check both directions**: the bug that caused a second correction pass on Rose Ritual was clamping DOWN when the formula overshot the ceiling but never bumping UP when it undershot — leaving several assets under-filled even though they were nowhere near the ceiling. Compare computed-font vs ceiling explicitly; don't just floor at the ceiling and stop.

Mechanics: `resize_element` sets box width (text height auto), `format_text` sets `font_size`; verify each render (the formula lands close but orphans/overflow/contrast need an eyeball) and nudge. Full worked spec + per-claim regressive break map + the ceiling values per format: `gebeauty/imagery/rose-ritual-claims/ROLLOUT-SPEC.md`.

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

### Copy-matrix propagation — clone-and-swap, don't retype (Travel-Size build, 2026-07-10)
Building N hooks × M formats: **do NOT author fonts/positions per variant.** The winning method:
1. Perfect ONE design (all M format pages) with the user until they approve exact fonts/positions/plate. That becomes the **template**.
2. `copy-design` the template per hook → each clone inherits the exact typography, plate, and layout. `replace_text` the headline + support only.
3. Element local-IDs (the `-LB…` suffix) are **stable across copy-design clones** — both builds confirm this, so one edit recipe drives every clone. The `<page_id>` prefix is **flow-dependent**: it changed per clone in the Travel-Size build but was **identical across all clones** in the Body & Hair PMAX build (held for 19+). So verify on your first clone with one `start-editing-transaction`; only hardcode page_ids for later clones if they proved stable. (Fresh `transaction_id` per design regardless.)
4. **Finalize + commit the master BEFORE mass-cloning.** Clones freeze the master's state at clone-time; editing the master afterward does NOT propagate back to existing clones — you re-open and re-fix each by hand. Cloning 6 variants before the master was calibrated cost ~18 redundant edit cycles (the biggest avoidable cost of the PMAX build).

Fit-adjust ONLY where a hook's length differs from the template:
- **Shrink-to-fit, never reposition.** If a longer headline overflows or crowds the `ge` logo, reduce `font_size` and keep the anchor `position` fixed. Do not move or widen the frame to make room.
- **Support hugs the headline.** Anchor the support (secondary line) `top` = headline `top` + headline box `height` + ~20-30px. When the headline shrinks or grows lines, RE-anchor the support — a smaller headline must not leave a blank band above the support. (This was the single most-repeated correction of the build.)
- **Minimal whitespace / maximize headline.** Push the headline as large as fits the clear zone; verticals especially want big multi-line headlines, not small ones floating in dead space.

### Two text-physics quirks that bit us
- **Justify-spread on soft wraps is TEMPLATE-DEPENDENT (not universal).** In the Travel-Size master, Canva justified/stretched a line that soft-wrapped to fill the box width, so auto-wrapped headlines looked stretched and uneven → **defeat with hard `\n` breaks** so no line soft-wraps. In the Body & Hair PMAX master this never happened (always left-aligned/ragged-right). The behavior lives in the text element's paragraph alignment in the source design — **check your master's alignment before assuming justify is on.**
- **Support box wider than canvas → clips off-edge:** a support text box authored at e.g. width 1338 on a 1080-wide 9:16 canvas pushes a long one-line support off the right edge invisibly. Wrap the support to 2 lines (hard `\n`) so it stays on-canvas.

Font size is NOT returned by transaction snapshots — infer it from box `height`. The **line-height factor is template-dependent — measure it, don't hardcode**: observed ≈0.97 × font_size per line on META_CACHOS2 (Travel-Size), ≈1.29-1.33 × on the Body & Hair PMAX master. Derive it from two known `font_size`→`height` samples on the same string, then confirm by eye. Or preserve size by simply not calling `format_text`. Rough char-width estimate for fit math: line px ≈ 0.46-0.49 × chars × font_size.

### Export quality — always set `export_quality: "pro"` explicitly (Rose Ritual, 2026-07-21)
`export-design` for PNG **defaults to `export_quality: "regular"` when the field is omitted**,
which silently downsamples/recompresses the raster **photo fill layer only** — vector text and
image-asset logos aren't resampled, so they render pixel-identical either way. Net effect: text
and logo look sharp, the background photo looks soft, and it's easy to miss because it also looks
fine *inside the Canva editor* (softness only shows up once you export and zoom into the actual
pixels). Confirmed on Rose Ritual: the same page exported at `"pro"` came back 36% larger with
visibly sharper photo detail (skin texture, leaf veins, water droplets), text/logo unchanged.
**Always pass `format: {..., export_quality: "pro"}` explicitly on every `export-design` call** —
never rely on the default. Cheap sanity check after a batch export: new file size should be
meaningfully larger (roughly 15-45% depending on page size/photo-pixel proportion) than a same-page
export done without the flag; if sizes look identical, the flag didn't take.

### The share-link trap (cost us a "link doesn't work")
- The `design_id` (`DAHOV54G2g4`) is **NOT** the URL slug.
- The `edit_design_url` returned inside a *transaction* is ephemeral, not the canonical share link.
- Get the real links from **`get-design(design_id)`** → `urls.edit_url` / `urls.view_url`. Share those.

### Cross-session merge — Body & Hair Mist PMAX build (Eleonora, 2026-07-11)
A second, independent GE Beauty still-ad build (Body & Hair Mist, PMAX, pre-shot plates,
no Magnific, Canva-cloud-only) validated most of the above and added these. Folded into
the `/creative-producer` skill as hard rules; kept here as the deeper reference.

- **`status:"success"` != valid layout.** Every Canva op reports success even when the
  text overflows, is illegible, or runs off-canvas — "success" only means the property
  was set. QA is always visual/geometric; never infer a good layout from the op result.
- **Match the SET's type scale — the failure mode, quantified.** Shrinking font per hook
  to fit each string produced a **20-58px spread on the same format**, reading as broken
  across the set. Correct default: one size per format calibrated to the *shortest
  comfortable* hook (or a fixed brand scale), then hard-break the long outliers at a
  phrase boundary. Fit-shrink is a last resort within a band. (Both builds hit this; it's
  the #1 taste correction.)
- **Enumerate EVERY text element before a color/QA pass.** A static subtitle got left
  un-recolored on all 7 assets because "title + claim" wasn't the full text inventory.
  List title / hook / support / subtitle / label every time.
- **QA every asset, not a sample.** Same character count != same word-wrap (break points
  depend on the actual characters). Render and eyeball every claim × every size.
- **Check the brand library FIRST — real ratio-correct plates beat generated ones.** The
  PMAX plates were pre-shot per ratio (each a distinct `asset_id`, incl. an independently
  composed 1:1), so no generation and zero credits. Only derive a plate when no
  ratio-correct shot exists.
- **Verify target dimensions before building.** A wrong-dimension build is 100% wasted.
  The handoff's stated sizes (1200×1400/800/400) were not a real spec; the true house
  standard was found by cross-referencing the account's own historical PMAX files +
  the platform's official ratios: Google PMAX **960×1200 / 1200×628 / 1200×1200 / 1080×1920**.
- **Re-tint = swap, not recolor.** `update_fill` swaps one image asset for another; there
  is no tint op. To recolor a logo you need a pre-made brand-color VARIANT asset already
  in the account (find it) or a re-tinted PNG produced externally and ingested.
- **Long clone-heavy sessions blow a ~32MB request ceiling.** Every mutating call returns
  a full inline preview image; they accumulate until the client payload limit trips and
  kills the session mid-task. Batch edits, don't preview every op, and commit → export →
  download → update-manifest in checkpoints so a fresh session can resume.
- **No delete API + egress caveats.** Clone-heavy builds leave orphan/scratch designs only
  a human can delete in the UI (track their IDs). And reading a Canva render back can be
  403-blocked (`media.canva.com`), so don't pixel-sample for a hex — take brand values
  from the design system.
- **Cloud-only ⇒ keep a written manifest.** A design ID isn't human-legible; maintain a
  per-campaign manifest (design links, font/color state, local paths, scratch IDs) as
  both the operator's index and the resume point.
- **Diacritic-safe uppercasing (PT-BR):** "hidratação" → "HIDRATAÇÃO"; a naive ASCII
  uppercase strips accents and corrupts the copy.

### Filing hard rule (Lucas, 2026-07-11)
- **One Canva design per CLAIM per PLATFORM**, every size variation as a **page** inside
  it. Meta and Google are separate designs (different specs).
- The **exported PNGs (one per page) are the deliverable** injected into the ad managers.
- Local mirror, platform-sorted so the folder is drag-ready:
  `gebeauty/imagery/<campaign>/creatives/<platform>/<size>_<claim-slug>.png`.
- **Cut operator friction:** on completion and at each checkpoint, OPEN the output folder
  for the operator (`Start-Process` on Windows). If you can't (headless / cloud-only),
  open the Canva folder link + hand over the clickable manifest. The operator is not
  technical — never leave them a bare ID or a command to run.

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
Requires Shopify `write_files` + creds from `gebeauty/.env`. Reusable scripts: `scratchpad/shopify_files_upload.py` / `shopify_files_delete.py` (lift into `gebeauty/scripts/` if this becomes routine).

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

**Principle:** GE Red `#DF3630` is the brand anchor, but per product line the **headline, descriptor, and `ge` logo** are tinted to a color **drawn from the product itself**, so the creative reads as one palette. (Rose Ritual → dusty rose.)

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
gebeauty/imagery/
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
- `export-design` PNG **defaults to `export_quality: "regular"`**, which softens the photo layer
  only (text/logo unaffected) → **always pass `export_quality: "pro"` explicitly.**
- Width-fill font formulas are **template/font-family specific** — re-derive the char-width
  constant by pixel-sampling a real render before trusting a coefficient from a prior campaign.
- A type-scale **ceiling relative to the subtitle font** (not just "looks about right") stops
  fill-to-width from overpowering the info hierarchy — derive it once per template, before cloning.
