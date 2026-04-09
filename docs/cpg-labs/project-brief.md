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
| **Omnify** | Delivery-focused brands | Local Delivery, Retail Footprint, Sales Goals, Carrier Service, Settings |
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

### 2. Sales Goals

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

## Current Priorities & In-Progress Work

### Local Delivery (active)
- Route manager card restyling (cancel button → secondary/critical)
- "Driver requested" state: disable "Clear route" when delivery is active
- "Track delivery" button linking to Lalamove tracking URL
- Lalamove status labels (incremental UI feedback for each state)
- Recife 422 error investigation (special request payload mismatch)

### Platform
- CPG Labs URL change: moving from `omnify.cpg-labs.io/full` to a dedicated URL (pending)
- Multi-provider carrier service (Loggi, Uber, Rappi — planned, not started)

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
