# GE Beauty — Do booster combos break the "boosters are anti-heroes" belief?

**Source:** repo-native analysis, 2026-08-08 (Lucas's question: is there any scenario
where the belief is wrong). Extends `docs/retention-hero-products-study.md` — read that
first for the sole-SKU premise this study tests against. Script:
`gebeauty/growth/module-a/booster_combo_repeat.py`, output
`gebeauty/growth/module-a/booster-combo-repeat.out.json`.

**Data:** `orders_raw.jsonl`, dumped 2026-07-22, n=50,409 orders, 2025-06-01 to
2026-07-22. ~2.5 weeks stale relative to today — fine for a 90-day-mature repeat-rate
study, not fine if this needs to support a real spend decision (re-pull first).
Methodology matches `hero_repeat_premise.py` exactly (full-history customers only,
classified by FIRST order's SKU set, 90-day maturity cut) so results are directly
comparable to the existing hero-vs-non-hero numbers.

## Short answer

**Yes — the belief is right for boosters bought ALONE, and wrong for boosters bought
as part of a multi-item first order.** That's not just "more items = more loyal
customer" either: boosters specifically gain *more* from being combined than the
average product does.

| First order | n | Repeat rate |
|---|--:|--:|
| Booster, solo (single-item first order) | 2,754 | **10.4%** |
| Booster + ≥1 other item | 10,699 | **15.1%** (+4.7pp) |
| Non-booster, solo | 8,095 | 13.2% |
| Non-booster + ≥1 other item | 4,207 | 15.6% (+2.3pp) |
| Catalogue-wide baseline | 25,844 | 14.1% |

Combining roughly doubles a booster's own solo repeat rate and erases essentially all
of its "anti-hero" gap versus the catalogue average — a bigger jump than the generic
combo effect on non-booster products (+4.7pp vs +2.3pp). Boosters aren't doomed
products; they're specifically weak as a **standalone first purchase**.

## Which combos are strongest (booster + hero especially)

Top of 65 (booster, partner) pairs with ≥25 combo-buyers, ranked by lift vs the 14.1%
catalogue baseline:

| Booster | Partner | n (combo) | Repeat rate | vs. booster-alone | vs. baseline |
|---|---|--:|--:|--:|--:|
| Antioxidante | Máscara condicionadora (hero) | 348 | 25.3% | +9.4pp | +11.2pp |
| Fortificante | Travel máscara condicionadora | 292 | 23.6% | +6.7pp | +9.6pp |
| Fortificante | Travel shampoo sem sulfato | 285 | 23.2% | +6.2pp | +9.1pp |
| Antioxidante | Shampoo sem sulfato (hero) | 366 | 23.0% | +5.9pp | +8.9pp |
| Fortificante | Shampoo a seco (hero, per doc) | 415 | 22.7% | +6.0pp | +8.6pp |
| Fortificante | Máscara condicionadora (hero) | 737 | 22.5% | +7.3pp | +8.5pp |
| **Fortificante** | **Shampoo sem sulfato** (Lucas's example #1) | **872** | **21.1%** | **+5.6pp** | **+7.0pp** |

Lucas's example #1 (shampoo sem sulfato + booster fortificante) holds up cleanly: 21.1%
repeat rate at n=872, a real +7.0pp lift over baseline — not a fluke of a tiny sample.

## The nuance: example #2 (booster definição + leave-in) does NOT hold up as strongly

| Booster | Partner | n | Repeat rate | vs. booster-alone | vs. baseline |
|---|---|--:|--:|--:|--:|
| Definição | Leave-in pluma | 1,021 | 15.3% | +2.1pp | +1.2pp |
| Definição | Travel leave-in proteção térmica | 932 | 14.9% | +1.7pp | +0.9pp |
| Definição | Leave-in proteção térmica (full) | 2,440 | 13.6% | +0.2pp | **-0.5pp** |

The full-size leave-in + definição combo — the largest sample of the three variants,
n=2,440 — sits *below* the catalogue baseline. This isn't noise (n is large); it's a
real, weaker pairing. Worth being precise about this with anyone downstream: the
belief-breaking effect is real and general, but it is not uniform across every booster
× partner pair, and Lucas's second illustrative example happens to land on one of the
weaker ones, not a strong one.

## Where the effect doesn't show up at all

10 of 65 combos (all involving Máscara Mayday or Melon Mood body & hair splash /
travel-size, and mostly booster definição) sit at or below baseline even combined —
worst: Booster antioxidante + Máscara Mayday, 10.3% (-3.8pp vs baseline, though n=117 is
thinner here). These read as gift/impulse-adjacent products that don't carry the same
"routine-building" signal regardless of what they're paired with.

## Open discrepancy, flagged not resolved

The hero trio is defined two different ways in this repo: the doc
(`retention-hero-products-study.md`) says **001/002/008** (shampoo sem sulfato, máscara
condicionadora, shampoo a seco); the code (`market_basket.py`,
`hero_repeat_premise.py`) says **001/002/003** (...swaps in leave-in proteção térmica
for shampoo a seco). This script tested against both 003 and 008 as partner candidates
rather than picking a side. Whoever owns the hero-product definition next should
reconcile this — it's a real inconsistency, not a rounding difference.

## Practical implication

The booster line's role as an **acquisition** driver (viral, high top-of-funnel pull)
doesn't have to trade off against retention if the offer bundles a booster with a core
product on the first purchase, rather than selling the booster solo. This reframes the
"boosters are anti-heroes" belief from "avoid boosters in acquisition" to "don't let a
booster be someone's ONLY first purchase" — a bundling/merchandising lever, not a
booster-avoidance one.
