# Wash-Routine Offer — Asset Checklist (creatives + landing page)

Offer: buy Shampoo 001 + Máscara 002 (full), get a free third — customer picks
Leave-in travel 011 or Shampoo a seco 008. Same offer drives paid acquisition + rescue.
Status: ✅ have · 🟡 in progress · ⬜ to produce · ⛔ blocked (dependency)

Gates that block multiple assets:
- ⛔ **Final bundle price** (Lucas) — blocks every offer-value / CTA / "de-por" copy.
- ⛔ **Approved hook + LP copy** (content-director / Lucas) — creative-producer never writes copy.
- 🟡 **Corrected 4-pack hero labels** (Magnific, per-pack fixes) — source for all plates.

---

## A. CREATIVES (paid media)

### A1. Product plates (product never re-rendered) — DONE 2026-07-23
- ✅ Heroes received (Lucas, Magnific): `seed_4pack.jpg` (customer-choice, products-left),
  `hero_001-002-008.png` (gift B, centered), `hero_001-002-011.png` (gift A, centered). 1536² each.
- ✅ Expanded per-ratio plates: `expanded/{1x1,1.91x1,4x5,9x16}_wash-routine.png` (empty copy
  zones, products/labels preserved, natural studio bg). Method = Magnific Nano Banana Pro
  reference-guided zoom-out (per the playbook), NOT PIL (that read as a flat manual stretch).
  Source renders kept: `render_16x9-landscape.png`, `render_9x16-vertical.png`; 1:1 from the seed.
- 🟡 The two 3-packs are centered → available for LP gift-choice states / gift-specific
  retargeting; need a products-left recompose before use as a horizontal ad hero.

### A2. Brand / template (reusable — have)
- ✅ Canva master template META_CACHOS2 (4:5 / 1.91:1 / 1:1 / 9:16).
- ✅ GE logo (red #DF3630 variant) + Italian Plate No1 font + design tokens (inside the template).
- ✅ Near-white studio stage / background (from the source portfolio).

### A3. Copy (authored by content-director / Lucas — NOT creative-producer)
- ⬜⛔ Approved hook set per angle (headline + support): **rotina · presente · loyalty** (+ optional *escolha*).
- ⬜⛔ Offer-value line, CTA words, gift-choice callout (placeholder tokens until price locks).

### A4. Finished matrix (creative-producer output)
- ⬜ One design per angle per platform, exported PNGs:
  Meta = 3–4 angles × 4 formats = **12–16 assets**; Google PMAX = same set again if launched.
- ⬜ Per-campaign MANIFEST.md (design IDs + local files + QA state).

### A5. Ad-set + tracking (growth-hacker / integrations-engineer)
- ⬜ Dedicated ad-set copy hooks that STATE the offer (the ad text; matched to LP hero).
- ⬜ UTM scheme + discount-code family + order tag + customer segment (cohort isolation, guardrail 6).

---

## B. LANDING PAGE

### B1. Imagery
- 🟡 LP hero visual — the offer-products shot (reuse the corrected hero plate, LP-cropped).
- 🟡 Gift-choice cards: clean shot of Leave-in travel 011 + clean shot of Shampoo a seco 008.
- 🟡 "Como funciona" visual: the paid pair (001 + 002).
- ⬜ "Por que essa rotina" section: 3 step visuals/icons (limpar / nutrir / finalizar) — product thumbs or simple icons.
- ⛔ Social proof: real Loox rating/review counts for 001 + 002 (decision: surface real numbers vs drop the stars) — live Loox pull.
- ⬜ OG / social-share image for the LP URL (one of the hero plates).

### B2. Copy (content-director / Lucas)
- ⬜⛔ Hero headline + subhead (offer-stating, PT-BR, gift-first, no %-off), matched to the ad hook.
- ⬜ "Como funciona" 3-step copy (leve a dupla → escolha o presente → receba, sem cupom).
- ⬜ "Por que essa rotina" benefit copy (ingredient-as-proof).
- ⬜ Gift-choice labels + closing CTA.
- ⛔ Price / savings / gift-value token values (waits on price).

### B3. Build components (engineering bench)
- ⬜ The LP itself (theme section or standalone) — mockup exists (`lp-offer-mockup.html`), production build pending.
- ⬜ Gift-choice component (radio cards, live "seu presente" reflection, add-to-bag disabled until picked).
- ⬜ Checkout upsell (one-tap accept/decline, gift pre-defaulted, no chooser).
- ⬜ Offer mechanic (Shopify BxGy / Function — "buy 001+002, pick a free third").
- ⬜ Tracking wire-up (pixel, UTMs, tags/segment consistent with A5).

### B4. Data / config
- ✅ Product prices + metafields (Shopify, live).
- ⛔ Free-shipping interaction decision (silent vs "faltam R$X" nudge — pair may be < R$299).

---

## Fastest critical path
1. Export corrected hero PNG → run `expand_frames.py` → 4 plates (A1). 
2. Lock price (unblocks all offer copy + tokens).
3. content-director writes hooks (A3) + LP copy (B2).
4. creative-producer builds the matrix (A4); engineering builds the LP (B3) + tracking (A5/B3).
