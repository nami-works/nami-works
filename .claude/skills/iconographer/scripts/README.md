# iconographer engine

Deterministic core that makes on-standard icons repeatable. A **source** only needs to
produce a monochrome line **motif**; everything family-specific is applied here and gated.

## `iconkit.py` (the engine)

- **shell**: `ring()`, `wrap(inner, color)`, `emit_pair(name, inner, outdir)` — emits the
  color pair (`#DF3630` baked + `currentColor` master) on the `viewBox 0 0 51 51` canvas.
- **primitive kit** (Source B): `k_circle`, `k_rrect`, `k_line`, `k_poly`, `k_spiral` —
  all stroked at the family weight (`SW=1.4`) with round joins (the anti-"squary" rule).
- **normalizer**: `normalize_traced_svg(svg_text)` — fits any traced/stock vector motif into
  the inner box, drops background frames, strips colors so the shell recolors it.
- **auto-QA**: `score(svg_path, calib)` — renders via PyMuPDF and returns a 0-100
  conformance score + `pass`. Checks: red-dominant color, ring present, weight band,
  centered, fills the ring, legible at 24px, and **line-vs-solid** (a hard gate: a solid
  silhouette can't pass). Calibrated on the real family in `calib.json`.
  **It gates conformance, not taste** — always eyeball the render too.

## The source cascade (pick cheapest/most-accurate first)

- **A `proc_a_library.py`** — extract an existing icon from `ICONS FINAIS.ai` (18) /
  `ICONS SITE.ai`. Scores 99-100. Best when the concept already exists. `.ai` files are in
  Drive (`GB/IMGs` + the vector sets); pull with the Drive tools, they are PDF-compatible.
- **B `kit_examples.py`** — compose from `iconkit` primitives. Deterministic; best for novel
  mechanical/geometric objects.
- **D `proc_cd_ai_stock.py`** (stock half) — `stock_search`/`stock_download` a thin-OUTLINE
  icon → `normalize_traced_svg`. License = Freepik premium.
- **C (AI raster + autotrace) — do NOT ship.** `proc_cd_ai_stock.py` also shows it: tracing
  a line drawing fills it into a solid silhouette; `score()` hard-fails it. AI raster is a
  redraw *reference* only.

## Deps

`pip install PyMuPDF numpy pillow`. Rendering uses PyMuPDF (no poppler/Ghostscript needed).

See the published methodology artifact for the full experiment + per-process accuracy.
