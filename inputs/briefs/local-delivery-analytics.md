# Brief — Local Delivery Analytics

| Field | Value |
|---|---|
| **Feature slug** | `local-delivery-analytics` |
| **Status** | Phase 1 — awaiting approval |
| **Owner** | Lucas Guimarães |
| **Branch (planned)** | `feat/local-delivery-analytics-v1` |
| **Created** | 2026-05-08 |
| **App keys** | `full` + `omnify` |
| **First-instance brief** | Yes — also defines the brief-format convention going forward |

This file is phase-1 output of the 5-phase methodology. Phases 2-5 read this file as their primary input and SHOULD NOT need to re-ask the user any of the questions answered below. Open questions live at the bottom under **Assumptions log**; if any block phases 2-5, the gate fires.

---

## 1. Problem statement

CPG Labs merchants who enable Local Delivery (LD) have no way to see whether the feature is **earning its keep**. Today they pay Lalamove (or future LD providers) per dispatched route, and they receive customer-paid LD shipping fees, but the relationship between cost and value is invisible. Three flavors of value go unmeasured:

1. **Direct shipping economics.** What it costs to deliver via LD vs what it would have cost via warehouse shipping (same orders, same destinations).
2. **Conversion lift.** Whether merely **offering** LD in a city raises the city's overall conversion rate — beyond the orders that actually pick LD. Hypothesis: the option's presence reassures customers that fast delivery is available, and they convert at higher rates even when they pick a cheaper/slower option.
3. **Pricing strategy.** Whether the merchant has set the right LD customer-facing price for their commercial goal (break-even, max margin, tax-saving offset, free-ship subsidy offset, etc.).

Without these three views, LD is an act of faith. With them, LD becomes a measurable, tunable lever.

## 2. Audience & frequency

- **Primary**: arbitrary CPG Labs merchants with LD enabled. Polish bar = high (this is a sellable feature, not internal tooling).
- **Use cadence**: weekly review by merchant ops + monthly strategic review by merchant owner/CFO. Not real-time-operational like the LD control panel.
- **Multi-currency / i18n**: required (en + pt-BR), per CLAUDE.md global rules.

## 3. Success metric & anti-goals

- **Success**: a measurable lift in LD adoption, retention, or pricing optimization on shops that engage with the panel. Specific threshold deferred to v1 launch — instrument, observe, set target after first month of data.
- **Anti-goals**:
  - **Vanity dashboard.** If merchants open it once and never return, it failed.
  - **Misleading numbers.** A "savings" figure that conflates customer-charged with merchant-paid is worse than no number. Honest empty states beat dishonest precision.
  - **Slow loader.** The existing LD page already takes 14-17s; this analytics panel cannot inherit that. Must fetch lazily / cached.

## 4. Scope — v1 / v2 / v3 phasing

This is **not** one feature. It is three. Bundling all three in one PR is the path to a multi-month branch. Phasing:

### v1 — Cost-savings report only (this branch)

**What ships**:
- Sub-route `/app/local-delivery/analytics` linked from a button in the LD page header.
- **Cost-savings report** with these views:
  - Per-order rows: order date, city, LD cost (Lalamove quote), warehouse counterfactual (Intelipost quote), customer-charged delta, tax savings (if configured).
  - Per-city / per-month / per-location aggregations.
  - Headline metric: "Revenue retained vs warehouse pricing" (customer-charged delta), with optional "Net margin" view when merchant supplies overrides.
  - Per-LD-city tax savings % override input (Settings or inline).
  - Optional per-location warehouse-cost override (for merchants without Intelipost).
- **Intelipost adapter** as the first warehouse-carrier integration:
  - New `WarehouseCarrierAdapter` interface in `app/services/warehouse-carrier/types.ts` parallel to existing LD `app/services/carrier/`.
  - Single concrete adapter: `IntelipostAdapter`.
  - Per-shop credential storage (encrypted, AES-256-GCM, keyVersion-tagged) following the Lalamove pattern in `LalamoveShopCredential`.
  - Settings UI to onboard credentials in the existing `app.settings.tsx` providers tab.
- **Empty states**:
  - No LD usage → onboarding nudge, link to setup guide.
  - No warehouse carrier configured → "Connect Intelipost to see savings" with deep link.

**What does NOT ship in v1**:
- Conversion lift (zone 2) — moves to v3.
- Objective calculator (zone 3) — moves to v2.
- Speculative-quote provocation for non-LD shops — deferred until carrier API quoting is proven stable.
- Multi-carrier (Frenet, Melhor Envio, Correios) — adapter foundation exists, second adapter is a v2+ task.

### v2 — Objective calculator

**What ships** (separate brief, separate branch):
- Goal selector: dropdown of preset goals (break-even LD revenue vs free-ship subsidy / max LD net margin / make LD self-funded / hit target LD adoption %).
- Toggle: include tax-savings in the math.
- Output: one recommended pricing config per goal (LD price + free-ship threshold), with the math shown.
- Desktop-only (mobile shows "Open on desktop" stub).
- No elasticity assumption — backward-looking scenario calculator over historical orders.

### v3 — Conversion lift

**What ships** (separate brief, separate branch):
- Matched-control concurrent methodology: pair each LD city with a similar non-LD city (matched on order volume, region, customer profile), compare conversion rates over the same time window.
- Requires per-city sessions data — sync pipeline TBD (Shopify Analytics API).
- Honest disclaimer: "matched-control estimate, not randomized experiment."

## 5. Architecture overview

```
┌──────────────────────────────────────────┐
│  /app/local-delivery/analytics (route)   │
│  Loader: live every page load, lazy      │
└────┬───────────────────────────────────┬─┘
     │                                   │
┌────▼─────────────┐         ┌──────────▼─────────┐
│ LdAnalyticsDaily │         │ Per-order live     │
│ (new Prisma tbl) │         │ join: ShopOrder    │
│ rolled-up by    │         │ × LalamoveDispatch │
│ shop+city+date  │         │ Job × Intelipost   │
│ via cron         │         │ quote cache        │
└──────────────────┘         └────────────────────┘
                                          │
                                ┌─────────▼──────────┐
                                │ IntelipostAdapter  │
                                │ implements         │
                                │ WarehouseCarrier-  │
                                │ Adapter interface  │
                                └────────────────────┘
```

- Loader prioritizes the **rolled-up table** for headline metrics (fast).
- Drilldowns hit the **live join** for per-order detail (slower, lazy).
- Intelipost quotes are **cached per (shop, order)** in a new table to avoid re-quoting on every page load. Refresh window TBD — assumption: 90 days, then re-quote on demand.

## 6. Data model changes

New Prisma tables:

```
WarehouseCarrierCredential
  shop, provider ("intelipost"), apiKey (encrypted), keyVersion, ...
  (mirrors LalamoveShopCredential)

WarehouseCarrierQuoteCache
  shop, orderId (gid), provider, priceSubunits, currency, deliveryEstimate,
  quotedAt, expiresAt
  unique: (shop, orderId, provider)

LdAnalyticsDaily
  shop, cityNorm, cityDisplay, date,
  ldOrderCount, ldRevenueSubunits, ldCarrierCostSubunits,
  warehouseCounterfactualSubunits,
  taxSavingsSubunits,
  currencyCode

LdAnalyticsConfig
  shop, perCityTaxSavingsJson (JSON: { cityNorm: percentage }),
  perLocationWarehouseCostOverrideJson (JSON: { locationId: subunitsPerOrder })
```

**No backfill of existing data** required for v1 — analytics start from feature-launch date forward. Historical Lalamove dispatches are already in `LalamoveDispatchJob`; the new aggregation cron seeds `LdAnalyticsDaily` from existing data on first run (one-time backfill in the cron, idempotent).

## 7. UX placement & flow

- **Entry point**: button in the LD page header — `<s-button>View analytics</s-button>` next to the existing controls.
- **Default landing state**: last 90 days, all locations, headline metric (Revenue retained), drilldown collapsed.
- **Filter inheritance**: location filter inherits the LD page's selection (per Lucas's #6 answer), defaulted to all-locations.
- **Drilldowns**: per-city → per-month → per-order, expanding inline.
- **Settings entry**: tax-savings % per city + warehouse-cost override per location live in the LD analytics panel itself (not in /app/settings) — they're feature-specific config, not global merchant settings.

## 8. State enumeration

Required for `/design-engineer` state matrix in phase 2. Sketched here for completeness:

| State | Trigger | Render |
|---|---|---|
| **Loading** | Loader fetching | Polaris skeleton |
| **No LD usage** | Zero LD dispatches in window | Empty state with onboarding nudge |
| **No carrier configured** | LD usage exists, no Intelipost credentials | Empty state with "Connect Intelipost" CTA |
| **Carrier auth failed** | Intelipost API returns 401 | Banner with re-auth CTA, fallback to "manual override" mode |
| **Partial data** | Some orders quoted, some not (cache miss + carrier 5xx) | Headline shows partial coverage % + "X orders couldn't be quoted" footnote |
| **Full data** | All orders quoted | Standard view |
| **Drilldown loading** | User expands a city | Inline spinner per row |
| **Override editing** | User opens override modal | Modal with confirmation pattern |

Phase 2 mockup must enumerate all of these with screenshots/HTML.

## 9. Integrations

| System | Direction | Action | Risk |
|---|---|---|---|
| **Lalamove** | Read-only | Reuse existing `LalamoveDispatchJob.quotationTotal` snapshot | None |
| **Intelipost API** | Read-only quote | NEW. Per-shop credentials, on-demand quoting + cache | High — undocumented for our team, rate-limit unknown |
| **Shopify Admin API** | Read-only | `Order` for shipping address + line items (already fetched today via `ShopOrder.shippingAddressJson`) | None |
| **Shopify scopes** | None new | Existing `read_orders` covers it | None |

**No new Shopify scopes** — both `shopify.app.cpg-labs.toml` and `shopify.app.omnify.toml` stay as-is. `shopify app deploy` not needed.

## 10. Telemetry / logging

Per CLAUDE.md "Logging" conventions:

- **Module prefix**: `[ld-analytics]`
- **Sub-contexts**: `[ld-analytics:loader]`, `[ld-analytics:cron]`, `[ld-analytics:intelipost]`
- **Required logs**:
  - Loader fire — START with shop, time window, location filter; OK with row counts and elapsed; FAILED with error.
  - Cron rollup — per-shop per-day START/OK/SKIP/FAILED + counts.
  - Intelipost quote — START with shop + orderId; OK with priceSubunits + cache hit/miss; FAILED with HTTP status.
  - Override change — INFO with shop + before/after values (no PII).
- **Never log**: Intelipost credentials, customer addresses, customer emails.

## 11. i18n

- **New namespace**: `app/i18n/locales/{en,pt-BR}/ld-analytics.json`.
- All user-facing strings — page title, headline metric label, empty-state copy, error banners, override-modal labels, tooltip rows — translated.
- pt-BR follows brand voice rules (CLAUDE.md): no em dashes, no idioms, no sarcasm, plain language.

## 12. Deploy plan

- **App keys**: `full` and `omnify` (both, per gate decision).
- **Schema migration**: `prisma migrate dev` for the four new tables. Pre-image-deploy migration is fine — tables are additive, no read paths in existing code reference them.
- **Terraform**: no new env vars expected. If Intelipost requires per-task config (e.g. global API endpoint), it's a per-shop value not a global env var.
- **Subpath**: no new nav `<Link>` to add (the entry-point button uses an absolute `to="/app/local-delivery/analytics"`). `npm run check:basepath` will validate.
- **Deploy queue**: append entry post-merge to `.claude/deploy-queue.md` per CLAUDE.md protocol. Coordinate with any in-flight LD branches (today: `feat/local-delivery-control-row-polish`).
- **Rollout**: gated behind a per-shop opt-in toggle in Settings — `LdAnalyticsConfig.enabled` (default false). Lucas / GE Beauty enables first, validates, then we flip default to true once confidence is established.

## 13. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Intelipost API quirks** (rate limit, schema drift, auth model) | High | High | v1 ships behind opt-in toggle, observed on GE Beauty first. Adapter has explicit fallback to "manual override" mode if API fails. |
| **Quote-cache staleness** | Medium | Medium | 90-day cache TTL + re-quote on user-triggered drilldown. Configurable. |
| **Loader latency** (LD page already at 14-17s) | High | High | Analytics is its own loader, not the LD loader. Roll-up table answers headline metrics in <500ms. Per-order drilldown is lazy. |
| **Causal claims overreach** (zone 2 in v3) | Low (deferred) | High | Disclaimer + methodology doc. Not a v1 risk. |
| **Merchant onboarding friction** (Intelipost credentials) | Medium | Medium | Empty state explicitly explains why credentials unlock the savings number. Manual override path means they can use the panel without integrating. |
| **Conflict with in-flight LD branches** | Medium | Low | New code lives in a sub-route + new files. No edits to `app.local-delivery.tsx` body, only adds an entry-point button. Merge conflicts limited to imports. |

## 14. Phase plan & gates

| Phase | Output | Gate signal | Estimated wall-clock |
|---|---|---|---|
| **1. Brief** | This file | ✅ Approved 2026-05-10 (commit `e65e5c2`) | ~30 min |
| **2. Design** | `inputs/mockups/local-delivery-analytics-v1.html` (final state + state matrix, 8 states) | ✅ Approved 2026-05-10 — all 6 phase-2 questions resolved (see §18) | ~2-3 hours |
| **3. Spec** | `docs/plans/local-delivery-analytics.md` — file-level diff plan, route exports, action surface, Prisma migration steps, Intelipost adapter signatures. Must address phase-3 follow-ups from the mockup's bottom panel. | User chat reply: "approved phase 3" | ~1 hour |
| **4. Build** | Branch `feat/local-delivery-analytics-v1` with all commits, lint + typecheck green, `npm run check:basepath` green. **Runs as background `Agent` call.** | User reviews diff in PR / branch tip | ~6-12 hours background |
| **5. Ship** | PR description, deploy-queue entry, handover doc. Merge call lands on user. | User merge approval | ~30 min |

## 15. Skip rules invoked

- **Phase 2 (mockup)** is required (new UI surface, new states).
- **Phase 3 (spec)** is required (new schema, new integration).
- No skips.

## 16. Methodology meta-defaults applied

The user did not lock all methodology mechanics in phase 1. The following defaults are applied; user can correct in any phase gate:

- **Brief location**: `inputs/briefs/<feature>.md` (this file).
- **Mockup location**: `inputs/mockups/<feature>-v1.html` per CLAUDE.md.
- **Spec location**: `docs/plans/<feature>.md` (new directory; first instance).
- **Gate signal**: chat reply with "approved phase N" or "rejected phase N: <reason>".
- **Mid-phase ambiguity rule**: log assumption in this file's §17, continue, surface at next gate.
- **Hard cap**: 5 assumptions per phase; >5 = hard stop, batch-question.
- **Concurrency**: one feature brief at a time per `feedback_single_session.md`.
- **Background-run notification**: phase 4 background agent emits a final summary message; `ScheduleWakeup` is used to check on long-running builds.
- **Skill consolidation**: this brief is the manual run of the methodology. After v1 ships, distill into a `/feature` skill that orchestrates the 5 phases. Existing `/senior-engineer` is retained until `/feature` is proven.

## 17. Assumptions log

Surfaced for confirmation at the phase 1 gate. None of these block drafting; all are correctable.

1. **Intelipost is the v1 carrier.** Driven by GE Beauty being the validation merchant. If another merchant wants v1 access with a different carrier, scope expands.
2. **Quote cache TTL = 90 days.** Pulled from thin air; needs domain validation. Could be 30 or 365 — depends on Intelipost rate volatility.
3. ~~**Headline metric = "Revenue retained vs warehouse pricing"**~~ → **Resolved phase-2 Q3:** default was **Shipping P&L impact**. **Pivoted post-phase-4 (2026-05-10):** v1 default flipped to **Net cost delta** because `ShopOrder` doesn't capture `shippingLines` (the customer-charged LD shipping amount), so pl_impact's formula has a missing input and the headline would be artificially low. Picker still lets merchant switch to "P&L impact" or "Revenue retained" once they configure manual overrides. Default flips back when shippingLines capture lands in v2. Persisted per-shop in `LdAnalyticsConfig.headlineFraming`.
4. **Settings entry for analytics-specific config** (tax savings %, warehouse-cost override) lives **inside the analytics panel**, not in `/app/settings`. Justification: feature-specific config, not cross-cutting. ⚠ Note: the per-shop **opt-in toggle** itself lives in `/app/settings` per phase-2 Q2; only the analytics-internal overrides live in the analytics panel.
5. **Per-shop opt-in default = false** for v1. Flip to true after GE Beauty validation period (~30 days). Toggle location: `/app/settings` under Local Delivery (resolved phase-2 Q2).
6. **No backfill of historical sessions data** — zone 2 (v3) starts capturing on its launch date, no retroactive analysis.
7. **Currency**: always render in shop's currency. No multi-currency consolidation across shops (irrelevant for the per-shop view).

## 18. Phase-2 resolutions

All 6 phase-2 questions resolved 2026-05-10. Decisions baked into the mockup at `inputs/mockups/local-delivery-analytics-v1.html`.

| # | Question | Decision |
|---|---|---|
| Q1 | Provocation copy on no-carrier-configured empty state | **Variant B in v1** — teaser with estimated savings ("You could be saving ~R$ 3,200 / month"). **Phase-3 follow-up**: verify Intelipost permits speculative quoting on arbitrary historical orders before merging. If not, falls back to Variant A (conservative empty state) and we document the constraint. |
| Q2 | Opt-in toggle location | **`/app/settings` under Local Delivery section.** Off by default for v1, on after GE Beauty validation. |
| Q3 | Headline default | **Locked phase-2 as C (P&L impact); pivoted post-phase-4 to B (Net cost delta).** Phase-4 build discovered `ShopOrder.shippingLines` isn't captured, so P&L impact's formula has a missing input. v1 ships with Net cost delta as default; picker switches to P&L impact or Revenue retained once overrides configured. Default flips back to P&L impact when shippingLines capture lands in v2. |
| Q4 | Override modal granularity | **Variant A — flat warehouse cost per location + tax-savings % per LD city.** Per-zone × weight matrix deferred to v2 if A proves too coarse. |
| Q5 | Entry point | **Button "View analytics" in the LD page header.** Sub-route at `/app/local-delivery/analytics`. (Recommended — analytics is strategic vs LD's operational mode; separate sub-route preserves that boundary and avoids inheriting the LD loader's 14-17s latency.) |
| Q6 | Partial-data rule | **Show with disclaimer + footnote when coverage ≥ 80%.** Below 80% triggers the "insufficient data" empty state. |

## 19. Phase-3 follow-ups (carry into spec)

Items the mockup surfaced that the spec must explicitly address:

1. **Verify Intelipost speculative-quote feasibility** — required for Q1 Variant B (state #3 provocation teaser). If the API rejects quotes for orders that weren't shipped via Intelipost, fall back to Variant A and document the constraint in the spec.
2. **Headline-picker persistence** — implementation detail: persist the merchant's framing choice in `LdAnalyticsConfig.headlineFraming` so they don't re-pick on every visit.
3. **P&L formula edge cases** — orders with R$ 0 LD charge (free-ship) still incur LD carrier cost. Math holds, but the per-order drilldown needs a "free-ship" badge to explain why customer-charged is zero.
4. **WH counterfactual on free-ship orders** — counterfactual rate is what Intelipost would have charged for that order, NOT zero. Free-ship is a merchant subsidy, not a carrier discount. Spec must make this distinction explicit in the loader logic.
