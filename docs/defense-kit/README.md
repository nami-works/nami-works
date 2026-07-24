# Defense Kit — shared two-register deck scaffold

Reusable template + doodle-asset library for any **defense deck**: a decision-forcing
artifact you publish (as a private Artifact) when you want a committee, a partner, or a
stakeholder to sign off on a plan. First used inside the CGO intake loop for GE Beauty
(`gebeauty/growth/CGO-TEAM.md` → "Defense deck"); nothing about the format is tenant-
or domain-specific, so this lives at the repo root under `docs/` and any surface can
use it.

## The rule: fidelity matches the claim (two registers)

A defense deck has two deliberate registers. Mixing them is the mistake:

- **Act 1 — Groundwork (doodle).** ONE panel. The big-picture idea in plain terms — the
  mental model, or `situation → lever → outcome`. Hand-drawn feel, paper ground, marker
  font, **generated doodle imagery**. **No precise numbers.** Its only job is shared
  understanding before the discussion gets dense. Short and physical.
- **Act 2 — The case (clean, serious).** The evidence and the decision — accurate
  charts, real numbers, plan, risks, the ask. Credible, not playful. This is where
  it goes deep.

The visual step-up between them is intentional. Doodle earns comprehension; clean earns
trust. **Never render data in the doodle style** — accuracy lives only in Act 2.

## Why generated doodles beat code-drawn shapes

Earlier iterations of this kit drew Act 1 with rough-filtered SVG rectangles and a
marker-font stack. It read as "trying to look doodly with half-baked boxes" — the
containers gave the game away because a real hand doesn't draw a rounded rect with
consistent stroke width and a turbulence filter; it draws an actual object. The kit
now leans on **Magnific-generated doodle illustrations** for the nodes; only *lines*
(arrows, underlines) stay code-drawn, because a rough-filtered line reads as a
hand-drawn line, whereas a rough-filtered container reads as fake.

## Files

- `defense-deck-template.html` — copy this to start any deck. Self-contained (CSP-safe):
  Act 1 uses embedded doodle-image slots + hand-drawn arrows + marker-font text.
  Fill the `FILL:` slots, embed your icons as data URIs, publish as an Artifact.
- `icons/` — repo-wide library of doodle icons produced with Magnific in the reference
  style (lightbulb, up-arrow, target, magnifier, funnel, people, gear, coins). Extend it
  with the style prompt below whenever a deck needs a concept not yet in the library.

## How to build a deck

1. Copy `defense-deck-template.html` to a working file (e.g. `<workspace>/<topic>-defense.html`).
2. **Act 1** — write the ONE plain-terms idea (marker-font heading) + the 3-node model +
   the takeaway. NO numbers. For the imagery, brief **`/illustrator`** — the house doodle
   artist. Give them the concept (in business terms, not visual terms) + the role
   (defense-kit Act-1 node set or hero scene) + any anchors (numbers from Module A, brand
   context, etc.). They ask clarifying questions and deliver icons as file paths + data
   URIs, plus a suggested placement. Do not draw doodles by hand or by prompting Magnific
   directly — the illustrator maintains style coherence across decks and grows the
   `icons/` library.
3. **Act 2** — fill decision → read (tiles + accurate inline-SVG charts) → economics →
   plan → risks → ask. Real numbers, tabular figures, credible tone.
4. Publish via the Artifact tool. Private by default; share to whoever the committee is.

## Magnific style prompt (for extending `icons/`)

```
Hand-drawn business doodle icon, thick wobbly black marker outline, loose sketchy
strokes, flat pastel fill (soft blue / green / yellow / pink) with a single accent
color, light diagonal hatching, off-white paper background, no text, single concept
per image, centered composition, generous whitespace around the object.
```

After generating: run through `images_remove_background`, save into
`docs/defense-kit/icons/` as `icon-<concept>.png`, and reference it via a data URI in
your deck. Keep icons small (< 150 KB) — they're inlined into HTML and every KB counts
against the Artifact's first-paint budget.

**Accent-color tenancy.** When a specific tenant/brand uses a defense deck, override the
accent color once in `:root` at the top of the deck (e.g. GE Beauty red `#df3630`,
or the tenant's own primary) — everything downstream inherits. Icons stay repo-neutral;
the deck skin brands itself.

## Marker font (optional enrichment)

The template ships with a system fallback stack (`Bradley Hand`, `Segoe Print`,
`Comic Sans MS`, `Chalkboard SE`). For a fuller commitment, inline an OFL hand font
(Kalam / Caveat / Patrick Hand) as an `@font-face` data URI. Not required — the
fallback stack is enough for a first pass.

## Style inspiration

Reproduced (not redistributed) from the "hand-drawn business doodle" aesthetic
that appears across Freepik / Storyset / Undraw's sketch modes. The style itself is
not copyrightable, and every asset in `icons/` is generated fresh via Magnific.
