**SUPERSEDED 2026-08-09** — Lucas redirected: rebuild the full deck as an interactive
Cowork artifact instead of updating the claude.ai original (which turned out to have no
reachable edit path anyway — confirmed a second time, page freezes on scroll
automation). See the `ge-beauty-retention-study` Cowork artifact and
`docs/retention-hero-products-study.md` / `docs/booster-combo-repeat-study.md`. Left
below for history, not for action.

---

# Paste into the "GE Beauty — Acquisition + Rescue Defense" claude.ai conversation

The artifact itself (claude.ai/code/artifact/0a012efc-e6ee-43d4-ae9f-6fbf895a4cba) is
read-only from here — no edit or chat affordance on the standalone artifact page, and
it's canvas-rendered so there's no text to extract either. To update it, open the
**conversation** that generated it (not the standalone artifact link) and send the
message below — Claude will regenerate the artifact with a new section added in the
same hand-drawn/sketch style as the rest of the deck.

---

## Message to send in that conversation

> Add a new section to this artifact, right after the "Repeat rate by first-order
> product (price-adjusted)" table, in the same style as the rest of the deck (same
> eyebrow label format, same red/black type treatment, same hand-drawn arrow +
> smiley-circle motif where it fits). Title it **"Boosters are only anti-heroes
> ALONE"** and cover this:
>
> **Headline finding:** boosters bought as part of a multi-item first order gain
> +4.7pp repeat rate over booster-solo (10.4% → 15.1%) — a bigger jump than the
> +2.3pp generic combo lift non-booster products get (13.2% → 15.6%). Boosters aren't
> doomed products; they're specifically weak as a **standalone first purchase**.
>
> **Table — strongest booster+partner combos** (repeat rate, n≥25 combo-buyers, ranked
> by lift vs the 14.1% catalogue baseline):
>
> | Booster | Partner | n | Repeat rate | vs. baseline |
> |---|---|--:|--:|--:|
> | Antioxidante | Máscara condicionadora (hero) | 348 | 25.3% | +11.2pp |
> | Fortificante | Travel máscara condicionadora | 292 | 23.6% | +9.6pp |
> | Antioxidante | Shampoo sem sulfato (hero) | 366 | 23.0% | +8.9pp |
> | Fortificante | Shampoo sem sulfato | 872 | 21.1% | +7.0pp |
>
> **Nuance callout** (don't drop this — it's the honest part): not every combo works.
> Booster definição + the full-size leave-in proteção térmica (n=2,440, the largest
> sample of any leave-in variant) sits *below* baseline at 13.6%. The effect is real
> and general, but not uniform — flag this the same way the original deck flags
> Primer cachos as "the weakest, also the biggest acquisition source."
>
> **Practical implication, as a closing line:** reframe from "avoid boosters in
> acquisition" to "don't let a booster be someone's only first purchase" — a
> bundling/merchandising lever, not a booster-avoidance one.
>
> Full data + methodology: `docs/booster-combo-repeat-study.md` in the repo (script:
> `gebeauty/growth/module-a/booster_combo_repeat.py`), if you want to pull more rows
> than the ones above.

---

## If that conversation is stale/hard to find

Fall back to a **new** claude.ai artifact/conversation with the same prompt, referencing
`docs/retention-hero-products-study.md` (the sole-SKU findings this extends) and
`docs/booster-combo-repeat-study.md` (the full combo study) as source material — Claude
can rebuild the same visual style from scratch if the original thread isn't reachable.
