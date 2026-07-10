# Shopify Performance Leverage Matrix (Reusable Playbook)

A tenant-agnostic catalogue of Shopify **platform** features that move website performance on two axes ranked together:

- **Speed / technical** (Core Web Vitals: LCP, CLS, INP; Lighthouse; page weight; render path)
- **Conversion / revenue-per-visitor** (discovery, merchandising, AOV mechanics, checkout completion, LTV)

Grounded in the Shopify Dev MCP docs (API version 2026-04). Built for any Shopify store; adjust the per-feature applicability to the store's catalog size, plan tier, and market. The first run was for a Brazilian DTC beauty brand, so a few examples use that lens — they are labelled.

> How to use this: clone the matrix, run a live audit of the target store (storefront HTML + PageSpeed Insights + Admin API config), mark each row present / partial / missing, then sequence the missing high-leverage items by tier. A companion audit produces the present-vs-missing list; this file is the scoring reference.

---

## Operating principles (the scoring lens)

1. **Speed is a paid-media moat, not a vanity score.** Mobile LCP drives Google Ads Quality Score (CPC) and landing-page CVR. Cheap speed wins pay back in ad efficiency before they pay in conversion.
2. **Localize the checkout to the market's dominant payment rail.** Surfacing the right payment method first (e.g. Pix in Brazil, iDEAL in NL, OXXO in MX) is often the single highest checkout-completion lever in a given geography. Done with a Payment Customization Function, no Plus required.
3. **Downstream of the click, social proof and AOV mechanics compound hardest** in considered-purchase verticals (beauty, supplements, apparel): reviews, complementary recommendations, bundles.
4. **Match effort to catalog scale.** Faceted search, headless re-platforms, and heavy merchandising tooling rarely pay off under ~30 SKUs. Image/CDN and payment levers pay off at any scale.

Legend - **Impact:** H/M/L · **Axis:** Speed / Conversion(AOV) / LTV / SEO · **Effort:** S = hours/toggle, M = days, L = 1-2 wks dev, XL = months/re-platform · **Plus** = requires Shopify Plus.

---

## Tier 0 - Quick wins (S effort, real return). Ship first.

| Feature | Axis | Impact | Effort | Who | Notes |
|---|---|---|---|---|---|
| `image_url`+`image_tag` responsive images (CDN resize, srcset, baked width/height) | Speed | H | S | Theme dev | LCP + CLS fix. Oversized images are the #1 page-weight cause. Replace deprecated `img_url`/`img_tag`. |
| `preload_tag` / `image_tag preload` on the hero | Speed | H | S | Theme dev | 200-500ms LCP saved on the exact LCP element. Hero only; use sparingly. |
| Automatic lazy-loading via `image_tag` (below-fold) | Speed | H | S | Theme dev | Free if theme uses `image_tag`; defers the bulk of image bytes. |
| CSS stylesheet subsetting (`{% stylesheet %}`) | Speed | H | S* | Theme dev | 2026 platform change: only render-tree CSS ships per page. *Free on Dawn-style themes; refactor if CSS lives in `assets/`. |
| Auto JS/CSS minification | Speed | M | S | Platform | Free; just do not pre-minify theme files (blocks it). |
| `defer`/`async` non-critical JS + app-embed audit | Speed | M-H | S-M | Theme dev | App `<script>` injections are the main INP killers. Audit legacy ScriptTag vs per-page app embed blocks. |
| Theme Check in CI | Speed | M (prevent) | S | CI | Catches big bundles, parser-blocking JS, pagination >50 before deploy. |
| `structured_data` filter (rich snippets) | SEO/Conv | M | S | Theme dev | JSON-LD product schema -> price/availability (and stars once reviews wired) in Google results. |
| Discount API `combinesWith` (stack rules) | Conversion | H | S | Merchant/app | Lets free-shipping + campaign discounts stack cleanly. Native, all plans. |
| Search & Discovery: synonyms + boosts | Conversion | M | S | Merchant | Map local-language slang to products. Near-zero cost. |
| Shop Pay + Apple/Google Pay accelerated buttons | Conversion | M | S | Merchant | Toggle on PDP/cart. Lift scales with regional Shop Pay adoption. |

## Tier 1 - High-leverage builds (M effort, H impact). Next 1-4 weeks.

| Feature | Axis | Impact | Effort | Who | Notes |
|---|---|---|---|---|---|
| Payment Customization Function - dominant local rail to top | Conversion | H | M | Functions dev | Reorder/hide payment methods by cart. No Plus. Highest checkout-completion lever per geography. |
| Product reviews (standard `product_review` metaobject + Shop syndication) | Conv/SEO | H | M-L | App install | Top trust lever in considered-purchase verticals. Feeds star ratings into `structured_data`. Approved app = M; custom = L. |
| Product Recommendations - `COMPLEMENTARY` | Conversion | H | M | Merchant + theme | Hand-curated pairings via Search & Discovery. Highest-precision AOV signal pre-cart. |
| Native fixed bundles (`ProductVariantComponent`) | Conversion | H | M | Merchant + theme | One SKU, one line item, auto inventory. Proven AOV move. |
| Product media: video on PDP | Conversion | H | M | Theme + content | Highest-converting PDP element in texture/visual verticals. Render the `media` connection, not just `featured_image`. |
| Checkout UI extensions: trust badges + custom fields | Conversion | H | M | App dev | Payment-step placement is **Plus**-only; order-summary/block targets work on all plans. |
| Thank-you page extensions | LTV | M-H | M | App dev | Zero-friction enrollment (loyalty/referral) + per-SKU review prompts. No Plus on thank-you targets. |
| Predictive Search (instant autocomplete) | Speed/Conv | M | M | Theme dev | Often already in Dawn. Helps off-PDP paid landings. Medium value at small catalogs. |
| Product Recommendations - `RELATED` (auto) | Conversion | M | S-M | Theme dev | Zero-config "you may also like." Free AOV surface. |
| Rich variant picker (`adjacentVariants`, gray-out OOS) | Conversion | M | M | Theme dev | Only matters for SKUs with variants; removes silent add-to-cart failures. |

## Tier 2 - Strategic builds (L effort, H impact). Plan and schedule.

| Feature | Axis | Impact | Effort | Who | Notes |
|---|---|---|---|---|---|
| Metaobjects/metafields -> rich PDP (ingredients, how-to, certs) | Conversion | H | L | App+content+theme | Trust + info density. Schema design + content entry. |
| Quiz/segment-driven PDP personalization | Conversion | H | L | App+theme+content | Stitch a discovery quiz answer into the PDP (segment-specific hero/content). Depends on the metaobject layer. |
| Discount Function - tiered/volume | Conversion | H | M-L | Functions dev | Beats flat promos for AOV; no Plus; merchant-tunable via app metafields. Up to 25 functions/store. |
| Cart Transform Function - bundle expansion | Conversion | H | L | Functions dev | Use when native fixed bundles are not flexible enough (transparent component pricing in cart). |
| Subscriptions / selling plans | LTV | H | L | App | Replenishable SKUs. Native Subscriptions app reduces effort. Back up contracts (records purged 48h after app uninstall). |
| Section Rendering API (cart/variant partial updates) | Speed/Conv | M | M | Theme dev | Kills full-page reloads on cart/variant/filter -> better INP + perceived speed. |
| File transformation / critical-CSS inlining | Speed | M-H | L | Theme/agency | Removes a render-blocking round-trip. Only after Tier 0 image/CSS if Lighthouse FCP still soft. |
| Delivery Customization + Local Pickup/Pickup-Point generators | Conversion | M | M-L | Functions dev | Surface local/same-day options + lockers; cuts shipping-cost abandonment. |
| Cart & Checkout Validation Function | Conversion | M | M-L | Functions dev | Flash-sale quantity caps, enforce launch-exclusions at checkout. Margin protection. |

## Tier 3 - Defer / plan-gated / structural.

| Feature | Axis | Impact | Effort | Notes |
|---|---|---|---|---|
| Checkout Branding API | Conversion | M | S-M | **Plus**-gated. ~2-5% completion lift. |
| Markets - international pricing/localization/local pay | Conversion | M now / H on expansion | M->XL | Basic config is M; full multi-country w/ pricing + duties is XL. |
| B2B (company accounts, catalogs, price lists) | Conversion | M | XL | **Plus**-gated. Self-serve wholesale. |
| Faceted/filtered collection search | Conversion | L (small cat) | S-M | Low value under ~30 SKUs; revisit as catalog grows. |
| Fulfillment Constraints Function | Conversion | L (single depot) | M | Matters when fulfillment goes multi-location. |
| Storefront Web Components | Conversion | L-M | S-M | Mostly a headless/custom-surface accelerant. |
| Hydrogen + Oxygen (headless, edge SSR) | Speed | H (ceiling) | XL | Theoretical perf ceiling but a full re-platform. Tier 0 image work captures most realizable speed at 1/100th the cost. Not justified at small catalogs. |

---

## Impact x Effort map

```
        LOW EFFORT (S)                  HIGH EFFORT (L / XL)
  H  +--------------------------+------------------------------+
  I  | * image/preload/lazy     | Metaobject rich PDP          |
  G  | * CSS subsetting         | Quiz/segment PDP personalize |
  H  | * Discount combinesWith  | Tiered Discount Function     |
     | Local-rail payment (M) --| Cart Transform bundles       |
  I  | Complementary recs (M)   | Subscriptions                |
  M  | Reviews (M) Bundles (M)  | -- B2B / Markets-intl / --   |
  P  | Video PDP (M)            |    Hydrogen+Oxygen (XL,defer) |
  A  +--------------------------+------------------------------+
  C  | structured_data synonyms | File transform/critical CSS  |
  T  | Shop Pay  Theme Check    | Section Rendering API         |
  L  | (do because cheap)       | Delivery/pickup functions    |
     +--------------------------+------------------------------+
  * = top-left: do immediately. (M)-tagged items sit mid-effort but earn their place.
```

**Default sequence:** Tier 0 speed pack + cheap conversion toggles (week 1) -> local-rail payment function + reviews + complementary recs + bundles + PDP video (weeks 2-4) -> metaobject/segment-PDP + subscriptions + tiered discounts (quarter) -> Plus-gated and international items when the business case triggers.

---

## Caveats / known doc gaps

- Markets, Shop Pay Installments, and font-loading specifics returned thin/empty from the Dev MCP and lean partly on general knowledge. Everything else is grounded in 2026-04 docs.
- Plan gating is real spend: Checkout Branding, B2B, and in-checkout (payment-step) extensions need Shopify Plus. Everything in Tier 0/1 except those works on standard plans.
- This is a capability reference, not a store audit. Always check present-vs-missing against the live store before sequencing.

_Source: synthesized from the Shopify Dev MCP (2026-04) via a three-way funnel-stage survey (speed/CWV, pre-cart discovery, cart-to-LTV). Scoring lens: paid-acquisition growth operator._
