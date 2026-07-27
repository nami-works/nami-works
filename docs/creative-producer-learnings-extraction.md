# Creative-Producer — Cross-Session Learnings Extraction

Paste-ready prompt to send to the OTHER session (the teammate who independently built
the still-ad creative process). Goal: absorb every learning + correction she hit into
our canonical `/creative-producer` skill and `docs/creative-ad-image-pipeline.md`.

Send everything between the START and END markers to her Claude Code session as-is.
The final section is for HER (human) to fill in from memory.

---

===== START — PASTE INTO THE OTHER SESSION =====

You are being asked to produce a **complete learnings extraction** from this session's
work building paid-media **still-image ad creatives** (product ad images across multiple
aspect ratios, with headline + support copy + logo laid over a product plate).

A parallel team already hardened this exact workflow and wrote it up. We want to **merge
your learnings into theirs** so nothing you discovered is lost. The most useful output is
a **diff**: where your process AGREES, where it CONTRADICTS, and where you found something
they did NOT capture. Be concrete — exact tool names, settings, numbers, pixel positions,
error messages, credits/time wasted, and dead-ends. Vague ("used AI to expand it") is
useless; specific ("tool X, mode Y, it deleted the product so we switched to Z") is gold.

## Their current method (diff against this — do not just restate it)

1. **Plate generation / background extension.** Extend/derive the product plate per aspect
   ratio WITHOUT ever re-rendering or cropping the product. Their finding: generative
   outpaint/"expand" regenerated and DELETED the product (wasted credits twice) — so they
   use either (a) a reference "zoom-out" generation for a continuous background then
   composite the REAL product region back over it, or (b) a deterministic pixel recanvas
   (scale + bottom-align + edge-replicate the padding). 1:1 is rebuilt to show the FULL
   product, not bottom-cropped from a taller frame.
2. **Getting the image into the layout tool (Canva).** Their layout tool couldn't fetch
   the generator's signed URLs, so they host the file transiently on a public CDN, ingest,
   then delete.
3. **Layout tool mechanics (Canva MCP).** Font family is NOT settable via the API → they
   clone a brand-font master template and only swap text, never type fresh. Edits happen
   in a transaction that MUST be committed or they vanish. Text styling (size/color/weight)
   is set per-element; font size is not returned by the API so it's inferred from box height.
4. **Copy-matrix propagation.** Perfect ONE template across all formats, then clone it per
   hook and replace only the headline + support text; clones inherit fonts/positions/plate.
5. **Layout & typography rules.**
   - House layout: horizontal formats → product LEFT / copy RIGHT; vertical formats →
     product BOTTOM / copy TOP.
   - Match the SET's headline weight — size every same-format headline to a common weight,
     then adjust line breaks to fit; don't shrink each hook independently to fit its box.
   - Support (secondary line) must HUG the headline (anchor to headline bottom + ~20-30px),
     and be re-hugged whenever the headline resizes.
   - Shrink-to-fit keeps the anchor position fixed (never reposition/widen the frame).
   - The tool JUSTIFIES soft-wrapped lines (stretches them) → defeat with hard line breaks.
   - A support text box wider than the canvas clips off-edge → wrap it to 2 lines.
   - Keep copy out of the logo's clear zone and off the product.
6. **QA gate (run on every asset).** (a) support hugs the headline? (b) minimal whitespace /
   headline as large as fits? (c) no copy invading the logo breathing space nor the products?
7. **Filesystem / naming.** Assets saved per campaign; filename pattern `<ratio>_<hookN>_<slug>.png`.

## What to produce (structured — use these exact headings)

For EACH section: mark each point as **[AGREE]**, **[CONTRADICT]** (state what you did
differently and why), or **[NEW]** (something above doesn't cover). Include the concrete
detail. If a section didn't apply to your build, write "N/A" and say why.

1. **Base imagery & background extension** — tools, modes, exact settings; what destroyed
   or degraded the product; what actually preserved it; how you derived each aspect ratio;
   1:1 handling.
2. **Ingestion into the layout tool** — how images got in; any URL/format/upload walls; the
   workaround; file cleanup.
3. **Layout-tool mechanics & quirks** — every API/UI gotcha, error message, and the fix;
   transaction/commit behavior; element addressing; anything that silently failed.
4. **Copy-matrix propagation** — how you scaled from one design to many hooks/formats; what
   inherited cleanly and what drifted; per-line color / logo re-tint / brand-font handling.
5. **Layout & typography** — headline sizing logic, support anchoring, fit math, wrap/justify
   behavior, logo & product clear zones; the specific things that "looked wrong" and the fix.
6. **Copy / hooks** — if you touched the words: the hook formula, offer mechanics, language
   rules (banned punctuation, calques), and any approvals gate.
7. **QA & review loop** — how you caught problems; the sequence of corrections you were asked
   to make (chronological if you can reconstruct it); what a reviewer flagged repeatedly.
8. **Platform specifics** — ad-platform placement/ratio/cropping behavior; safe zones; any
   asset that failed review or rendered wrong in a placement.
9. **Filesystem, templates & registry** — where things were saved; template/design IDs;
   naming; anything a future session needs to find the assets of record.
10. **Wasted effort & dead-ends** — anything you tried that did NOT work, so we don't repeat
    it. Include approximate credits/time cost where known.
11. **Top 5 lessons** — if you could tell the next person only five things, what are they?

Output as clean markdown under those 11 headings. Prioritize [CONTRADICT] and [NEW] points —
those are the whole reason we're asking. Do not soften disagreements; if their method is
wrong or riskier than yours, say so plainly and show the better way.

===== END — PASTE INTO THE OTHER SESSION =====

---

## For [teammate] to add by hand — "what I remember having to correct"

The extraction above is what the AI can reconstruct from the session. This part is YOURS —
the human memory the transcript won't hold. Please add, in your own words:

- **Corrections you had to make more than once** (the thing the AI kept getting wrong):
  >

- **A result that looked fine to the AI but wrong to you** (and what tipped you off):
  >

- **A rule you wish had existed from the start:**
  >

- **The single most time-consuming mistake, and its root cause:**
  >

- **Anything about brand/taste/voice** the process should respect but a generic pipeline
  would miss:
  >

- **Free-form — anything else you remember:**
  >
