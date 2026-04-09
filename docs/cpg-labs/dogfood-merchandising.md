# Dogfood Spec — Merchandising

> Generated from operational session on 2026-03-29. This spec captures manual
> findings and maps them to app enhancements a new agent can implement.

## Current App State

The Merchandising route (`app/routes/app.merchandising.tsx`) has three main sections:

### 1. Icons (Metaobject Manager)
- **Sidebar:** Dropdown to select a metaobject type → shows entries as checkboxes
- **Main area:** Selected entries displayed as cards with inline edit/create/delete
- **Data:** Uses `fetchMetaobjectTypes` from price-tags service, then fetches entries + field definitions per type
- **Actions:** `updateMetaobject`, `createMetaobject`, `deleteMetaobject`

### 2. Announcements (Theme Settings Scanner)
- **Scans** theme `config/settings_data.json` and storefront HTML via LLM (Claude Sonnet)
- **Outputs:** Promotional fields, conflicts between settings, and AI-generated recommendations
- **Groups** fields by section/purpose, shows recommendations sorted by priority with dismiss
- **Shows** active discounts summary (first 50, basic info only — no combinability, no pricing data)
- **Links** to theme editor and discounts page in Shopify admin
- **Caching:** 1-hour in-memory cache per shop, rescan button clears it

### 3. Header (same component as Announcements, scoped to header)
- Same `AnnouncementsSection` component with `focus: "header"`

### Services
- `theme.server.ts` — Fetches published theme, reads settings_data.json and settings_schema.json
- `promo-scanner.server.ts` — LLM-powered scan that cross-references storefront HTML, theme settings, and active discounts

### What's Missing (Gap Analysis)
The app currently has a solid theme-scanning foundation but lacks the **data-level merchandising audit** capabilities that the manual session revealed are critical:

1. **No product pricing analysis** — can't detect compareAtPrice drift, inconsistent discount percentages, or launch products excluded from campaigns
2. **No discount stacking detection** — fetches discounts but doesn't check `combinesWith` or calculate worst-case effective discounts
3. **No discount code hygiene** — can't surface stale codes, codes without end dates, or bulk-edit combinability/expiry
4. **No collection health check** — can't detect empty collections or tag-rule mismatches
5. **No badge assignment audit** — the Icons section manages metaobjects but doesn't show which products have/lack badge assignments
6. **No inventory alerts** — can't surface oversold products (negative inventory)
7. **Discount detail is shallow** — only fetches 50 discounts with title/summary, no combinability, no minimum requirements, no code details

---

## Enhancements

### 1. Discount Stacking Detector

**What it does:** Shows all active discounts with their combinability settings and flags dangerous combinations where multiple discounts can stack.

**Why:** During the audit, we discovered Kit Verão getting 31% off (23.5% baked into price + 10% automatic discount). We also found GEBEAUTY10 could combine with everything, and PRIMEIRACOMPRA20 stacking on top of baked-in 15% for 32% effective discount. None of this was visible in the current app.

**Data requirements:**

Query 1 — Automatic discounts with combinability:
```graphql
query AutomaticDiscounts {
  automaticDiscountNodes(first: 50, query: "status:active") {
    edges {
      node {
        id
        automaticDiscount {
          __typename
          ... on DiscountAutomaticBasic {
            title status startsAt endsAt
            minimumRequirement {
              ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity }
              ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount currencyCode } }
            }
            customerGets {
              items {
                ... on AllDiscountItems { allItems }
                ... on DiscountProducts { products(first: 5) { edges { node { title } } } }
                ... on DiscountCollections { collections(first: 5) { edges { node { title } } } }
              }
              value {
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount { amount { amount currencyCode } }
              }
            }
            combinesWith { orderDiscounts productDiscounts shippingDiscounts }
          }
          ... on DiscountAutomaticFreeShipping {
            title status startsAt endsAt
            minimumRequirement {
              ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount currencyCode } }
            }
            combinesWith { orderDiscounts productDiscounts shippingDiscounts }
          }
          ... on DiscountAutomaticBxgy {
            title status startsAt endsAt
            combinesWith { orderDiscounts productDiscounts shippingDiscounts }
          }
          ... on DiscountAutomaticApp {
            title status startsAt endsAt
            combinesWith { orderDiscounts productDiscounts shippingDiscounts }
            appDiscountType { title }
          }
        }
      }
    }
  }
}
```

Query 2 — Code discounts (paginated, first page):
```graphql
query CodeDiscounts($cursor: String) {
  codeDiscountNodes(first: 50, after: $cursor, query: "status:active") {
    edges {
      node {
        id
        codeDiscount {
          __typename
          ... on DiscountCodeBasic {
            title status startsAt endsAt
            codes(first: 1) { edges { node { code } } }
            customerGets {
              items {
                ... on AllDiscountItems { allItems }
                ... on DiscountCollections { collections(first: 3) { edges { node { title } } } }
              }
              value {
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount { amount { amount currencyCode } }
              }
            }
            combinesWith { orderDiscounts productDiscounts shippingDiscounts }
            usageLimit
          }
          ... on DiscountCodeFreeShipping {
            title status startsAt endsAt
            codes(first: 1) { edges { node { code } } }
            combinesWith { orderDiscounts productDiscounts shippingDiscounts }
          }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

**Detection logic:**
```
For each active discount D:
  1. Check D.combinesWith — if ALL three are true, flag as "combines with everything"
  2. For each OTHER active discount E where D and E could stack:
     - D is product discount + E is product discount + both combine with productDiscounts → FLAG
     - D is product discount targeting same products/collections as E → FLAG with worst-case %
  3. For products with baked-in compareAtPrice discount:
     - Calculate effective discount: 1 - (price / compareAtPrice)
     - If any automatic discount targets the same product → worst_case = 1 - ((1 - baked) * (1 - automatic))
     - If worst_case > campaign target (e.g., 15%) → FLAG
```

**UI spec:**
- Component type: Table within a new section block ("Discount Health")
- Location: Below Announcements section in main content area
- Columns: Discount name | Type (auto/code) | Value | Combines with (icons: O/P/S) | Targets | Risk level
- Risk badges: `critical` (>25% effective stacking), `warning` (any stacking), `info` (single discount, no issue)
- Expandable rows showing stacking detail for flagged discounts
- States: loading (skeleton table), empty ("No active discounts"), results, error banner

**Actions:**
```
- "Disable combinability" → discountCodeBasicUpdate with combinesWith: {all: false}
- "Deactivate" → discountCodeBasicUpdate with endsAt: now
- Links to Shopify admin discount page for each discount
```

**Edge cases:**
- `discountNodesCount` caps at 10,000 — for stores with 10k+ codes, show a warning
- BxGy discounts don't have the same combinability fields structure
- App-based discounts (DiscountAutomaticApp) have limited introspection

---

### 2. Price-Campaign Alignment Checker

**What it does:** Verifies that all products in a campaign collection have the correct discount percentage applied via compareAtPrice/price, and flags outliers.

**Why:** We found 3 kits with 23.5% off while everything else was 15%. Launch products had no discount at all. This required manually computing `1 - (price / compareAtPrice)` for every product and comparing against the target.

**Data requirements:**
```graphql
query ProductPricing($cursor: String) {
  products(first: 50, after: $cursor, query: "status:active") {
    edges {
      node {
        id title status tags
        variants(first: 5) {
          edges {
            node {
              title price compareAtPrice sku inventoryQuantity
            }
          }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

**Detection logic:**
```
1. Fetch all active products with variants
2. For each product, compute discount_pct = 1 - (price / compareAtPrice) for each variant
3. Group by effective discount percentage (round to nearest 0.5%)
4. Identify the dominant percentage (mode) — this is the campaign target
5. Flag products that deviate:
   - No compareAtPrice at all → "Not on sale" (check if lancto tag → info, otherwise warning)
   - discount_pct > campaign_target + 2% → "Deeper than campaign" (warning)
   - discount_pct < campaign_target - 2% → "Shallower than campaign" (warning)
   - discount_pct exactly matches → "Aligned" (pass)
6. Check if products with deeper discounts also have automatic discounts targeting them → double-discount risk
```

**UI spec:**
- Component type: Summary card + expandable table
- Location: New section block ("Pricing Health") below Discount Health
- Summary: "X products aligned at Y% off | Z outliers | W not on sale"
- Table columns: Product | Price | Compare-at | Effective % | Status (badge) | Tags
- Filter: dropdown to filter by status (aligned / deeper / shallower / not on sale)
- States: loading, no products, results

**Actions:**
- None initially (price changes are sensitive — link to Shopify product admin instead)

**Edge cases:**
- Products with multiple variants at different prices (show per-variant)
- compareAtPrice of null vs 0 (both mean "no sale")
- Pagination needed for 50+ active products

---

### 3. Stale Discount Cleanup

**What it does:** Surfaces discount codes with no end date that are older than a configurable threshold, and allows bulk deactivation.

**Why:** We found 25+ codes from 2024 still active — NAMORADOS50 (Valentine's Day), RETURN-# credits, AVULSO- one-offs. Manually identifying and expiring them took multiple queries. A merchant would never find these without an audit.

**Data requirements:**

Same code discounts query as Enhancement 1, plus:
```graphql
query StaleDiscountCount {
  discountNodesCount(query: "status:active") { count }
}
```

**Detection logic:**
```
1. Fetch active code discounts (paginated)
2. Filter where endsAt is null AND startsAt < (now - threshold_days)
3. Categorize by pattern:
   - RETURN-* → "Return credit" (likely one-time, should have expired)
   - *10, *15, *20 (name codes) → "Affiliate code" (intentionally permanent — info only)
   - Seasonal keywords (NAMORADOS, VERAO, NATAL, etc.) → "Seasonal" (should have expired)
   - AVULSO-* → "One-off" (should have expired)
4. Show count per category, flag seasonal + return + one-off as actionable
```

**UI spec:**
- Component type: Summary + grouped list with bulk actions
- Location: New section block ("Discount Hygiene") or tab within Discount Health
- Groups: "Return Credits (X)" | "Seasonal (X)" | "One-off (X)" | "Affiliate (X, permanent)"
- Each row: Code | Value | Created date | Age | Category badge
- Bulk action: "Expire selected" button → sets endsAt to now for all checked codes
- States: loading, clean ("No stale codes found"), results

**Actions:**
```
mutation ExpireDiscount($id: ID!) {
  discountCodeBasicUpdate(id: $id, basicCodeDiscount: { endsAt: "2026-03-29T00:00:00Z" }) {
    codeDiscountNode { codeDiscount { ... on DiscountCodeBasic { title status } } }
    userErrors { field message }
  }
}
```
Run in batch with progress tracking (same pattern as BEAUTYBACK update).

**Edge cases:**
- 10,000+ active codes — need pagination with sortKey: CREATED_AT
- Bulk mutations at ~2.5/sec — show progress bar for large batches
- Free shipping codes use `discountCodeFreeShippingUpdate`, not `discountCodeBasicUpdate`

---

### 4. Collection Health Check

**What it does:** Identifies collections with 0 products due to tag-rule mismatches, and collections with stale seasonal names.

**Why:** We found 2 empty collections ("Kits com desconto e frete grátis!" and "Finalização do seu jeito") that targeted tags no product had. These show up as dead pages on the storefront.

**Data requirements:**
```graphql
query Collections($cursor: String) {
  collections(first: 50, after: $cursor) {
    edges {
      node {
        id title handle
        productsCount { count }
        sortOrder
        ruleSet {
          appliedDisjunctively
          rules { column relation condition }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

**Detection logic:**
```
1. Fetch all collections with product counts and rules
2. Flag automated collections (has ruleSet) where productsCount.count == 0
   → "Empty automated collection — rule targets tags/types that no product matches"
3. For each empty automated collection, extract the tag conditions
4. Cross-reference with actual product tags to suggest fix:
   - "No products have tag 'X' — did you mean 'Y'?" (fuzzy match)
   - "Tag 'X' only exists on archived products"
5. Flag manual collections where productsCount.count == 0 as info
```

**UI spec:**
- Component type: Compact list within Pricing Health or standalone section
- Each row: Collection title | Product count | Type (auto/manual) | Status badge
- Status: empty=critical, <3 products=warning, healthy=hidden
- Actions: Link to Shopify collection editor, "Delete" button for empties

**Actions:**
```
mutation DeleteCollection($id: ID!) {
  collectionDelete(input: { id: $id }) {
    deletedCollectionId
    userErrors { field message }
  }
}
```

**Edge cases:**
- Manual collections with 0 products might be intentionally empty (staging) — show as info, not critical
- Some collections are used by apps (EasyGift) — flag but don't auto-delete

---

### 5. Badge Assignment Audit

**What it does:** Shows which etiqueta (badge label) metaobjects exist and how many products have each one assigned, highlighting unused badges.

**Why:** We found 20 etiqueta badges defined but 0 assigned to any product. The Icons section already manages these metaobjects but doesn't show assignment coverage.

**Data requirements:**

Step 1 — Fetch badge metaobjects (already available in Icons section):
```graphql
query BadgeMetaobjects {
  metaobjects(type: "etiqueta", first: 50) {
    nodes { id handle displayName fields { key value } }
  }
}
```

Step 2 — For each badge, count products referencing it:
```graphql
query ProductsWithBadge($metaobjectId: String!) {
  products(first: 1, query: "status:active") {
    edges {
      node {
        metafield(namespace: "custom", key: "etiqueta") { value }
      }
    }
  }
}
```

Note: Shopify doesn't support filtering products by metafield value in the query parameter. Alternative approach: fetch all active products with the etiqueta metafield and count client-side.

```graphql
query ProductBadges($cursor: String) {
  products(first: 50, after: $cursor, query: "status:active") {
    edges {
      node {
        id title
        metafield(namespace: "custom", key: "etiqueta") { value }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

**Detection logic:**
```
1. Fetch all etiqueta metaobjects → badge_list
2. Fetch all active products with custom.etiqueta metafield
3. For each badge, count how many products reference its GID
4. Flag badges with 0 assignments as "unused"
5. Show coverage: "X of Y badges assigned to at least one product"
```

**UI spec:**
- Component type: Enhancement to existing Icons section — add "coverage" column when viewing etiqueta type
- Or: standalone summary card in a new "Badges" section
- Each row: Badge name | Color preview | Products assigned | Status (used/unused)
- Action: "Assign to products" → link to Shopify product admin (bulk metafield editing is complex)

**Edge cases:**
- Metafield value is a GID reference string — parse to match metaobject IDs
- Some badges are seasonal and intentionally unassigned between campaigns — show as info not warning

---

### 6. Inventory Alerts

**What it does:** Surfaces active products with negative inventory (oversold) or zero inventory.

**Why:** We found 4 products at negative inventory (primers and antifrizz kits at -8 and -4). These cause fulfillment issues.

**Data requirements:**

Already fetched in Enhancement 2 (ProductPricing query includes `inventoryQuantity`).

**Detection logic:**
```
1. From product data, filter variants where inventoryQuantity < 0 → "Oversold"
2. Filter variants where inventoryQuantity == 0 → "Out of stock" (info)
3. Show as alerts sorted by severity (negative first)
```

**UI spec:**
- Component type: Alert banner at top of page (for critical oversold) + detail table
- Location: Top of page (banner) + within Pricing Health section
- Banner: "X products are oversold" with expandable list
- Table: Product | Variant | SKU | Inventory | Status badge

**Actions:**
- Link to Shopify inventory page per product

**Edge cases:**
- Products with inventory tracking disabled won't have meaningful quantities
- Gift cards and digital products always show 0 — exclude by product type

---

## Shared Patterns

### Pagination Strategy
- Always use `sortKey: ID` or `sortKey: CREATED_AT` for stable cursor-based pagination
- Shopify's default sort without a sortKey returns inconsistent subsets across paginated requests
- For counts above 10,000, `discountNodesCount` caps — paginate and count manually

### Rate Limiting
- Shopify GraphQL uses cost-based throttle: 4000 points max, 200/s restore
- Check `extensions.cost.throttleStatus.currentlyAvailable` on every response
- For bulk mutations (stale discount cleanup): expect ~2.5 mutations/sec sustained
- Show progress bar with ETA for any operation touching 100+ items

### Caching
- Extend existing `promo-scanner.server.ts` cache pattern: per-shop in-memory Map with TTL
- Product/discount data should cache for 5 minutes (shorter than theme scan's 60 min)
- "Rescan" button should clear all caches, not just theme scan

### Error Handling
- Missing scopes: show specific banner per missing scope (e.g., "Grant read_discounts to enable discount analysis")
- API failures: catch per-section, show section-level error banner, don't block other sections
- Partial data: if pagination times out, show what was fetched with "showing X of Y+" warning

### UI Components
- Follow CLAUDE.md patterns: Polaris web components, CSS modules, right-aligned buttons
- Use `s-badge` with tones: `critical` (red), `warning` (yellow), `success` (green), `info` (blue)
- Tables: no zebra striping, header `#f6f6f7`, row borders `1px solid #f1f1f1`, hover `#f6f6f7`
- Expandable rows for detail: click row → toggle detail panel below

---

## Implementation Order

1. **Price-Campaign Alignment Checker** — effort: medium — Most impactful, uses data already available via simple product queries. Gives the merchant the "are my prices correct?" answer. No mutations needed.

2. **Discount Stacking Detector** — effort: medium — Second highest impact, builds on the discount data the app already partially fetches. Extends the existing `fetchActiveDiscounts` function with combinability fields.

3. **Collection Health Check** — effort: small — Simple query + count check. Quick win.

4. **Stale Discount Cleanup** — effort: medium — Needs pagination for large code sets + bulk mutation with progress tracking. Reuse `update_beautyback_combines.py` pattern but in TypeScript.

5. **Badge Assignment Audit** — effort: small — Extends existing Icons section. Mostly a loader enhancement + small UI addition.

6. **Inventory Alerts** — effort: small — Data already fetched by Enhancement 1. Just add a filter and display component.

---

## Queries Reference

All queries used in this spec are validated against the Shopify Admin API 2026-01. Key gotchas:

1. **DiscountAutomaticBxgy** — `customerBuys.value` is a union type `DiscountCustomerBuysValue` that needs `{ ... on DiscountQuantity { quantity } }` — do NOT select `quantity` directly on the union.

2. **`discountNodesCount`** — caps at 10,000 by default. Pass `limit: 100000` to raise the cap, but it may still return 10,000 for very large sets.

3. **Product metafield queries** — `metafield(namespace: "custom", key: "etiqueta")` returns the raw value (a GID string like `gid://shopify/Metaobject/123`). You cannot filter products by metafield value in the GraphQL `query` parameter.

4. **Theme assets** — Use REST API (`GET /admin/api/2026-01/themes/{id}/assets.json?asset[key]=...`), not GraphQL. The GraphQL `OnlineStoreTheme` type doesn't expose asset content.

5. **Code discount pagination** — Use `codeDiscountNodes` (not `discountNodes`) with `sortKey: CREATED_AT` for stable traversal. The generic `discountNodes` mixes automatic and code discounts with less predictable ordering.
