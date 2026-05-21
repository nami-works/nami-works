# Google Places Management — Standalone Service

## What it is

A standalone web-based platform where any brick-and-mortar retail merchant—regardless of their e-commerce stack—can manage their store locations, sync them to Google Business Profile automatically, and generate a branded storefront page for their website. Shopify is one of several data sources, not a dependency.

---

## Core value proposition

Most multi-location retail brands manage their Google presence poorly. Listings are outdated, inconsistent across locations, and maintained manually—if at all. This service becomes their single source of truth for location data, with automatic propagation to Google and a clean public-facing storefront as a byproduct.

---

## How merchants onboard

Depending on their tech stack, merchants could connect via one of several entry points:

- **Shopify merchants** — locations imported automatically via Shopify API
- **Other e-commerce platforms** — via API connectors (VTEX, WooCommerce, etc.) built over time
- **Non-e-commerce merchants** — manual entry through a clean, guided interface
- **Website scraping** — for merchants who already have a locations page, the platform can ingest that data as a starting point

The goal is zero friction regardless of where they're coming from.

---

## What the service delivers to merchants

**Location management dashboard** — a unified interface to add, edit, and manage all store locations across their brand. Opening hours, address, phone, photos, categories, attributes—all in one place.

**Google Business Profile sync** — changes made in the dashboard propagate automatically to Google. No more logging into GBP location by location. Multi-location brands especially feel this pain acutely.

**Branded storefront page** — a well-designed, SEO-optimized store locator page generated from their location data, embeddable on their website. Better than anything most brands would build themselves.

**Location health monitoring** — alerts when Google listings have discrepancies, unverified locations, missing information, or negative review spikes that need attention.

---

## Why it drives growth for the broader CPG Labs ecosystem

**It builds the most valuable asset in the business: the retail intelligence database.**

Every merchant that uses the service contributes verified, timestamped location data. Over time CPG Labs accumulates ground-truth knowledge about which brands are present in which malls, when stores opened and closed, and which retail environments correlate with healthy operations. This data is what makes the retail footprint site selection feature (on the roadmap for the future) defensible — no competitor can replicate it without the same merchant network.

**It creates a natural acquisition funnel into the full CPG Labs suite.**

A merchant joins for a simple, tangible utility — fixing their Google presence. Once inside, they're naturally exposed to the retail footprint analytics, the site selection framework, and the broader decision-making tools CPG Labs offers. The Places service is the low-friction top of funnel.

**It generates network effects.**

The more merchants onboard, the richer the mall directory becomes. Richer data means better recommendations. Better recommendations attract more merchants. This flywheel is the structural moat of the business.

**It positions CPG Labs as infrastructure.**

A tool merchants use occasionally is easy to cancel. A service that owns their Google sync and powers their public store locator page is embedded in their operations. That drives retention and increases lifetime value across the entire customer base.

---

## The one-sentence pitch

*Stop managing your store locations in five different places — connect once, sync everywhere, and let your locations work for you.*


# OMNIFY ARCHITECT’S BLUEPRINT 2.0: Google Business Profile (GBP) SaaS Infrastructure

**Project Status:** 2026 Enterprise Standards  
**Legal Entity:** CPG Labs (cpg-labs.io)  
**Product:** Omnify (omnify.cpg-labs.io)

---

## 1. INSTITUTIONAL & COMPLIANCE ARCHITECTURE
Google's manual review for the Business Profile API is the "Great Filter." You must present as a high-authority Agency.

### A. The "Trust Score" Foundation
* **D-U-N-S Registration:** Ensure CPG Labs has a Data Universal Numbering System record. Google uses this to verify you aren't a "ghost" company.
* **Agency Dashboard:** Register at `business.google.com/agencysignup`. 
    * **Crucial:** This generates an **Organization ID**. All API requests must be associated with this ID to manage multiple third-party brands.
* **Dedicated Support Identity:** All automated communications from the app (emails, verification codes) must come from `@cpg-labs.io`.

### B. Public-Facing Compliance (cpg-labs.io)
Google reviewers will audit the landing page for:
* **API Disclosure:** A dedicated section in the Privacy Policy stating: *"Omnify’s use of information received from Google APIs will adhere to Google API Services User Data Policy, including the Limited Use requirements."*
* **Brand Transparency:** The site must state: *"Omnify is a location management technology developed and operated by CPG Labs."*
* **Security Posture:** A page or section detailing SOC2 compliance or at-minimum "Encryption at Rest" for client location data.

---

## 2. TECHNICAL STACK & API ORCHESTRATION
The backend must handle the "Search -> Inject -> Verify" loop with high reliability.

### A. The "Injection" Logic Flow
To avoid account suspensions, the "Injection" must be surgical.
1.  **Validation Layer:** Run all client addresses through the **Google Maps Address Validation API** *before* hitting the GBP API. Fix typos and formatting (e.g., "St." vs "Street").
2.  **The Discovery Phase (`googleLocations.search`):** * Query the brand name + lat/long. 
    * **Logic:** If a `locationId` returns, the store is already on the map. Use the `requestAdminRightsUrl` to start a "Claim" flow instead of a "Create" flow.
3.  **The Creation Phase (`accounts.locations.create`):** * POST a strictly formatted JSON. 
    * **Mandatory Fields:** `locationName`, `storeCode` (your internal ID), `primaryCategory` (must match Google's 2026 taxonomy), `address`, and `phone`.

### B. The 2026 Verification Engine
Manual verification is the #1 churn reason for SaaS users. Omnify must automate the "Fetch & Trigger" sequence:
* **Call:** `locations.fetchVerificationOptions`.
* **UI Logic:** Dynamically show the client ONLY the options Google allows for that specific store (e.g., "SMS to (***) ***-1234" or "Video Upload").
* **Video Verification Integration:** Since 2026 standards prioritize video, the Omnify mobile web-app must support the `verification.start` method to allow users to record their store walk-through directly.

---

## 3. DATA PERSISTENCE & SYNC (THE "MOAT")
To be a "Yext-Killer," you need a "Single Source of Truth" database.

| Feature | API Endpoint | SaaS Value Add |
| :--- | :--- | :--- |
| **Real-time Sync** | `accounts.locations.patch` | Instantly update holiday hours across 500 stores with one click. |
| **Review Management** | `accounts.locations.reviews` | Aggregate all reviews into a single "Omnify Inbox" with AI-suggested replies. |
| **Local Posts** | `accounts.locations.localPosts` | Blast "Grand Opening" or "Sale" updates to every Google Maps pin simultaneously. |
| **Insights/Analytics** | `locations.reportInsights` | Show clients "Maps Views" vs "Website Clicks" in a custom, branded dashboard. |

---

## 4. DEVELOPER IMPLEMENTATION ROADMAP (JIRA/SPRINT BACKLOG)

### Sprint 1: Identity & OAuth (Week 1-2)
- [ ] **Task:** Setup GCP Project `omnify-production`.
- [ ] **Task:** Configure OAuth 2.0 Consent Screen with `business.manage` scope.
- [ ] **Task:** Implement **Refresh Token** logic in the backend (PostgreSQL/Redis) so clients don't have to re-login every hour.
- [ ] **Task:** Verify `cpg-labs.io` in Google Search Console.

### Sprint 2: The Core Injection Engine (Week 3-4)
- [ ] **Task:** Build the `AddressValidator` service using Google Maps API.
- [ ] **Task:** Implement `LocationCreator` service (POST to `accounts.locations`).
- [ ] **Task:** Build the "Duplicate Detector" logic using `googleLocations.search`.

### Sprint 3: Verification & Lifecycle (Week 5-6)
- [ ] **Task:** Create the "Verification Dashboard" in the UI (States: Pending, Action Required, Live).
- [ ] **Task:** Implement the `fetchVerificationOptions` and `completeVerification` endpoints.
- [ ] **Task:** Build a Webhook listener to detect when Google "Suspends" or "Disables" a location.

---

## 5. SCALING & QUOTA MANAGEMENT
Once the app is live, you will hit the default "Discovery Quota" limits.

* **Quota Expansion:** You must apply for a "Tier 2" quota. 
* **Justification Strategy:** "Omnify is a multi-tenant platform. We currently have [X] brand partners with [Y] total locations. We require increased write-limits to handle weekly synchronized data updates (hours/posts)."
* **The "Shadow-Ban" Prevention:** Implement an internal **Token Bucket** rate-limiter in your Node/Python/Go backend to ensure you never exceed Google's requests-per-minute (RPM) limits.

---

## 6. FINAL EXPERT CHECKLIST
* **HTTPS:** Ensure all `omnify.cpg-labs.io` endpoints are forced SSL.
* **Redirect URIs:** Must match exactly in GCP Console and your code.
* **Brand Name:** Ensure "Omnify" or "CPG Labs" is the name users see when the Google OAuth popup appears. If it says "Project-ID-12345," users will not trust the app.