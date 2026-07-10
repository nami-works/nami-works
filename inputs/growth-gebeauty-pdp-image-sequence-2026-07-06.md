# GE Beauty — PDP Image Assortment Reorganization (conversion audit + reorder plan)

**Mode:** growth-hacker / conversion audit · **Date:** 2026-07-06
**Surfaces:** Shopify PDP (primary) → propagates to Amazon 1P + marketplaces
**Grounding:** `G:\Meu Drive\.knowledge` — "Your PDP is costing you more than your ads are" (Nik Sharma), beauty CRO best practice
**Deliverable:** canonical image-sequence framework + per-SKU reorder plan (Lucas executes). Amazon MAIN-background decision deferred to upload time.

---

## The thesis
Every visitor on a PDP was already paid for (ad, influencer, search). The only question left is whether the page closes them. Images do most of the closing on mobile because **people scan, they don't read** (75-85% of traffic is mobile). Today GE's galleries have **no canonical order** — each product is sequenced ad hoc, the highest-converting shots are buried, and position 2 (first swipe) is often a blank-alt image. Fixing the *order* is close to free and compounds across every product AND every marketplace that inherits it.

## The canonical GE Beauty PDP image sequence (7 slots)
Order is conversion-ranked for mobile. **Slots 1-3 are the core** — most users never swipe past the third image, so hero → benefit → result must always hold. Omit a slot only if the asset truly doesn't exist (then it's a creative gap to fill, listed per SKU below).

| # | Slot | Job (what question it answers) | Spec |
|---|------|-------------------------------|------|
| 1 | **Hero** | "What is this?" | Clean product, front label legible, fills frame, brand bg `#ecede9`. No text overlay. ≥1600px sq (Amazon zoom). = Amazon MAIN. |
| 2 | **Benefit snapshot** | "Why should I care?" (first swipe) | The 3-4 top benefits, scannable in <2s (icon-strip ideal; the "O que faz" card works). Never leave slot 2 blank. |
| 3 | **Result / before-after** | "What will it do for *me*?" | Hair/skin outcome. Before/after is the single highest-converting beauty format — use it where honest. Currently buried at 5-6; move it up. |
| 4 | **Ingredients-as-proof** | "Why should I believe it?" | Hero actives bound to benefits ("O que tem"). **Can be fed by the new ingredient-texture cards we just built.** |
| 5 | **How to use / combine** | "How do I use it?" | Usage ritual. Critical for boosters (the "como combinar" drops). Reduces confusion → confidence. |
| 6 | **Social proof / UGC** | "Do people like me trust this?" | Influencer (Camila, Fiorella) or real customer UGC. Distribute proof, don't hide it. |
| 7 | **Detail / size / texture** | "Practical questions" | Volume (200ml), texture macro, what's-in-the-kit. Closes the last objections. |

**Global rules (all products):**
- Slot 1 is pure product, zero text (Amazon MAIN compliance + strongest hook).
- Descriptive `alt` on every image (SEO + accessibility + Amazon feed quality). Blank alt is a defect.
- Uniform square ≥1600px for zoom; no mixed portrait/banner ratios in the gallery.
- Deduplicate. One image per idea.

## Per-SKU reorder plan
"New order" references each product's *current* images by role. **Gap** = slot with no existing asset (creative to produce). **Cleanup** = fix before/while reordering.

| SKU | Current order (role) | New order | Gaps to fill | Cleanup |
|-----|----------------------|-----------|--------------|---------|
| **001** Shampoo s/ Sulfato | hero, blank, benefits, ingredients, result, product+ingr | hero → benefits → result → ingredients → product+ingr → lifestyle | how-to, UGC | alt for img2 & lifestyle |
| **002** Máscara Condic. | hero, benefits, ingredients | hero → benefits → ingredients | **result, how-to, UGC, detail** (only 3 imgs) | thin gallery |
| **003** Leave-in Térmico | hero, benefits, ingredients | hero → benefits → ingredients | result, how-to, UGC | ⚠️ ingredients card claims "proteína da seda" — NOT on the real label (hallucinated active, fix copy) |
| **008** Shampoo a Seco | hero, blank, blank, usage | hero → usage → (2 blanks reclassified) | **benefits, ingredients, result** | identify + alt the 2 blanks |
| **019** Booster Fortificante | hero, lifestyle(portrait), benefits, how-to, ingredients, influencer | hero → benefits → lifestyle → ingredients → how-to → influencer(Camila) | result/before-after | img2 is 1080x1350 portrait — re-crop square |
| **020** Booster Hidratante | hero, benefits, result, ingredients, benefits-infographic | hero → benefits → result → ingredients → how-to | how-to | merge/late the 2nd benefits infographic |
| **021** Booster Definição | hero, application, result, ingredients | hero → result → ingredients → application | **benefit snapshot**, UGC | — |
| **022** Booster Antifrizz | hero, application, formula, result, creative | hero → result → formula → application → creative | **benefit snapshot**, ingredients breakdown, UGC | — |
| **023** Booster Antiox. | hero, benefits, how-to, influencer, ingredients | hero → benefits → ingredients → how-to → influencer(Fiorella) | result/before-after | — |
| **024** Melon Mood Mist | hero, blank, blank, blank, blank, blank, 200ml×3 (dupes) | hero → (rebuild) | **benefits, result, ingredients, how-to** — almost everything | worst offender: 9 imgs, ~all blank-alt, **3 duplicate "200ml"** — dedup hard |
| **101** Primer Cachos | hero, blank, application, formula, result, benefits | hero → benefits → result → formula → application → lifestyle | UGC | alt for img2 |
| **102** Primer Liso | hero, blank, application, formula, result, benefits, banner | hero → benefits → result → formula → application → lifestyle | UGC | remove/relocate img7 (1990x815 banner, wrong ratio); alt img2 |
| **120** Leave-in Pluma | hero, benefits, ingredients | hero → benefits → ingredients | **result, how-to, UGC, detail** (only 3 imgs) | thin gallery |
| **121** Máscara Mayday | hero, blank, blank, blank, blank | hero → (rebuild) | **benefits, result, ingredients, how-to, UGC** — everything | 4 blank unlabeled imgs; identify + alt or replace |

## Catalog-wide gaps (creative backlog, ranked by leverage)
1. **Result / before-after** — missing on 8 of 14 (002, 003, 008, 019, 023, 120, 121, 024). Highest-converting beauty slot. Priority shoot.
2. **Benefit snapshot** — missing on 5 (008, 021, 022, 024, 121). Cheap to produce (icon-strip from existing copy).
3. **Ingredients-as-proof** — feed from the **new ingredient-texture cards** already built this cycle; standardize the "O que tem" slot across all.
4. **UGC / social proof** — only 2 products (019, 023) have an influencer shot. UGC video/photo is the single highest-leverage add per the knowledge source.
5. **Thin galleries** (002, 003, 120 = 3 imgs; 121, 024 = blanks) and **duplicates** (024) — fill to the 7-slot template.
6. **Alt-text + dimensions** — blanks everywhere; several images < 1600px (fail Amazon zoom); fix portrait/banner ratios (019, 102).

## Amazon / marketplace mapping
The marketplace inherits the Shopify order, so fixing Shopify fixes the feed. Map the 7-slot sequence to Amazon slots:
- **MAIN** = Slot 1 hero. ⚠️ Amazon MAIN technically requires a **pure-white** background; GE uses `#ecede9`. **Decision deferred per-channel** — resolve at upload: either keep brand bg (as accepted before) or produce a white-bg MAIN variant while the Shopify hero stays brand-bg.
- **PT01-PT08** = Slots 2-7 in the same conversion order (benefit → result → ingredients → how-to → social → detail).
- Amazon PT images *may* carry text/graphics (unlike MAIN), so the infographics are fine in PT slots.
- Fixes the current problem where Amazon inherited a scattered order with blank/duplicate images.

## Recommended execution order (highest leverage first)
1. **Reorder existing images** to the 7-slot template on all 14 (near-free, immediate lift). ← this plan
2. **Fix defects**: dedup 024, alt-text pass, re-crop 019/102, fix 003 "proteína da seda" claim.
3. **Fill the result/before-after gap** (8 products) — creative shoot.
4. **Standardize ingredients slot** from the new texture cards.
5. **UGC program** — collect customer video, the top long-term lever.
6. **Re-export sub-1600px images** for Amazon zoom, then re-syndicate.

## Next step / owners
- **Reorder (step 1):** can be executed via Shopify `productReorderMedia` — I can run it per-SKU on approval, or hand you the ordered list to do in admin.
- **Creative gaps (steps 3-5):** brief for /video-director + image pipeline (before/afters, benefit snapshots, UGC).
- **Claim fix (003):** route the "proteína da seda" correction through /content-director.
