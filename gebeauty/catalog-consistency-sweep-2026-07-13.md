# GE Beauty — catalog consistency sweep (claims/actives vs canonical)

**Date:** 2026-07-13 · **Trigger:** the GEB 003 "proteína da seda" finding (false active on a PDP image) · **Scope:** 14 active SKUs · **Method:** for each SKU, diffed every live claim-bearing surface (PDP image alt/infographic text, `descricao_longa` tabs, `custom.ingredients`, `caracteristicas`, ingredient cards) against the canonical label INCI (from the guardian INCI pass) + fidelity-checked active map. 14 parallel auditors + targeted visual inspection of on-image infographics + Amazon A+ cross-check.

**Nothing changed on the store. This is assess-only.**

## Visual verification note (corrected 2 auditor calls)
Auditors read alt text as a proxy for on-image copy. I pulled the actual pixels for the 3 highest-stakes on-image claims:
- **003 ingredient infographic — CONFIRMED in pixels.** "Proteína da Seda" is printed as a headline active (and "Trealose" is misspelled on the image). Needs image regeneration.
- **001 Slide2 — NOT on-image.** Clean styled photo (peony + melon as props, no text). The "principais ingredientes" claim is only in the alt text. Alt-text fix, not a reshoot.
- **019 "Anti queda" — NOT on-image.** The pixels say only cosmetic bullets ("Controla a oleosidade / Cuida da saúde do couro cabeludo / Nutre os fios prevenindo a quebra / Fortalece os fios"). The "Anti queda" wording lives in the alt text + description, not the image.

---

## MAJOR findings

### 1. GEB 003 Leave-in Térmico — "Proteína da Seda" (false active), 3 surfaces + Amazon
Silk protein is NOT on the real label (actives: chia, trehalose, Thermoshield, Sensactive Veg, oils/butters). It appears on: the **PDP ingredient infographic image** (pixels, confirmed), `descricao_longa.o_que_e`, and the **Amazon A+ draft** (MOD 3 + Ativos). → regenerate the image, fix o_que_e, fix A+.

### 2. GEB 003 — "Sálvia" mislabel + internal contradiction
`Salvia Hispanica` = **chia**, not sage. The ingredient card + `ingredientes` tab call it "Sálvia" while o_que_e + the image call it "chia" → one ingredient shown as two. Also affects the FAQ brief I built (fix before publish).

### 3. GEB 003 — Sensactive Veg copy is from a rinse-off product
`ingredientes` tab: "em contato com a pele... beta-endorfinas... deixar seu banho ainda mais gostoso." This is a leave-in (not rinsed, applied to hair), so the skin/banho copy is wrong-context. → rewrite for the leave-in.

### 4. GEB 019 Booster Fortificante — anti-queda / MEDICAL over-claim (ANVISA risk)
Cosmetic product positioned with therapeutic claims in TEXT (not the image): biotina "reestabelece o crescimento capilar", alcaçuz "antiinflamatória", "caindo além do normal", "auxiliar na queda", plus "Anti queda" in alt text. → reframe to cosmetic (fortalece / reduz quebra / controla oleosidade). Compliance-sensitive.

### 5. GEB 101 + GEB 102 Primers — "24h" vs label "12h"
The 24h claim is on 3-4 text surfaces per product (`caracteristicas`, `o_que_e`, `resultado`, + Wavemax blurb) AND the Amazon A+ draft; the label says 12h. Known conflict, **flag for label/fiscal reconciliation, do not self-resolve.** (Not on the images.)

### 6. GEB 021 Booster Definição — "Trehalose" card is a wrong active
021's INCI has NO trehalose (its humectant is **xilitol**). The Trehalose hero card also carries an off-brief thermal claim ("proteção térmica contra secador e chapinha") that doesn't belong to a definition booster. → swap card to xilitol.

### 7. Coined trade-name actives presented as ingredients (verify with label/supplier)
`ingredientes` tabs present branded names as hero actives that don't map cleanly to the INCI: **Allinea** (022 + 120), **ThermoShield Premium** (120), and these contradict the ingredient cards (which name the real actives: chia, trehalose). NOTE: some GE trade names ARE legitimate (ProShine, Sensactive Veg map to real INCI); Allinea / ThermoShield Premium / Wavemax need label/supplier confirmation before we either keep-with-mapping or remove. → verify, then reconcile tab vs cards.

---

## MINOR findings

- **INCI data quality (marketplace-blocking garbles):** 008 ("Linoleic Acida Xylitol", "Coprylic Acid", "Porfum", "Propaner Citronellol"), 101 ("Tretalose"), 102 ("Crital" junk token), 001 (drops 2 label allergens: Citronellol + Hydroxycitronellal). These break the legal INCI feed for Amazon/Sephora/BLZ/ML. → clean before syndication.
- **008 timing conflict:** image "30 segundos" vs passo-a-passo "2 a 3 minutos" dwell. Plus unsubstantiated "todos os tipos de cabelo".
- **Hero-set mismatches (cards vs on-image infographic):** 021 (xilitol vs trehalose), 023 (chia/trehalose vs xilitol), 120 (trehalose vs Allinea/ThermoShield), 121 (girassol heroed on label/image but no card). Editorial consistency.
- **Templated cross-sell link bug:** 020 + 023 `passo_a_passo` link text "leave-in clássico" points to the proteção-térmica URL. Likely repeats on more SKUs.
- **121 Mayday texture contradiction:** o_que_e "textura mousse ultraleve" vs image "creme reconstrutor branco."
- **024 Melon Mood press quote:** ELLE citation "hidrata os fios" vs canonical split (hair = shine, skin = 72h hydration).
- **001 hero photo alt text:** peônia + melão described as "principais ingredientes" (they are the fragrance story, not actives). Alt fix.
- **Missing-hero coverage gaps:** 020 (milho absent from cards/infographic though 2nd-highest INCI), 102 (coco + tocopherol not heroed).

---

## RESOLVED since the 2026-07-02 INCI pass (verified this sweep)
- **121 Mayday** `custom.ingredients` — no longer a different product's mist INCI; now the correct mask INCI.
- **024 Melon Mood** — no longer truncated; full 21-token INCI incl. AcquaBio hero.
- `custom.ingredients` backfilled across the catalog.

## CLEAN
- **GEB 002 Máscara Condicionadora** — no inconsistencies.

---

## Cross-cutting patterns
1. **The `descricao_longa.ingredientes` tab is the main offender** — it carries the coined trade names (Allinea/ThermoShield), the sage/chia mislabel, the wrong-context Sensactive copy, and the medical over-claims. The ingredient cards and o_que_e are cleaner.
2. **On-image defects are rare but real:** only 003's infographic has a false active baked into pixels. Most "on-image" flags were actually alt-text drift (001, 019). Alt text across the catalog is inconsistent with the actual image copy and should be re-synced.
3. **Defects propagate to Amazon A+** (silk protein, 24h) — fix canonical (Shopify) first, then regenerate the A+ so channels inherit the corrected version.
4. **INCI strings have OCR/transcription garbles** on several SKUs — a clean re-seed from the label is the marketplace-parity unlock.

## Suggested fix order (your call; all gated)
1. Accuracy/compliance first: 003 silk protein (image + text + A+), 019 medical over-claims, 021 wrong active. Route copy through /content-director, image through the ad-image pipeline.
2. Flag-only: 101/102 24h-vs-12h (needs label/fiscal decision).
3. Verify trade names (Allinea / ThermoShield / Wavemax) with label/supplier, then reconcile tabs vs cards.
4. INCI clean-up re-seed (008/101/102/001) before any marketplace syndication.
5. Re-sync image alt text to actual on-image copy catalog-wide; fix the templated cross-sell link.
