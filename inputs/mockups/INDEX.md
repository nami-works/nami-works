# Mockups Index

Discovery layer for HTML mockups in this directory. **Read this file before starting any UI mockup work.** If a final mockup already exists for the feature you're touching, start from it instead of redrawing from `_template.html`. See the "Design Validation (mockup-first)" section in `CLAUDE.md` for the full workflow.

When you commit a new `-vN-final.html`, add or update its row here in the same commit. Schema below.

## Final mockups (locked-in visual language)

| Feature | Final mockup | Implements (route / component) | Last updated | Notes |
|---|---|---|---|---|
| Local Delivery — page tweaks (filters, route cards, map overlay) | [local-delivery-tweaks-v2-final.html](local-delivery-tweaks-v2-final.html) | [app/routes/app.local-delivery.tsx](../../app/routes/app.local-delivery.tsx) | 2026-04 | — |
| Mark-as-delivered — POD bucketing | [mark-delivered-pod-bucketing-v2-final.html](mark-delivered-pod-bucketing-v2-final.html) | [app/routes/app.local-delivery.tsx](../../app/routes/app.local-delivery.tsx) + [app/routes/api.control.$intent.tsx](../../app/routes/api.control.$intent.tsx) | 2026-05 | Active branch `feat/mark-delivered-pod-bucketing` |

## Pre-rule iteration mockups (no formal `-final`)

These mockups were created before this index existed. They reflect the latest iteration but were not promoted to a `-vN-final.html`. Treat them as the current visual reference for that feature; promote to `-final` when next touched.

| Feature | Latest mockup | Implements (route / component) | Notes |
|---|---|---|---|
| Affiliates — attribution queue revamp | [affiliates-attribution-queue-revamp-v1.html](affiliates-attribution-queue-revamp-v1.html) | `app/routes/app.affiliates.tsx` | — |
| CPG Labs landing page | [cpglabs-landing-v3.html](cpglabs-landing-v3.html) | `site/src/pages/index.astro` | v1, v2 are iteration history |
| Footprint Expansion | [footprint-expansion-v1.html](footprint-expansion-v1.html) | `app/routes/app.footprint-expansion.tsx` | — |
| Local Delivery — Manage Route modal layout | [ld-manage-route-modal-layout-v1.html](ld-manage-route-modal-layout-v1.html) | `app/routes/app.local-delivery.tsx` (Manage Route modal) | — |
| Loading overlay message | [loading-overlay-message-v1.html](loading-overlay-message-v1.html) | Shared loading overlay | — |
| Local Delivery — mobile | [local-delivery-mobile-v1.html](local-delivery-mobile-v1.html) | `app/routes/app.local-delivery-mobile.tsx` | — |
| Omnify home | [omnify-home-v1.html](omnify-home-v1.html) | `app/routes/app._index.tsx` (Omnify identity) | — |
| Retail Sales — full page | [retail-sales-full-v1.html](retail-sales-full-v1.html) | `app/routes/app.retail-sales.tsx` | — |
| Retail Sales — chart drilldowns | [retail-sales-chart-v2.html](retail-sales-chart-v2.html) | `app/routes/app.retail-sales.tsx` (KpiDrilldownBars) | — |
| Retail Sales — goal modal | [retail-sales-goal-modal-v1.html](retail-sales-goal-modal-v1.html) | `app/routes/app.retail-sales.tsx` (goal-setting modal) | — |
| Site rebrand — products | [site-rebrand-products-v2.html](site-rebrand-products-v2.html) | `site/src/pages/products.astro` (planned) | v1 is iteration history |
