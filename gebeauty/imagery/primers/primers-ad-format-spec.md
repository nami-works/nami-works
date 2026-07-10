# GE Beauty — Primer Ad Format Spec (for Magnific regen)

Derived from the creatives in Canva folder **Criativos › Primers** (META_* and PMAX_* Primer campaigns), 2026-07-02.
Verified against real exported pages (META_CACHOS2 product deck + META_FIORELLA model deck).
Use this when generating new base images for other products so they drop into the same template treatment (headline + `ge` logo overlay).

## How the folder is built
- **META_\*** designs → Meta placements. Big 100+ page decks (e.g. META_PRIMERLISO) are one format (4:5) with ~100 creative variations. Short decks (e.g. META_CACHOS2, META_FIORELLA) are multi-format "masters" holding one of each aspect ratio (4:5, 1.91:1, 1:1, 9:16).
- **PMAX_\*** designs → Google Performance Max. Same pattern; slightly different pixel sizes at the same proportions.

## The 4 proportions (this is what you set in Magnific)

| Proportion | Ratio (decimal) | Meta px | PMax px | Placement |
|---|---|---|---|---|
| **4:5** | 0.80 | 1080 × 1350 | 960 × 1200 | Feed portrait (primary) |
| **1:1** | 1.00 | 1080 × 1080 | 1200 × 1200 | Feed square |
| **9:16** | 0.5625 | 1080 × 1920 | 1080 × 1920 | Stories / Reels |
| **1.91:1** | 1.905 | 1200 × 628 | 1200 × 628 | Landscape / link |

Magnific `aspectRatio` tokens: **4:5, 1:1, 9:16 map exactly**. **1.91:1 is not a token** — use `2:1` (closest; =1200×600, only ~28px shy of 628, so a tiny extend not a crop). `16:9` is a worse fit. Generate at the model's max resolution, then run Magnific's upscaler to hit the target px above before handing to Canva.

## TWO template families — pick the one that matches your base image
The folder mixes two layouts. The clear zones are DIFFERENT between them. Since you're regenerating **product** images, Family B is the one to follow.

---

## FAMILY B — Product packshot (PRIMARY for regen)
Composition observed: flat light-grey seamless backdrop, soft shadow. Bottle laid at a slight angle biased to the **right**, with a matching cream/gel **swatch puddle** beside it (to its left). Logo `ge` **top-left**. Headline sits in the **bottom** band (portrait/square/vertical) or **left** half (landscape).

Generate the product cluster only; the headline + logo are added later in Canva. Leave the clear zones empty.

### 4:5 (1080×1350) and 1:1 (1080×1080)
```
┌───────────────────────┐
│ [logo] top-left        │  keep TL corner clear (~200×140)
│    PRODUCT CLUSTER     │  bottle angled, right of center
│   puddle left +        │  cluster fills top ~65-70%
│   bottle right         │
│                        │
│  HEADLINE ZONE         │  bottom ~25-30% = empty grey
└───────────────────────┘
```

### 9:16 (1080×1920)
```
┌───────────────┐
│ [logo] TL      │  top ~15% clear (also clears Stories UI)
│               │
│   PRODUCT      │  cluster upper-center, bottle right
│   CLUSTER      │
│               │
│  HEADLINE      │  lower third = clear
│   [logo] BC    │  small logo bottom-center; keep bottom ~12% clear
└───────────────┘
```

### 1.91:1 (1200×628) — the reframe
```
┌───────────────────────────────────┐
│  HEADLINE zone      [logo] top-right│
│  copy lives on      PRODUCT CLUSTER │  bottle far right, puddle center
│  LEFT ~50% (clear)  (right ~45-50%) │
└───────────────────────────────────┘
```

**Product regen clear-zone summary:** portrait/square → bottom band clear + top-left for logo. Vertical → top ~15% and bottom third clear. Landscape → left half clear + top-right for logo. Product cluster is always biased RIGHT.

---

## FAMILY A — Model / lifestyle (e.g. Fiorella; use only if the base image is a person)
Composition: single person, torso-up, plain neutral greige wall behind. Headline in a **top** banner; logo bottom-right.

- **4:5 / 1:1:** subject centered, clear band at TOP for headline, logo bottom-right.
- **9:16:** subject centered with headroom, clear top ~18% and bottom ~12% (dodges Stories/Reels UI), logo bottom-center.
- **1.91:1:** subject pushed RIGHT, copy on the LEFT half, logo top-right.

---

## Regen checklist (product / Family B)
1. Pick the proportion(s) from the table.
2. Prompt: flat light-grey seamless backdrop, even light, soft contact shadow.
3. Product: the bottle laid at a slight angle, biased right of center, with a matching cream/gel swatch puddle to its left.
4. Keep the clear zone empty per the maps: bottom band (portrait/square), top + bottom (vertical), left half (landscape). Always leave the logo corner (top-left, or top-right on landscape) clean.
5. Generate large, upscale to target px, hand to Canva for the headline + logo overlay.
