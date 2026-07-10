# GE Beauty — Shopify listing ingredient/INCI quality assessment

**Date:** 2026-07-02 · **Scope:** 12 core products · **Mode:** assess-only (nothing written to store)
**Source of truth:** on-label INCI + ANVISA filings in `G:\Drives compartilhados\GEB_Produto`
**Method:** 12 parallel agents, one per product, each confined to a per-product whitelist of
non-secret label files. Consolidated data: `scripts/_catalog_inci_assessment.out.json`.

## Guardian outcome (formula protection)
**Zero formula leaks.** No agent read `formulacoes/` / `precificacao/` / `orcamentos/` / `FÓRMULA`
files. Two agents (Primer Cachos 101, Primer Liso 102) encountered quantitative percentages inside
ANVISA petitions and **correctly withheld them** (`secrets_encountered_and_withheld: true`) — the
architecture worked as designed. All returned data is qualitative INCI only.

## Headline
The store's ingredient layer is systematically thin. The dedicated highlight field
`custom.ingredients` is **empty on 11 of 12 products** — populated only on the mist/Mayday family,
and on Mayday it is **wrong**. No product carries a full legal INCI anywhere on the listing, which
directly blocks the marketplace catalogs (Amazon 1P, Sephora, Beleza na Web, Mercado Livre) that
mandate one. The real label actives are rich and on-brand; the gap is fillable from the label
without new sourcing.

## Severity ranking

| Verdict | SKU | Product | Core issue |
|---|---|---|---|
| 🔴 MAJOR | GEB 121 | Máscara Mayday | `custom.ingredients` is a **different product's INCI** — a hydro-alcoholic mist list (Aqua, Alcohol, PEG-40 HCO, Parfum…), not the reconstruction mask's emulsion. Actively misleading. |
| 🟠 MISSING | GEB 001 | Shampoo sem Sulfato | No ingredient content in any field. Label leads with murumuru + crambe/girassol/abacate + panthenol + sulfate-free surfactants — none surfaced. |
| 🟠 MISSING | GEB 003 | Leave-in Proteção Térmica | `custom.ingredients` null. **Voice-map hallucination risk:** canon lists "proteína de seda (silk)" but the real label has NO silk protein. |
| 🟠 MISSING | GEB 022 | Booster Antifrizz | No ingredient/INCI content at all. Label binds óleo de coco/chia/trehalose to the antifrizz benefit — unused. |
| 🟠 MISSING | GEB 101 | Primer Cachos Definidos | No ingredient content. **Claim mismatch:** listing says "24h", label says 12h. (withheld pct) |
| 🟡 MINOR | GEB 102 | Primer Liso Intacto | `custom.ingredients` null; **claim mismatch** listing "24h" vs label 12h. (withheld pct) |
| 🟡 MINOR | GEB 002 | Máscara Condicionadora | `custom.ingredients` null; strong oil/butter story (abacate, crambe, girassol, murumuru, cupuaçu) unused. |
| 🟡 MINOR | GEB 020 | Booster Hidratante | `custom.ingredients` null; label has INCI nomenclature typos to fix before syndication. |
| 🟡 MINOR | GEB 021 | Booster Definição | `custom.ingredients` null; content otherwise clean (chia, linhaça, xilitol). |
| 🟡 MINOR | GEB 023 | Booster Antioxidante | `custom.ingredients` null; chá verde/pantenol/xilitol/galactoarabinan all provable, unused. |
| 🟡 MINOR | GEB 120 | Leave-in Pluma | `custom.ingredients` empty; pantenol + arginina provable and unused. |
| 🟡 MINOR | GEB 024 | Melon Mood Mist | Has `custom.ingredients` but **truncated to first 10** — drops the hero marketed active Anadenanthera Colubrina (AcquaBio). Mist family (029/031/032/033) shares this list. |

## Cross-cutting patterns

1. **`custom.ingredients` empty on 11/12.** The marketing-highlight field designed for a lighter,
   consumer-friendly active story is unused across nearly the whole catalog.
2. **No full legal INCI anywhere on any listing.** This is the marketplace-blocking gap. Every
   external catalog that requires INCI must currently source it off-line from the label. The full
   ordered INCI was recovered from the label for most SKUs and is in the JSON.
3. **Ingredient-as-proof voice rule unrealized.** `custom.caracteristicas` is benefit-only on every
   product — claims float with no active bound to them, though real provable actives exist.
4. **Two claim-accuracy defects:** both primers (101, 102) show **24h on the listing vs 12h on the
   label**. Either the listing or the label is wrong — this needs a human/fiscal call, and it also
   contradicts the voice canon (which asserts 24h for primers). Flag, don't self-resolve.
5. **One likely hallucinated active in the voice canon:** "proteína de seda" for the thermal leave-in
   (003) is not on that product's label. The voice reference map should be corrected.

## Recommended actions (assess-only — your call on execution)

- **Fix now (accuracy defect):** replace Mayday 121 `custom.ingredients` with a highlight derived
  from its real reconstruction actives (arginina, d-pantenol, abacate, girassol). It currently
  misrepresents the product.
- **Resolve the 24h/12h primer claim** with fiscal/label before any marketplace syndication, and
  reconcile the voice canon.
- **Backfill `custom.ingredients`** across the 11 empty SKUs as benefit-bound highlights (label
  actives are captured per-SKU in the JSON).
- **Add a full-INCI field/tab** per product, seeded from the recovered label INCI, to feed
  Amazon 1P / Sephora / BLZ / Mercado Livre. This is the single highest-leverage catalog-parity item.
- **De-truncate Melon Mood (024)** and propagate the corrected list to the mist family.

## Caveats
- `custom.descricao_longa_com_abas` is a metaobject reference that was not resolved in this pass;
  ingredient copy could live inside its tabs. A follow-up should resolve those metaobjects before
  concluding a SKU has "zero" ingredient content in the long description.
- Mist variants 029/031/032/033 were assessed via GEB 024 as representative (shared base INCI).
