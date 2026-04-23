# CPG Labs — Project Brief

> Use this document as context when discussing the project on mobile or with anyone unfamiliar with the codebase. It describes what the product does, how it works, and where things stand — written for planning conversations, not for coding.

---

## What Is CPG Labs?

CPG Labs is a **Shopify embedded app** built for consumer packaged goods (CPG) brands selling through Shopify. It lives inside the Shopify Admin and helps merchants with **local delivery logistics, retail expansion analytics, product merchandising, and AI content generation**.

The app is deployed at `omnify.cpg-labs.io` and runs on AWS (ECS Fargate + RDS PostgreSQL). It's built with React Router v7, TypeScript, Prisma, Google Maps, and Shopify's Polaris design system.

### Multi-App Architecture

The same codebase powers multiple focused Shopify apps via an `APP_IDENTITY` environment variable:

| Identity | Target Merchant | Features Enabled |
|----------|----------------|------------------|
| **CPG Labs** (default) | Internal / power users | Everything |
| **Omnify** | Delivery-focused brands | Local Delivery, Retail Footprint, Retail Sales, Carrier Service, Settings |
| **Storefront** | Product merchandising & content | Price Tags, Merchandising, Story-telling (Blog Generation, Brand Settings, Alt Text) |

Each identity has its own Shopify app credentials, deploy script, and scoped navigation. This lets us publish focused apps to the Shopify App Store while keeping the full CPG Labs running for our production store. Story-telling features are being merged into the Storefront app.

---

## Features

### 1. Local Delivery (flagship feature)

**What it does:** Manages same-day and next-day local deliveries using Lalamove as the carrier. Merchants see their pending orders on a map, group them into optimized routes, request drivers, and track deliveries — all from inside Shopify Admin.

**How it works:**
- When a local delivery order comes in, a webhook auto-assigns it to the best route using Google Routes API (distance optimization, topological sorting, or cost-based Lalamove quotation).
- The merchant sees orders as color-coded pins on an interactive Google Map, with route polylines showing distance and estimated duration.
- Each route has a card showing its orders, total distance, and estimated cost. The merchant can drag orders between routes or let the optimizer rebalance.
- Clicking "Request Driver" sends a quotation request to Lalamove, then places the order. The driver's real-time status flows back via webhooks (assigning → picked up → in transit → delivered).
- Lalamove supports 11 markets (Brazil, Singapore, Hong Kong, etc.) with city-specific service types (motorcycle, van, truck) and special requests.

**Key capabilities:**
- Multi-stop route optimization (up to ~10 orders per route)
- Per-location Lalamove configuration (market, city, service type, pickup address)
- Auto-escalation: if no driver accepts within 60 minutes, the system can re-request
- Return pickup support (reverse logistics)
- Filters by location, date, delivery promise, and presale tags
- Order tagging in Shopify based on delivery status

**Current state:** Production-ready and actively used. Ongoing work includes route card restyling, driver-requested status tracking, and fixing a 422 error for Recife orders (special request mismatch).

---

### 2. Retail Sales (formerly Sales Goals / Retail Goals)

**What it does:** Lets merchants set monthly sales targets per location and track actual performance against those targets, with variance analysis and trend charts.

**How it works:**
- Merchant picks a location and month, sets a revenue target, and optionally selects a base period (previous month or previous year) to auto-calculate growth rate.
- Dashboard shows actual vs. goal with color-coded variance (green = on track, red = behind).
- KPI charts show revenue, order count, and AOV trends over time.
- Locations can be ranked by performance.
- Per-location filters let merchants scope tracking to specific sales channels, order tags, or shipping methods.

**Current state:** Fully functional with multi-tab layout (Dashboard, Goals, KPIs, Ranking, Settings).

---

### 3. Retail Footprint (formerly Retail Expansion)

**What it does:** Helps brands analyze where to open new physical retail locations by visualizing customer and order density on a heatmap, scoring candidate locations, and managing leasing proposals.

**How it works:**
- Syncs all customers and orders from Shopify (paginated, handles API throttling) and caches their geographic data.
- Renders a Google Maps heatmap showing where customers are concentrated — weighted by orders, revenue, or customer count.
- Merchants create "location sets" of candidate sites and score them by proximity to existing customers (5km/10km/15km radius analysis) plus qualitative criteria (audience type, tenant mix, subjective fit).
- Each candidate location can have a proposal attached with leasing value, currency, notes, and PDF documents.
- City-level geocoding fallback: if a customer has no precise coordinates but has a city name, the system geocodes the city and uses its centroid.

**Current state:** Fully functional. Complex feature (~151KB route file) with analytics caching, heatmap rendering, and proposal management.

---

### 4. Price Tags (Discount Automation)

**What it does:** Automatically assigns discount labels to products based on price tiers, using Shopify metaobjects as the label system.

**How it works:**
- Merchant configures which metaobject type represents "discount labels" and maps its fields.
- Creates tier rules: e.g., products over $50 get the "Premium" label, products over $100 get "Bestseller."
- When a product is updated (via webhook), the system checks its price against the tier rules and assigns the matching metaobject as a metafield on the product.
- Setup page auto-discovers the product metafield that references the metaobject type — no manual configuration needed.

**Current state:** Functional with setup + tier management. Webhook-driven auto-sync working.

---

### 5. Merchandising

**What it does:** Manages theme promotional settings and metaobject icon galleries for Shopify storefronts.

**How it works:**
- **Icons Gallery:** Browse all metaobject types in the shop, view their entries as thumbnails, edit field values inline.
- **Announcements:** Scans the published theme's settings for promotional fields (announcement bar text, header promos), detects conflicts across sections, and suggests consolidation. Uses AI (Claude API) to identify promo-related fields in the theme schema.

**Current state:** Functional. Theme integration and AI-powered conflict detection working.

---

### 6. Story-telling (AI Blog Generation)

**What it does:** Generates SEO-optimized blog posts aligned with the brand's voice and product catalog.

**How it works:**
- Merchant first sets up their brand identity: name, tagline, tone of voice, content language, editorial guidelines, and competitor benchmarks (Brand Settings page).
- To create a post, they write a content brief: pick a topic/keyword, select products to feature, choose a template.
- The brief + brand context is sent to an external Content Gen API which returns a generated draft.
- Merchant reviews, edits metadata (title, description, keywords), and publishes.

**Current state:** Functional end-to-end. Brand Settings form complete, brief-to-generation flow integrated.

---

### 7. Goals (Product Launch Tracker)

**What it does:** Tracks product launch KPIs (Day 1, Week 1, Month 1 performance) against benchmarks from previous launches.

**How it works:**
- Merchant defines a launch: target product, launch date, revenue + units goals for Day 1/Week 1/Month 1.
- Can set benchmark products (previous launches) for comparison.
- Segments by tag, location, or sales channel with independent goals.
- Dashboard shows daily trends, summary cards, top products, segment breakdowns, and benchmark comparison.

**Current state:** Fully functional.

---

### 8. Carrier Service

**What it does:** Registers a Shopify Carrier Service so the app can provide real-time shipping rates at checkout.

**How it works:**
- Merchant enables the carrier service, which creates a webhook-based rate calculator in Shopify.
- Configures distance zones (radius or postal code based), time rules (same day, next day), and enabled providers.
- When a customer checks out, Shopify sends a rate request to the app, which calculates delivery cost based on the configured zones and cached Lalamove rate samples.
- Currently supports Lalamove; Loggi, Uber, and Rappi are placeholder providers.

**Current state:** Functional for Lalamove. Multi-provider support planned.

---

### 9. Settings

**What it does:** Central configuration for delivery locations and Lalamove credentials.

**How it works:**
- Tab-based view per Shopify location.
- For each location: select Lalamove market and city, service type, pickup address/phone/instructions.
- Auto-geocodes the Shopify location coordinates for use in route optimization.
- Encrypted storage of Lalamove API credentials.

**Current state:** Fully functional.

---

## Integrations

### Lalamove (Primary Carrier)
- REST API v3 with HMAC-SHA256 authentication
- 11 markets across Asia, Latin America, and Japan
- Flow: Quotation → Order → Status webhooks → Shopify fulfillment updates
- City-specific service types and special requests (varies within the same market)
- 60-minute driver assignment escalation logic

### Google Maps & Routes
- Maps JavaScript API for interactive maps (delivery routes, retail heatmaps)
- Routes API for distance/duration optimization and route polylines
- Geocoding API for address-to-coordinate resolution
- City-level geocoding fallback for imprecise records

### Shopify
- Embedded app using Shopify App Bridge
- GraphQL Admin API for orders, customers, products, locations, metaobjects, fulfillments
- Webhooks for orders, customers, products, and app lifecycle
- Carrier Service API for checkout rate calculation
- Polaris web components for native Admin look and feel

### External APIs
- Content Gen API for AI content generation
- Claude API for theme settings analysis (merchandising)

---

## Infrastructure

- **Hosting:** AWS ECS Fargate (us-east-1) behind Application Load Balancer
- **Database:** AWS RDS PostgreSQL (Prisma ORM)
- **Secrets:** AWS SSM Parameter Store (`/omnify/` prefix)
- **Build:** Vite + React Router v7, Docker container
- **Deploy:** PowerShell scripts per app identity (`deploy-cpg-labs.ps1`, `deploy-omnify.ps1`, etc.)
- **Monitoring:** Structured console logs → AWS CloudWatch (`/ecs/omnify-gebeauty`)

---

## Current Initiatives

This section tracks work that is actively in progress or recently landed. Keep it current — stale initiatives mislead planning conversations. See "Keeping docs/project-brief.md Updated" in `CLAUDE.md` for the update protocol.

### Recently shipped

**CPG Labs corporate landing + Omnify screencast redesign** *(2026-04-23)*
Public-facing sites refreshed for publisher-trust positioning ahead of Shopify App Review. The dev-shop lead-gen pitch at `cpg-labs.io` / `www.cpg-labs.io` root replaced by a company-first corporate landing (`app/routes/_index/cpglabs-corporate.tsx`): "For brands dissolving barriers between online and retail", two products showcased (Omnify live with a synthetic Shopify-admin screenshot rendered in pure HTML/CSS, Storefront coming soon with a holographic waitlist mailto), FMCG + omnichannel + Shopify ICP framing, trust-by-implication About copy (no self-claims about "solid/secure" — the reader infers it). Omnify screencast at `omnify.cpg-labs.io/screencast` rebranded with the same visual language (dark-first, holographic gradient video frame, tree logo with float animation). Bare `omnify.cpg-labs.io/` 301-redirects to `cpg-labs.io/` in production to consolidate publisher identity on one hostname (OmnifyHome kept in tree but unrouted; planned for a follow-up product-marketing redesign per `inputs/mockups/omnify-home-v1.html`). Existing `cpglabs-home.tsx` (dev-shop pitch) also kept in tree but unrouted. Mobile-first CSS throughout, WCAG AA contrast, `prefers-reduced-motion` respected. Mockup iteration: `inputs/mockups/cpglabs-landing-v1.html` → `v2.html` → `v3.html` (canonical).

**Omnify App Store submission prep** *(2026-04-22 → 2026-04-23)*
First-pass Shopify App Store submission ready for the Omnify focused app (client_id `68903b97...`). Logo swapped to `omnify_tree.png` across screencast, about, and marketing-site nav. OAuth redirect URL fixed in `shopify.app.omnify.toml` (`/api/auth` → `/auth`, matching the code's `authPathPrefix`). Scope set trimmed 16 → 9 (dropped unused `read_publications`, `read/write_content`, `read/write_metaobjects`, `read/write_metaobject_definitions`). Privacy policy feature list narrowed to match Omnify's actual `APP_IDENTITY` surface (Local Delivery, Retail Sales, Footprint Expansion, Affiliates, Carrier Service, Analytics — no Storytelling, no Sales). In-app copy softened: "best" → "high-potential"/"rank" in home + retail-expansion i18n (EN + pt-BR). Shopify config pushed twice via `shopify app deploy --config shopify.app.omnify.toml --force` (`omnify-5` for the OAuth fix, `omnify-6` for scope trim + compliance copy). `/shopify-submission compliance-audit` clean post-changes; cold-install verified on `ge-beauty-test` dev shop without redirect errors.

**Local Delivery — mobile-only parallel route** *(2026-04-21)*
`/app/local-delivery-mobile` is a parallel mobile-first route that reuses the desktop loader + action via `export { loader, action, headers } from "./app.local-delivery"` — zero server duplication. Desktop route auto-redirects clients with `innerWidth<768` on mount (`?desktop=1` escape hatch). In-scope on mobile: Optimize (same `optimize-fleet` intent as desktop's "Auto Assign" menu), Request quote, Request driver, Cancel delivery, Clear route/all, live tracking (15 s poll + visibility-pause), plus triage sheets for Address errors and Shipment requests that deep-link to the Shopify admin (works on mobile admin). Out of scope: manual tweaking (no add-to-route, unassign, reorder, or drag), map style editing, Lalamove settings editing, special requests editing, return pickup flow — surfaced as "open on desktop ↗" chips. Single `<BottomSheet>` primitive (10 sheet instances), NOT `<s-modal>` — App Bridge overlay spilled past the iframe on narrow viewports, same bug class as the desktop fullscreen-map overlay that killed prior responsive attempts. Mockup at `inputs/mockups/local-delivery-mobile-v1.html`. No nav link — mobile URL is reached only via the redirect or direct URL.

**Retail sales — Goals tab → Manage goals modal** *(2026-04-17)*
Goals tab removed from Retail sales (tabs collapsed from 3 → 2: Dashboard · Campaigns). The per-location goal-setting UI now lives inside a Polaris `<s-modal>` (`#manage-goals-modal`) opened by a primary **Manage goals** button in the Dashboard's overview-strip header. Goals are set roughly once a month, so a tab-level surface was wasted real estate; a modal keeps the user anchored on the dashboard they came to see. Convention drift cleaned up in the same pass: legacy `.controlsRow`/`.controlsLeft`/`.controlsRight` CSS deleted (Goals tab was the only consumer), Month select migrated to the external-label filter pattern (`.filterControl` + `.filterLabel` + `labelAccessibilityVisibility="exclusive"`), Apply-growth-to-all packed into the same row as the Month filter, native `<select>`/`<option>` in both the per-card edit form and the bulk modal swapped for `<s-select>`/`<s-option>`, and Cancel buttons changed from non-existent `variant="tertiary"` to `variant="secondary"`. `goalsMonth` state persists across modal open/close for multi-month planning sessions. Logging follows the convention: `[sales-goals:ui] manage-goals modal opened/closed`.

**Retail sales — dashboard polish + rename** *(2026-04-16)*
Renamed Retail goals → **Retail sales** across all routes (`/app/retail-sales`), nav, i18n, settings. Dashboard cards reordered (Revenue → Orders → AOV), Total Revenue delta changed to vs pro-rated MTD goal, AOV/Orders primary delta changed to literal YoY, Same-store YoY card colorized + top-grower row added, Best-vs-worst card copy rewritten for clarity. Drilldown charts restyled: navy subdued active-card highlight, PY bars rounded, goal-line labelled, legend moved to bottom center, Revenue+Orders bars use split gradient (solid MTD → fading projection), Same-store YoY uses dynamic baseline (all-positive → bottom; all-negative → top; mixed → center), Best-vs-worst uses 3-tier colors (green/yellow/red at 90/60 thresholds). Breakdown table retitled "Revenue breakdown by location", headers shortened to MTD/Projected. Polaris `<s-icon>` replaces Unicode info icons.

**Omnify reorg — unified per-location Settings + feature renames** *(2026-04-15)*
Prep for standalone App Store launch. Feature renames (English): Sales Goals → Retail goals → now **Retail sales**; Retail Footprint → **Footprint expansion**; Settings tab "Providers" → **Delivery providers**; "Location settings" card → **Delivery details**. Settings > Locations tab is unified per-location page with two sibling collapsibles: **Delivery details** and **Retail sales** filters.

**Sales Goals revamp** *(2026-04-14)*
Full rebuild. Architecture moves from "fetch every order from Shopify on every page load" to a background-sync + pre-aggregated Postgres model — three new tables (`SalesOrder`, `SalesOrderMonthly`, `SalesGoalsSyncMeta`), dual-write via order webhooks, paginated backfill mirroring the Retail Footprint pattern. POS-only attribution: `-source_name:web` at query time, `sourceName==="pos"` routes by `physicalLocation` (Shopify POS), `sourceName==="206755758081"` routes by tag match (legacy IGLU POS). Orders for closed stores (e.g. Iguatemi Fortaleza) are accepted-drop. Warehouses hidden everywhere via `localPickupSettingsV2` filter. UI collapsed from 5 tabs → 3 (Dashboard, Goals, Settings). Dashboard adds KPI cards with YoY/MoM deltas, per-location breakdown with progress bars and 13-month sparklines, month + comparison-period pickers, "Sync now" button. Goals tab redesigned as per-location cards with inline edit form, live projected-goal preview, and bulk "Apply growth to all" modal. Settings simplified to retail-only locations with order-sources and tags filters. Motivated by multi-POS migration (IGLU → Shopify POS): the business needs combined per-location sales regardless of POS system, and a 61s Shopify loader was on the edge of the ALB 504 threshold.

**Auto-delivery pipeline** *(2026-04-08)*
Local Delivery refactored from manual to fully automatic. A cron auto-assigns orders to routes after a configurable cutoff + delay, auto-dispatches Lalamove orders at a configured time, archives route tags on completion (e.g. `ld_rota-03` → `ld_rota-03_26.04.08`), and has a watchdog that clears stuck tags after a retry cutoff so orders re-enter the pool next day. Opt-in per location via `autoDeliveryEnabled`. The app no longer creates Shopify fulfillments — delivery status is tracked only via order tags and the app database.

**Route optimizer tuning** *(2026-04-09)*
12km max-spread constraint added to the VRP optimizer in `carrier-quotation-optimizer.server.ts`. Routes exceeding 12km haversine spread between any two orders now get split via 2-means bisection, enforced at four pipeline stages. Solo routes are allowed for geographically isolated orders. Derived from correction data showing 70% of dispatches were being manually split by the user.

**Retail Footprint analytics — Phase 2** *(normalized tables)*
Migrated the Retail Footprint data layer from a monolithic JSON blob to normalized Prisma tables (`RetailOrder`, `RetailCustomer`, `RetailCityMonthly`, `RetailHeatmapBucket`, `RetailSyncMeta`). Dual-write sync uses bulk `INSERT ... ON CONFLICT DO UPDATE` via raw SQL (~100x faster than per-row upserts). Required because the pilot store has 110k combined records and the old JSON approach caused OOM on write.

### In progress

**Campaign goals — time-bounded pushes with product criteria**
Extends Retail sales with a campaign engine for time-bounded sales pushes (Mother's Day, Father's Day, Black Friday, brand launches, slow-inventory pushes). Per-campaign record of `(name, date range, match rule, per-location targets)` stored in new `CampaignGoal` / `CampaignGoalTarget` / `CampaignOrderMatch` Prisma models. Orders get evaluated against every active campaign's match rule via the existing order webhook (line items fetched on-demand via Shopify GraphQL, only for orders inside an active campaign window — zero cost when no campaign is running). Hourly cron (`api.cron.retail-goals-sync`) now has a secondary phase that promotes drafts, ends expired campaigns, and retroactively indexes any webhook drops. Match rule accepts 7 variants (line-item tag/SKU/productId/property, order tag, any/all combinators) so the Mother's Day cart-injection-app signature can be pinned down from a sample injected order without schema change. Campaigns overlap freely — one order can count toward every matching campaign (no dedup). Location-level attribution in V1; `staffMemberId` column reserved on `CampaignOrderMatch` for a Shopify-POS drill-down in V2. Lives as a new `Campaigns` tab under Retail goals (third sibling to `Dashboard` and `Goals`). The whole module is route-agnostic under `app/campaign-goals/` + `app/routes/app.retail-goals/campaigns-tab.tsx` with its own `campaigns` i18n namespace + `campaigns.module.css`, so extracting to a standalone `/app/campaigns` route later is a near-zero-diff move. Attach rate (bundle-orders ÷ total location orders) tracked alongside the order-count goal.

**Retail sales — Dashboard YoY-pace rebuild** *(shipped — merged into the polish pass above)*
Full dashboard redesign motivated by the owner/strategic use case. Current dashboard uses MTD vs full-month goal, which is misleading before mid-month. New design: 6 KPI cards arranged as decomposition + health (Row 1: Total revenue / AOV / Orders as `Revenue = Orders × AOV`; Row 2: Same-store YoY / Best vs worst / Discount rate). Every card shows YoY-paced projected goal delta, projected total via the existing DOW-aware `computeMonthProjections()`, plus Goal and PY lines. Cards 1–3 derive a goal where one doesn't exist natively (AOV from `revenueGoal / PY_orders`, Orders from `revenueGoal / PY_AOV`). Clicking the Revenue card expands a grouped vertical-bar drilldown per location (two-tone navy: outlined PY, solid projected, dashed goal tick, MTD-solid-over-projected-faded overlay on current month). Breakdown table drops `Orders` column, renames `Revenue` → `MTD Revenue`, inserts `Projected rev.`, and recomputes `Achievement` + `YoY` against projected revenue. Single-row controls (drops "Sync now" button, adds `X/Y goals` chip + stale-threshold color on last-synced). Background sync flips from UI-triggered to hourly EventBridge cron hitting `/api/cron/retail-goals-sync` (feature-flagged TF resources default off until secret is wired). Discount Rate required a schema change: `SalesOrder.discountAmount` + `SalesOrderMonthly.totalDiscounts`, GraphQL pulls `currentTotalDiscountsSet`, one-shot `?admin-backfill-discounts=1` endpoint mode reruns a full 13-month sync to populate history. `formatCurrencyCompact` + `formatNumberCompact` extracted from `app.affiliates.tsx` to shared `app/i18n/format.ts`. Pure analytics helpers (`buildLocationSnapshots`, `aggregateSnapshots`, `sameStoreYoY`, `bestVsWorst`, `discountRate`) moved to `app/sales-goals/analytics-pure.ts` so they can be imported from client components without pulling Prisma into the browser bundle.

**Retail Footprint analytics — Phase 3** *(switch reads)*
Restructure the loader to read directly from the normalized tables via `getHeatmapBuckets()` and `getCityRankings()` instead of the old JSON cache. Remove ~400 lines of client-side `useMemo` filter chains. Date range changes move from instant client-side filtering to a debounced server fetcher. Project stats become an on-demand `getProjectRadiusStats()` action. Until Phase 3 lands, the page shows "No geocoded records" because it still reads the empty JSON cache.

**Sales merge** *(Campaigns + Price Tags → unified Sales tab)*
Merging "Merchandising > Campaigns" and the standalone "Price Tags" feature into a single "Sales" tab under Merchandising. Price tags become an opt-in toggle per campaign. Smart badge logic compares absolute percentage vs absolute dollar discount and displays the larger. Product filter combines collections + products (from Price Tags) and product types (from Campaigns). A Quick Apply Tags action remains as a standalone secondary flow for products with existing `compareAtPrice`. Webhook handlers skip campaign-managed products to avoid fighting active campaigns. Routes have been renamed (`app.merchandising.sales.*` → `app.merchandising.sale.*`), the old Price Tags routes are deleted, but the change is not yet committed to main.

**VRP routing** *(replacing the corridor approach)*
Rebuilding route optimization around a real driving distance matrix (Google Distance Matrix API) feeding a VRP solver (OR-Tools or Clarke-Wright savings), replacing the previous haversine-corridor heuristic. The corridor approach fails in cities with complex geography — Rio de Janeiro (mountains, tunnels, Guanabara Bay) exposed that haversine distance can be 5x shorter than actual road distance, causing orders to mix between routes that physically cross the city. The existing cost-reduction patterns (no DirectionsService, no loader precomputation, persistent geocode cache, polyline DB cache) must be preserved regardless of the optimizer approach.

**Affiliates feature** *(early stage, not yet in main)*
New `/app/affiliates` route tracking affiliate profiles and attributing orders to them via a BixGrow CSV import + order backfill sync. Supporting services live under `app/affiliates/` (storage, sync, analytics queries, overview stats). Scope, positioning, and whether it becomes a standalone app identity are still open questions — this is a candidate topic for ideation sessions.

### Planned / not yet started

- **Omnify product marketing page** — replace the currently-301'd OmnifyHome at `omnify.cpg-labs.io/` with a product-focused marketing page that matches the CPG Labs corporate landing's visual language. Mockup ready at `inputs/mockups/omnify-home-v1.html` (synthesized from a 3-agent team: PM strategy + growth copy + UI design). Features three capabilities as stacked alternating rows: Local Delivery (`delivery-guy.png`, cyan glow), Retail Sales (`rocket.png`, magenta glow), Footprint Expansion (`map-pin.png`, lavender glow). Time-horizon narrative (today → month → year). Ships when the 301 redirect at `app/routes/_index/route.tsx` is lifted.
- **CPG Labs URL change** — moving off `omnify.cpg-labs.io/full` to a dedicated URL. Pending, no date set.
- **Multi-provider carrier service** — Loggi, Uber, and Rappi currently exist as placeholder providers. No implementation work scheduled.
- **Local Delivery polish backlog** — Recife 422 error (special request payload mismatch against the city-specific Lalamove config), driver-requested state UI refinements, Lalamove tracking URL button, per-state status labels.
- **Per-city route-spread thresholds** — the current 12km max-spread was tuned on São Paulo correction data. Rio (water barriers) and Recife (narrower urban footprint) may warrant different thresholds once more correction data accumulates.

---

## Architecture Quick Reference

| Area | Where to Find It |
|------|-----------------|
| App routes & pages | `app/routes/` |
| Database schema | `prisma/schema.prisma` |
| Shopify auth & session | `app/shopify.server.ts` |
| Navigation & identity | `app/utils/app-identity.server.ts` |
| Lalamove integration | `app/services/lalamove*.server.ts` |
| Route optimization | `app/services/google-routes-*.server.ts` |
| Carrier service logic | `app/services/carrier/` |
| Price tag automation | `app/services/price-tags/` |
| Merchandising services | `app/services/merchandising/` |
| Webhook handlers | `app/routes/webhooks.*.tsx` |
| Deploy scripts | `scripts/deploy-*.ps1` |
| Infrastructure (Terraform) | `infra/terraform/` |
| Shopify app configs | `shopify.app.*.toml` |
| Translations | `app/i18n/` |

---

## UI Design Language

The app uses Shopify Polaris web components (`s-page`, `s-section`, `s-stack`, `s-box`, `s-button`, etc.) to look and feel native inside Shopify Admin. Key patterns:

- **One `<s-page>` per route** with primary actions in the header
- **CSS Modules** for layout (no inline styles except runtime-computed values)
- **Tables** with white rows, subtle borders, no zebra striping
- **Modals** for search results, configuration, and confirmations
- **Two-column layout** on desktop (main + aside), stacking vertically on mobile
- **Tab bar** for secondary navigation within a page
- **Badge chips** for selected items with remove buttons
- **SVG icons** following Polaris conventions (no emoji in native-looking elements)

Color tokens: subdued text `#6d7175`, borders `#e1e3e5`, Shopify green `#008060`, critical red `#d72c0d`, light gray background `#f6f6f7`.
