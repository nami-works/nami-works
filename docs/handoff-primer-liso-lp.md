# Session Handoff — 2026-07-04 — Primer Liso Intacto LP + banner

## What was done
**Built the Primer Liso Intacto cold-traffic landing page end-to-end** (the "replicate to a 2nd product" validation of the landing-page-replication playbook).

- **Shopify Page created + published:** "Primer Liso Intacto", id `164368908608`, handle `primer-liso-intacto`, template `landing-page`. (Mirrors Cachos LP `164358750528`.)
- **All page metafields filled** via `gebeauty/scripts/_build_primer_liso_page.py`:
  - *ipsis-literis from the product* (verbatim): `tab_como_usar` / `tab_resultados` / `tab_saiba_mais`, `antes_depois_titulo` / `antes_depois_resultado`, `produto_em_destaque_1`.
  - *new killer cold-traffic copy* (content-director voice, no em dashes, 230°C/24h canon): `problema_*`, `solucao_*`, `ingrediente_{1,2,3}_*` (Allinea™ / óleo de girassol / trehalose), `faq_{1,2,3}_*`, `fechamento_*`.
  - `cta_cart_link` = `https://gebeauty.com.br/cart/50023991804224:1` (Liso variant) → wired to both hero + close CTAs. Verified 0 Cachos-variant leaks.
  - Benefit chips clone for free from the product's own metafields (no per-page setup).
- **Problem image:** uploaded `Desktop/scalp-references/scalp_straight_lightbrown.png` → `imagem_problema` (MediaImage `43790732132672`).
- **Before/after images removed** (`antes_foto`/`depois_foto` deleted) per Lucas — Liso `antes_e_depois` metaobject has no real photos; section now shows text only.
- **Banners:**
  - Mobile `banner_mobile` 960×1200 + desktop, from the Primer Liso PMAX creatives (`DAHNHiVOXk0`), headline **"escova perfeita por até 24h"**, GE logo stripped.
  - Desktop fixed 628→**480** to match Cachos.
  - **CTA-over-product fixed** (final): Magnific Nano Banana extended the studio bg to the RIGHT (model→left, label intact — no flip), then the banner was **rebuilt in Canva** (design `DAHOXsZr5LU`) reusing the seed's real-font text. Live `banner_desktop` = MediaImage **`43792307683648`** → replaced by **`43792372105536`** (final Canva build). 1200×480.
- **Colleague favor:** uploaded `scalp_curly_darkbrown.png` → `imagem_problema` on the **Cachos** LP (`43790739865920`) — that field was empty there too.
- **Initiative updated:** added **§3e** (bg-extend + Canva-rebuild fallback) + a dated Note to `.claude/initiatives/landing-page-replication.md`.
- **Memory updated:** `project_gebeauty_design_system` — banner font cuts (Italian Plate No1 **Expanded Bold** headline + **Mono** subhead; do NOT PIL-render copy, reuse Canva seed text).

## Key decisions
- **Liso message-match angle** = escova-prolongada + umidade-blindada + 24h (matches the PDP title tag). Hero headline chosen by Lucas: "escova perfeita por até 24h".
- **Fix the CTA collision at the ASSET layer, not the shared template.** The hero/close CTA is fixed bottom-right (`box_align`, shared with Cachos). Liso's creatives are all model-RIGHT so the CTA hit the product. Solution = extend bg right → model shifts left → bottom-right clean. No theme edit; keeps Liso consistent with Cachos (model-left/copy-right).
- **Do NOT flip the photo** (mirrors the product label — off-brand) and **do NOT re-render banner copy in PIL** (Canva MCP can't set font-family; a PIL Expanded *Demibold* render was rejected as off-brand). Reuse the seed design's own text elements in Canva.

## What's pending
- **Ingredients section renders empty** on BOTH Liso + Cachos LPs — pre-existing `multicolumn-ingredients` template bug. Values are set and waiting. Owned by the **initiative/template session**.
- **Solution image** (`midia`) is a packshot placeholder — needs a real solution shot.
- **Before/after section** shows text only — either provide real photos or have the template session make the section hide when images are absent.
- **Tracking (Pixel/CAPI/UTM) + formal publish/ad-repoint gate** — initiative phases 2/3 (Lucas deferred the PDP-vs-LP A/B build).
- **Mobile banner** stays the original model-right/copy-left shot — Lucas said "mobile is fine."

## Modified files (all under c:\claude, branch main — UNCOMMITTED, loose-ops tier)
- `gebeauty/scripts/_build_primer_liso_page.py` — page + metafields — **reusable**
- `gebeauty/scripts/_create_primer_liso_lp.py` — mockup generator — reusable
- `gebeauty/scripts/_upload_liso_problem_image.py`, `_wire_liso_banners_and_cachos_problem.py` — one-shot uploads — **cleanup-optional**
- `inputs/lp-assets/primer-liso/*.png` — banners, bg-extend variants A/B/C, clean photos, previews — assets
- `inputs/mockups/gebeauty-primer-liso-lp-v1.html` — copy-approval mockup
- `.claude/initiatives/landing-page-replication.md` — §3e + Note — **complete** (⚠️ this file is actively edited by another session — my edits were appended)
- (outside repo) memory `project_gebeauty_design_system.md` — banner font note

## Current state / how to verify
- **Live:** https://ge-beauty-cosmeticos.myshopify.com/pages/primer-liso-intacto (published; public HTML may be edge-cached a few min).
- Desktop banner = model-left, correct label + **correct Expanded-Bold font**, CTA on clean grey. Metafield `banner_desktop` → MediaImage `43792372105536` (authoritative if HTML is cached).
- Store creds: `gebeauty/.env`; Python `C:/Python314/python.exe`.

## Recommended next steps (priority order)
1. Decide before/after: supply real photos OR ask the template session to conditionally hide the section.
2. Swap the `midia` (solution) placeholder for a real shot.
3. Coordinate with the initiative/template session on (a) the ingredients-section bug, (b) the **theme swap** (below).
4. When Lucas green-lights: tracking wire-up + publish/ad-repoint gate.

## Context the next session needs
- **Theme swap (important):** the live theme is now the CheckCommerce "badge cache bust" duplicate **`186662158656`** (`role==main`); the old prod **`181379236160`** is now **UNPUBLISHED**. Template edits must target the LIVE theme — verify `role==main` first (see memory `reference_gebeauty_theme_publish_role`). If the template session is editing `181379236160`, those edits won't go live.
- **Banner rebuild recipe** is now §3e of the initiative. Working Canva design for the Liso desktop banner = **`DAHOXsZr5LU`**. Magnific extend prompt mirrors `gebeauty/imagery/body-hair-mist/mist-magnific-prompts.md` (Nano Banana Pro `imagen-nano-banana-2`, 21:9, reference-guided).
- The LP CTA overlay is bottom-right (shared template) — every banner must keep bottom-right clear of product.
- A **parallel session actively edits** the initiative + `page.landing-page.json` template — coordinate, don't clobber. Do NOT `git add .` (working tree holds ~60 files of other sessions' WIP).
- Repo relocated: `gebeauty/` at root (this session's `sandbox/gebeauty/...` references are the same tree via alias).
