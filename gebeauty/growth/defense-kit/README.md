# Defense Kit — GE Beauty CGO committee decks

The reusable style + scaffold for every **defense deck** (the committee-review artifact
in the CGO intake loop). Charter reference: `gebeauty/growth/CGO-TEAM.md` -> "Defense deck".
The proven full build to copy components from: `gebeauty/growth/module-a/kpi-deck.html`.

## The rule: fidelity matches the claim (two registers)

A defense deck has two deliberate registers, and mixing them is the mistake to avoid:

- **Act 1 — Groundwork (doodle).** ONE panel. The big-picture idea in plain terms: the
  mental model or core cause -> lever -> outcome. Hand-drawn, paper ground, marker font,
  rough strokes. **No precise numbers.** Its only job is shared understanding before the
  discussion gets dense. Keep it short; do not let doodle bleed into the data.
- **Act 2 — The case (clean, serious).** The evidence and the decision: accurate charts,
  real numbers, plan, risks, the ask. Credible, not playful. This is where it goes deep.

The visual step-up between them is intentional. Doodle earns comprehension; clean earns
trust. Never render data in the doodle style — accuracy lives only in Act 2.

## Files

- `defense-deck-template.html` — copy this to start any deck. Self-contained (CSP-safe):
  Act-1 doodle is pure code (rough SVG filter + hatch patterns + marker-font stack), so it
  works with zero external assets. Fill the `FILL:` slots; publish as an Artifact.
- `icons/` — GE-branded doodle illustrative icons (lightbulb, up-arrow, target, magnifier,
  funnel, people, gear, coins) for optional use in Act 1. Embed as data-URIs when publishing
  (artifacts block external assets). Produced with Magnific in the reference doodle style;
  regenerate/extend with the same style prompt (see below).

## How to fill a deck

1. Copy `defense-deck-template.html` to a working file (e.g. `module-a/<topic>-defense.html`).
2. Act 1: write the ONE plain-terms idea + the 3-node model + the takeaway. No numbers.
3. Act 2: fill decision / read (tiles + accurate charts, borrow from `kpi-deck.html`) /
   economics (floor + CAC from Module A via `/growth-analyst`) / plan / risks / ask.
4. Optionally drop an `icons/*.png` into Act 1 as a data-URI `<image>` inside the diagram.
5. Publish via the Artifact tool (favicon 📈), private by default, share to the committee.

## Enrichments (nice-to-have, not blockers)

- **Marker font:** inline an OFL hand font (Kalam / Caveat / Patrick Hand) as an
  @font-face data-URI to complete the Act-1 look. The template ships a system fallback stack.
- **Doodle icons:** style prompt = "hand-drawn business doodle icon, thick wobbly black
  marker outline, loose sketchy strokes, flat pastel fill (soft blue/green/yellow/pink) with
  a red accent, light diagonal hatching, off-white paper, no text." Generate, remove
  background, drop in `icons/`.

## Style inspiration

Reproduced (not redistributed) from Freepik's "Doodles Business Infographics" aesthetic;
GE-branded (GE red accent). Styles are not copyrightable and these decks are internal.
