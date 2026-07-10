# LP Tracking Brief — Primer Cachos LP — 2026-07-03

**For:** /integrations-engineer · **Producer:** /growth-hacker
**Do not wire until:** /product-developer build is complete AND growth-hacker has done the Phase 7F mobile/4G review.

## Scope
- Route: the Primer Cachos cold-traffic LP (`/pages/primer-cachos-definido`, final slug TBC).
- Events to wire:
  - Client-side (Meta Pixel + GA4): PageView, ViewContent, AddToCart, InitiateCheckout, Purchase.
  - Server-side (Meta CAPI): same events, with `event_id` deduplication against the Pixel.
- UTM passthrough: preserve all `utm_*` params from ad click through to checkout, and into Shopify order attribution (order tags / note). Convention: `utm_source=meta&utm_medium=paid&utm_campaign=<name>&utm_content=<ad-id>&utm_term=<audience>`.

## Verification (report back before launch)
- Events Manager shows PageView within 30s of load.
- Pixel + CAPI dedup confirmed (same event_id both sides) for Purchase.
- UTM params survive navigation LP → checkout.
- Shopify order carries the campaign attribution (so we can triangulate Meta vs server-side vs Shopify).

## Why this matters
This LP exists to fix ad→page message match; we can only prove it worked if landing→purchase is attributable. A new LP with broken tracking is a black hole for learning. Attribution triangle (Meta dashboard ↔ CAPI ↔ Shopify UTM) must agree within ~10% before any scale call.

## Out of scope
- Any event not listed. Any third-party analytics not requested here.
- The SEO PDP tracking (unchanged).
