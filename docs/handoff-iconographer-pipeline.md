# Handoff — GE Beauty website icon system + `/iconographer` skill

**Date:** 2026-07-27 · **From:** session `nami-works` (VSCode) → **To:** Claude Code Desktop
**Zone:** `.claude/skills/**` (root state) + `gebeauty/**` (loose ops) + one live-theme edit
**HEAD:** `main`. Working tree has other sessions' files (2 M, ~43 ??) — do NOT sweep them.

---

## What this session did (in order)

1. **Spun off a new skill `/iconographer` ("Otto")** from `/illustrator` — Otto ships
   production, on-standard **website icons** (precise SVG), vs Iris's loose internal doodles.
2. **Reverse-engineered the GE icon family standard** from the 4 live `icones` metaobject
   SVGs and the brand library. Standard = `viewBox 0 0 51 51`, root `fill="none"`,
   **filled-outline construction (NOT stroke)**, one even ~1.3 weight, illustrative/botanical,
   single color. Ships as a **color pair**: `icon-<name>.svg` (`#DF3630` baked — the live
   `<img>` drop-in) + `icon-<name>.currentcolor.svg` (themeable master).
   → `#DF3630` is baked because `<img src=.svg>` ignores `currentColor`.
3. **Found the brand icon library in Drive** (`GB/IMGs` folder + vector sets):
   - **`ICONS FINAIS.ai`** = 18 finalized per-artboard icons (labels baked in) — the go-to.
   - **`ICONS SITE.ai`** = 7 clean-beauty icons.
   - `.ai` files are PDF-compatible (`%PDF`); render/parse with **PyMuPDF** (no poppler).
4. **Ran a 4-process generation experiment** (Lucas's ask: repeatable ~95% accuracy):
   - **A · library extract** → 99-100 ✅ (best; ~100% for concepts among the 18)
   - **B · primitive kit (code)** → 97-99 ✅ (best for novel mechanical/geometric)
   - **C · AI raster + autotrace** → 79-81 ❌ (tracing SOLIDIFIES line art into silhouettes)
   - **D · stock outline vector (Freepik)** → 99 ✅ (license premium + occasional scale trim)
   - **Conclusion:** cascade **A → B → D**, C dropped (redraw reference only).
5. **Built the deterministic engine** that makes it repeatable: `scripts/iconkit.py`
   (family shell + rounded primitive kit + `normalize_traced_svg` + `score()` auto-QA with
   7 checks + hard gates on color/ring/line-vs-solid), calibrated on the real family
   (`scripts/calib.json`). It gates **conformance, not taste** — always eyeball the render.
6. **Published 2 private artifacts** (claude.ai/code):
   - Inventory board: https://claude.ai/code/artifact/bc16d7e4-0e3d-4f88-9695-b73b88259c16
   - Pipeline/methodology: https://claude.ai/code/artifact/5658355b-deee-4f6a-99d9-3140e985f09e
7. **Live theme edit (shipped):** moved the **Máscara Mayday** slide (`slide_WMnewp`) to
   **position 1** of the homepage hero slideshow (`slideshow_igYUMi`) on the live theme
   **[Check] - Produção (181379236160)**. PUT 200. Backup at
   `scratchpad/index.json.bak` (session-temp — see "Gotchas" if you need to revert).

---

## Where things live

| Thing | Path |
|---|---|
| Skill definition | `.claude/skills/iconographer/SKILL.md` |
| Locked standard | `.claude/skills/iconographer/references/icon-standard.md` |
| **Engine** (kit+normalizer+scorer) | `.claude/skills/iconographer/scripts/iconkit.py` |
| Scorer calibration | `.claude/skills/iconographer/scripts/calib.json` |
| Process scripts | `.claude/skills/iconographer/scripts/proc_a_library.py`, `proc_cd_ai_stock.py`, `kit_examples.py` |
| Engine README | `.claude/skills/iconographer/scripts/README.md` |
| Reference family SVGs | `gebeauty/imagery/website-icons/_reference/` (4 live icons) |
| Memory | `~/.claude/projects/c--claude/memory/skill_iconographer.md` (indexed in MEMORY.md) |
| Sample outputs (SESSION-TEMP, not in repo) | scratchpad: `auth_*.svg`, `more_*.svg`, `out_A/`, `out_CD/` |

**Deps:** `pip install PyMuPDF numpy pillow`. Rendering via PyMuPDF; visual QA sheets via
headless Chrome screenshot of HTML.

---

## State / what is NOT done

- **NOTHING is committed.** The skill (`.claude/skills/iconographer/`), the engine, the
  reference SVGs, and the memory are all **untracked**. Commit on a **fresh branch**
  (`chore/iconographer-pipeline`) off `main` — do NOT land on whatever branch you inherit,
  and stage only these paths (never `git add .`; other sessions' WIP is in the tree).
- **Nothing deployed to the store** except the one slide reorder (already live).
- **Sample icons live only in scratchpad** (session-temp). If any are keepers, re-emit them
  into `gebeauty/imagery/website-icons/` via the engine and commit.

## Open decisions (for Lucas / next session)

1. **Commit the skill + engine** on a fresh branch? (recommended)
2. **Ingest all 18** `ICONS FINAIS.ai` icons as normalized `icon-<name>.svg` pairs into
   `gebeauty/imagery/website-icons/` as the canonical library?
3. **The 3 travel-size LP benefits:** extract `Sem sulfatos` from the library + author the
   two genuinely-missing ones (`limpa sem ressecar`, `use todos os dias`), in filled-outline.
4. Whether the "more suggestions" set (cachos definidos / efeito duradouro / proteção
   térmica / frete grátis) gets finalized + deployed.

---

## Gotchas / environment (carry these over)

- **`.ai` files are PDF-compatible** — open with PyMuPDF (`fitz.open`), render or parse.
- **No poppler / Ghostscript / ImageMagick** on this box. `convert` on Windows = the DISK
  tool, not ImageMagick. Use PyMuPDF for SVG/PDF → PNG.
- **Headless Chrome for HTML→PNG QA:** `chrome --headless=new --no-sandbox --disable-gpu
  --allow-file-access-from-files --user-data-dir=<temp> --force-device-scale-factor=2
  --window-size=W,H --screenshot=OUT file:///...` (needs its own `--user-data-dir`).
- **`.env`:** resolve from `C:\claude\gebeauty\.env` (ASCII path — the accented user-profile
  path caused UnicodeEncode/FileNotFound before).
- **Live theme = [Check] - Produção 181379236160.** Verify `role==main` before any edit
  (CheckCommerce cache-bust can swap the live theme). New `icones` metaobjects MUST be ACTIVE.
- **Store writes are gated** (`feedback_confirm_store_writes`).
- **The `index.json.bak` slideshow backup is in this session's scratchpad**, which the Desktop
  session won't share. If you need to revert the slide order, just move `slide_WMnewp` back to
  index 2 (0-based) in `slideshow_igYUMi.block_order` on theme 181379236160 — original order was
  `[slide_XrHipC, slide_RatCxf, slide_WMnewp, slide_ACUABt, slide_VDerxp]`.
- **MCP note:** Magnific/Drive/Freepik ran via the claude.ai connectors; `adobe-creativity`
  needs auth (was never required — PyMuPDF handled the `.ai` files).

## Suggested first move in the Desktop session

Read `.claude/skills/iconographer/SKILL.md` + `scripts/README.md`, confirm the open
decisions above with Lucas, then (on his go) commit on a fresh branch and/or ingest the 18.
