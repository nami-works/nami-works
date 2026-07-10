# Growth Audit — Primer Cachos & Primer Liso: ad→PDP message match

**Date:** 2026-07-03 · **Mode:** /growth-hacker lp-audit (+ lp-build to follow)
**Goal:** improve conversion of paid traffic by fixing where and how it lands.
**Anchor:** Nik Sharma "30 strategies" — #7 (cold traffic ≠ homepage/generic page), #13 (match LP hero to the ad), #14 (discount at every CTA), #15/#8 (sell the outcome, lead with the angle), #29 (every ad/LP is data).

---

## Account context (Meta, act_606199920079315, BRL, last 30d)
- ~R$52k/30d spend, blended ROAS ~5. Not an "ads don't work" problem (#4) — a funnel-leak problem.
- 75% of spend runs through one mixed-product `MISTO` campaign (structurally can't message-match one LP).
- Winning creatives are **influencer transformation videos**, not statics:
  - Primer Cachos — Fernanda Paes Leme, CTR 3.29%, ROAS 4.87 (highest-spend cluster ~R$12k/30d).
  - Primer Liso — Fiorela, CTR 2.71%, **ROAS 7.63 (best in account)**.
- Live ad hooks (from Meta Ad Library, ~170 active): "Seu liso por muito mais tempo", "Liso impecável o dia todo", "Definição de salão todo dia", "Xô, frizz! Em poucos segundos", "Cabelo de salão em casa", advertorial "5 hábitos que estão prejudicando seus fios", offer "Até 15% Off no site".

## Destination verification (Foreplay + Meta Ad Library)
- **Verified:** one Primer Liso ad → `gebeauty.com.br/collections/primers` (collection, not PDP). **Caveat:** ~Aug 2025 ad (historical).
- Current live destinations **not independently confirmed** — Meta creatives endpoint erroring, Foreplay cache sparse, public Ad Library hides click URLs. **ACTION:** Lucas to confirm current campaign destination URLs/UTMs, or retry Meta creatives API later. If any live spend still points at `/collections/primers`, that is a message-match break before the PDP loads.

---

## Diagnosis: both PDPs FAIL message match

| Gap | Primer Cachos | Primer Liso |
|---|---|---|
| Hero visual | bottle packshot, no Fernanda | bottle packshot, no Fiorela |
| H1 | "primer cachos definidos 250mL" (spec-led) | "primer liso intacto 150mL" (spec-led) |
| Transformation / before-after above fold | none | none |
| Social proof above fold | Loox 3.9★/69, loads client-side (invisible on first paint) | Loox 3.9★/69, loads client-side |
| Discount at CTA (#14) | WhatsApp-only coupon `NO_SEU_TEMPO_40` | WhatsApp-only coupon |
| Subhead | "cachos definidos por até 24h" ✓ keep | "escova intacta por até 24h" ✓ keep |
| Body copy | benefit-led, on-canon (24h, 230°C), no em dashes ✓ | benefit-led, ingredient-as-proof, on-canon, no em dashes ✓ |
| CWV | unavailable (PSI rate-limited) — re-run keyed | unavailable — re-run keyed |

Competitor benchmark: **4 of 4** loadable BR premium PDPs (Braé, Cadiveu, Wella, Keune) lead with a **packshot**; none use an influencer transformation. Transformation-led hero is a category-level white space, not just hygiene.

---

## Prioritized punch-list (most impact first)

| # | Fix | Scope | Owner | Effort | Impact |
|---|---|---|---|---|---|
| 1 | Transformation hero (creator still + short loop) as first above-fold module on paid landings — Fernanda for Cachos, Fiorela for Liso | both PDPs / dedicated LP | growth-hacker + integrations-engineer | M | H |
| 2 | Fix store-wide rating: surface stars on first paint AND run review-generation to clear 4.0 (currently 3.9★/69) | store-level | integrations-engineer + growth-hacker | M | H |
| 3 | Rewrite H1 from SKU/spec to outcome ("cachos definidos por até 24h, sem frizz" / "escova de salão até 24h em casa"); drop mL from title | both PDPs | content-director | S | H |
| 4 | Single visible/auto-applied discount code + reassurance directly under "adicionar ao carrinho" (#14) | both PDPs / LP | growth-hacker (offer = Lucas) | S | H |
| 5 | Pull creator/UGC + review count high, near price/CTA (Camila Coutinho, Giovanna Marini, Isabela Quinet, Terena Patrick already on pages) | both PDPs | content-director | S | M |
| 6 | Sticky mobile add-to-cart | both PDPs | product-developer | S | M |
| 7 | Keyed PageSpeed run + trim triple review vendors (Loox+Okendo+Yotpo all load; ~623 KB doc on Cachos) | store-level | integrations-engineer | M | M |
| 8 | Dedicated cold-traffic LP (hero = creator transformation) separate from the SEO PDP | new build | growth-hacker → product-developer | L | H |

## Escalations for Lucas (product/money/brand — not silent calls)
- **Offer at CTA (#14):** there is a progressive promo + a WhatsApp-only 40% coupon. What single offer should on-site paid traffic see at the buy button?
- **3.9★ rating:** below the 4.0 trust threshold, store-wide. Needs a review-generation push (owned decision + budget).
- **Dedicated LP product:** Cachos (biggest spend/volume) vs Liso (best ROAS) for the first build.

## Not changed
Read-only diagnosis. No store or ad changes made this session.
