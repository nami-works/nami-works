# GE Beauty — Hero Products & Repeat-Behavior Study

**Source:** claude.ai artifact "GE Beauty — Acquisition + Rescue Defense"
(`https://claude.ai/code/artifact/0a012efc-e6ee-43d4-ae9f-6fbf895a4cba`), captured into this repo
2026-07-31. Renders inside a sandboxed iframe with no direct export path found this session —
captured via browser screenshots. The sections below are everything that was reachable before the
browser tab became unresponsive; there may be more content further down the artifact that wasn't
re-verified this pass.

## Why this doc exists

This study is the empirical basis for **"strong repeat-behavior product" (SRBP)** as used in the
Prevention Nudge design work (this session, 2026-07-31): which products a customer owns should
drive proactive nudge timing, and which customers belong in the separate, more aggressive
First-Routine Bundle Offer. Treat this file as the authoritative source for that classification
until/unless the underlying study is updated.

## Core finding

> Our most viral products are not great at retention. The wash routine creates loyal customers.

The products driving new-customer acquisition (viral primers, mists, boosters) are largely **not**
the products that make customers come back. A specific trio — the "wash routine core" — is. The
strategic implication (as framed in the source): campaigns should move new customers **onto** the
wash routine, by giving, not by discounting.

## Repeat rate by first-order product (price-adjusted)

Sample: mature full-history customers, n=24,567, first order 90+ days ago. Base repeat rate in
this universe = **14.4%**. "Residual" = actual repeat rate minus what first-order price alone
would predict — isolates genuine product stickiness from "expensive first orders just repeat
more." Positive = genuinely sticky (hero); near-zero = neutral; negative = anti-driver.

| Product | Repeat rate | Residual vs price | Tier |
|---|---|---|---|
| Máscara condicionadora (002) | 21.1% | +4.2pp | **Hero** |
| Shampoo sem sulfato (001) | 20.8% | +3.9pp | **Hero** |
| Shampoo a seco (008) | 19.2% | +3.2pp | **Hero** |
| Primer liso (102) | 16.7% | +1.2pp | Neutral |
| Leave-in térmica (003) | 16.5% | +0.6pp | Neutral |
| Booster definição (021) | 13.7% | -1.7pp | Anti-hero |
| Primer cachos (101, "the viral") | 11.9% | -2.6pp | Anti-hero (weakest — also the single biggest acquisition source) |

**The fidelity drivers: 001 · 002 · 008 (the wash core)** — Shampoo sem sulfato, Máscara
condicionadora, Shampoo a seco. This trio is the operational definition of "strong repeat
behavior" (SRBP-eligible) used in this session's Prevention Nudge cascade.

## A routine beats a product

Repeat rate when the first order is a single hero product vs. the full wash routine:

| First order | Repeat rate | vs. non-hero |
|---|---|---|
| Non-hero first | 11.9% | baseline |
| Any hero first | 19.2% | 1.61× |
| Wash routine first (001+002+008 together) | **25.0%** | +7.2pp above price expectation, R$573 12-month revenue |

Establishing the whole routine on day one is the strongest retention signal in the catalogue —
stronger than any single hero product alone. This is why "buy two, get one free"-style routine
offers are framed as a retention play, not a markdown.

## The rescue cohort

One-time buyers who never bought a hero product at all:

- **19,206** one-time buyers, never bought a hero
- **18,781** emailable (98%); ~17,130 after excluding <30-day recency
- **Weakest-retaining first category: mist, 13.6%** (booster 14.4%, formula 15.6%, for comparison)

Top first-products among this cohort (the "anti-heroes" dominate, as the retention data predicts):

| Product | Buyers in cohort | Repeat rate |
|---|---|---|
| Primer cachos (101) | 5,172 | 11.9% |
| Booster definição (021) | 4,791 | 13.7% |
| Melon mist (024) | 4,383 | 13.6% |
| Booster hidratante (020) | 3,044 | 12.7% |
| Leave-in térmica (003) | 2,711 | 16.5% |
| Booster antifrizz (022) | 2,619 | — |
| Primer liso (102) | 1,842 | 16.7% |

Note from the source: Leave-in térmica (003) sits inside this cohort despite not being a hero —
the associated rescue email opens with a yes/no read on the customer's first product, then routes
the offer accordingly.

## The two campaigns this study was built to decide (context, not this session's scope)

The source artifact frames its "decision on the table" as choosing between: (A) a new-customer
acquisition offer on the landing page/checkout, and (B) a single rescue email to one-time buyers
who never tried a hero product. That decision is separate from — but the direct upstream input
to — this session's work automating the **First-Routine Bundle Offer** (buy shampoo, get máscara +
travel-size leave-in or dry shampoo), which targets exactly this rescue cohort.

## How this feeds the Prevention Nudge design (2026-07-31 session)

- **SRBP-eligible ("strong repeat behavior") products** = the hero trio above (001, 002, 008).
  Customers who own one or more get timed nudges off that product's cadence (personal pace if
  they've repurchased it, else population pace).
- Customers with **no hero product and no repeat purchase at all** are exactly the rescue cohort
  above — routed to the First-Routine Bundle Offer instead of the standard credit mechanism.
- Everyone else (no hero, but has repurchased something) falls to a general personal-pace nudge.
