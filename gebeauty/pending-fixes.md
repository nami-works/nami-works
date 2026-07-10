# GE Beauty — Pending Fixes

Low-urgency issues discovered during operations. Fix when convenient; not blocking anything active.

---

## Shopify

### GEB 121 assinatura — duplicate EAN
- **What:** Variant "Máscara Mayday (assinatura)" has barcode `0042882635451`, same as GEB 024 (Melon Mood Body & Hair Splash).
- **Impact:** No B2B impact (assinatura is excluded from all external catalogs). Physical scanning of the assinatura variant would resolve to the wrong product.
- **Fix:** Assign a correct unique EAN to the assinatura variant in Shopify admin.
- **Found:** 2026-06-12

---

## B2B registrations

### GEB 121 (Máscara Mayday) — missing physical specs
- **What:** Comprimento, Largura, Altura, Peso Bruto, Peso Líquido still blank in the Rappi NOVOS PRODUTOS file. Not found in any source file including Unilog.
- **Impact:** Rappi registration incomplete for GEB 121 until specs are provided.
- **Fix:** Once Raphael responds (email sent 2026-06-12), fill in the Rappi file and products.json.
- **Found:** 2026-06-12
- **Note:** GEB 029 specs were resolved via Unilog file (2026-06-12) — dimensions 40×45×140mm, gross 100g.

### GEB 029 (Melon Mood Mini) — units_per_carton conflict
- **What:** Lucas stated 49 units/box; Unilog file says 36. products.json and Rappi file currently have 36 (Unilog value).
- **Fix:** Confirm canonical value with ops/logistics, then align both files.
- **Found:** 2026-06-12

---
