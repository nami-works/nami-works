# Day-zero defect issue drafts

Source: `docs/optimizer-iteration-blueprint.md` §13. Filing order per §13 day-zero table.
After approval, each `## Issue N` block becomes one `gh issue create` call. Title and labels listed under each.

Edit anything in place; I'll re-read before filing.

---

## Issue 1 — `[optimizer] mark-delivered treats failed stops as delivered`

**Labels:** `optimizer`, `pod-mismatch`, `severity-5`, `day-zero`
**Title:** `[optimizer] mark-delivered treats failed stops as delivered (per-stop POD bucketing)`

### Summary
`handleMarkDelivered` in `app/routes/api.control.$intent.tsx` operates on a whole route as one indivisible unit. Every order in the route is fulfilled in Shopify and gets a DELIVERED event regardless of per-stop POD outcome. On a 4-of-5 DELIVERED + 1 FAILED route, the failed customer receives a "your order has been delivered" email anyway. Confirmed by the Yasmin #78301 incident.

The inverse — Beatriz #77793 — is also unhandled: an order physically delivered but stuck UNFULFILLED, with no surgical "mark this one stop delivered" path because mark-delivered is route-level only.

### Defect class
`pod-mismatch` (1st occurrence in the structured backlog; recurring in operator notes).

### Evidence
- Route-level treatment: [app/routes/api.control.$intent.tsx:1181](../../app/routes/api.control.$intent.tsx#L1181) — `handleMarkDelivered` iterates `lalamoveDispatchOrderMap` with no per-stop POD branching.
- DELIVERED event return value ignored: [api.control.$intent.tsx:1417](../../app/routes/api.control.$intent.tsx#L1417) — `await addDeliveredEvent(fulfillmentId, shopifyOrderId)` — return is `false` on userErrors but the call site doesn't check, and `shopifyFulfilled` is incremented on line 1416 before the event call. Same pattern at [line 1367](../../app/routes/api.control.$intent.tsx#L1367) for the existing-fulfillment branch.
- No post-write verification of `fulfillment.displayStatus`. Operators report orders showing FULFILLED instead of DELIVERED post-call.
- Per-stop POD data exists in `state.routes[].dispatch.stops[]` and is currently unused by the mark-delivered path.
- Memory: `project_beatriz_77793_pending.md`, `feedback_fulfill_notify_default.md`.

### Operator impact
~1–3 mis-fulfillments per week on gebeauty volume. Each requires customer apology, refund processing, and re-dispatch reconciliation. Multi-tenant: catastrophic — first "Delivered" email screenshot next to an empty doorstep is a trust kill.

### Proposed fix direction
1. New `app/services/pod-bucketing.server.ts` with `summarizeRoutePOD(route)` and `bucketRouteForFulfillment(route)` returning `clean | mixed | held | skip`.
2. Stop-to-order matching: phone (E.164) → fuzzy name → 50m coords → first-stop=pickup heuristic.
3. `handleMarkDelivered` calls bucketing first and branches:
   - **clean** — fulfill all, verify `displayStatus === "DELIVERED"` post-write, retry with `IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED` chain if not progressed.
   - **mixed** — fulfill DELIVERED stops only; tag FAILED stops `ld_redelivery_pending`, never email them.
   - **held** — `{ ok: false, status: "held", retryAfter }`, no Shopify writes.
   - **skip** — `{ ok: false, status: "manual-review" }`, return unmatched-stop summary.
4. New endpoint `mark-stop-delivered` for surgical single-order interventions (Beatriz case). Idempotent.
5. Response shape exposes `partialDelivery: true` when `shopifyFulfilled !== deliveredEventsCreated`.
6. Behind flag `optimizer.mark-delivered.per-stop-bucketing`. Legacy route-level path stays as flag-off rollback for 30 days.

### UI changes (embedded admin)
- Existing **Mark as delivered** button: server response now includes bucket. UI toasts per bucket and renders per-stop status pills (Delivered/Failed/Pending/Unknown) on the dispatched-route card.
- Per-stop overflow `⋯` menu with **Mark this stop delivered** (calls new endpoint, confirmation modal, notify-customer toggle defaulting ON).
- See chat thread for the layout sketch; will land as a follow-up `/design-engineer` mockup before code.

### Acceptance criteria
- [ ] Clean-bucket: identical behavior to today + post-write `displayStatus === "DELIVERED"` verified.
- [ ] Mixed-bucket: only DELIVERED stops fulfilled; FAILED stops tagged `ld_redelivery_pending`, no DELIVERED email.
- [ ] Held-bucket: `{ ok: false, status: "held", retryAfter }`, zero Shopify writes.
- [ ] Skip-bucket: `{ ok: false, status: "manual-review" }` with unmatched-stop summary.
- [ ] `addDeliveredEvent` return value checked; `shopifyFulfilled` only increments when both fulfillment and event succeed.
- [ ] `partialDelivery: true` surfaced in response when `shopifyFulfilled !== deliveredEventsCreated`.
- [ ] `mark-stop-delivered` endpoint creates a single fulfillment + DELIVERED event, idempotent.
- [ ] `notifyCustomer` policy: ON for clean DELIVERED, OFF for FAILED, OFF for held.
- [ ] Regression fixture: Yasmin #78301 (4 DELIVERED + 1 FAILED) → 4 fulfillments + 1 redelivery-pending tag, no FAILED email.
- [ ] Regression fixture: Beatriz #77793 → `mark-stop-delivered` clears the order with `displayStatus === "DELIVERED"`.
- [ ] Regression fixture: clean route where prior `addDeliveredEvent` silently failed → `partialDelivery: true` instead of false success.

---

## Issue 2 — `[optimizer] cost-aware optimization missing on CLI/cron/auto-routing paths`

**Labels:** `optimizer`, `cost-aware`, `severity-5`, `day-zero`
**Title:** `[optimizer] cost-aware optimization missing on CLI/cron/auto-routing paths`

### Summary
The cost-aware functions `optimizeByCarrierQuotation` / `optimizeByVRP` / `addToExistingRoutesByCarrierQuotation` are invoked only from the embedded admin UI. CLI, auto-delivery cron, and auto-routing all use geometric-only `clusterOrders`, which picks a fixed `routeCount = ceil(orders / TARGET_PER_ROUTE)` without consulting Lalamove pricing, vehicle-type tradeoffs, or special-request surcharges.

### Defect class
`cost-aware` (broad — drives most other optimizer defects).

### Evidence
- UI cost-aware: [app/routes/app.local-delivery.tsx:7223](../../app/routes/app.local-delivery.tsx#L7223), [app/routes/app.local-delivery.tsx:7387](../../app/routes/app.local-delivery.tsx#L7387)
- CLI geometric: [app/routes/api.control.$intent.tsx:989](../../app/routes/api.control.$intent.tsx#L989)
- Cron geometric: [app/routes/api.cron.auto-delivery.tsx:199](../../app/routes/api.cron.auto-delivery.tsx#L199)
- Auto-routing geometric: [app/services/auto-routing.server.ts:433](../../app/services/auto-routing.server.ts#L433)
- `optimizeByCarrierQuotation` exists and is wired: [app/services/carrier-quotation-optimizer.server.ts:670](../../app/services/carrier-quotation-optimizer.server.ts#L670).

### Operator impact
~15–30% cost overhead on imbalanced batches. Geometric clustering produces "outlier-loner" routes that cost-aware Phase A would have rejected in favor of cheaper k-trial partitions. The CLI and cron are where the bulk of optimize decisions are made — this is the largest unlock.

### Proposed fix direction
Replace each programmatic `clusterOrders` call site with `optimizeByCarrierQuotation`. Plumb credentials from the same source as the dispatch path. Pull `vehicleOptions` from `LalamoveConfig` (depends on Issue 5) and `specialRequests` from `CarrierServiceConfigData` (depends on Issue 6). Behind flag `optimizer.cost-aware.programmatic-paths`.

### Acceptance criteria
- [ ] CLI, auto-delivery cron, and auto-routing all invoke `optimizeByCarrierQuotation`.
- [ ] Regression fixtures (≥3 historical batches) prove cost reductions vs geometric path.
- [ ] Flag-off preserves legacy geometric clustering for 30-day rollback.
- [ ] CloudWatch shows `optimize.candidate_evaluated` events firing per partition trial in the new path.

---

## Issue 3 — `[optimizer] auto-delivery cron violates 7-stop cap`

**Labels:** `optimizer`, `capacity-overflow`, `severity-4`, `day-zero`
**Title:** `[optimizer] auto-delivery cron hardcodes maxPerRoute=10, violates 7-stop cap`

### Summary
The auto-delivery cron passes `10` as `maxPerRoute` to `clusterOrders`. The operator's hard cap is 7 (single-driver carrying capacity, recorded in `feedback_max_orders_per_route.md`). The optimizer's own constant declares `MAX_STOPS_PER_ROUTE = 7`. On high-volume days the cron silently produces 8–10-stop routes that the operator manually splits.

### Defect class
`capacity-overflow`.

### Evidence
- Hardcoded value: [app/routes/api.cron.auto-delivery.tsx:199](../../app/routes/api.cron.auto-delivery.tsx#L199) — `clusterOrders(optimizerOrders, routeCount, 10)`.
- Optimizer constant: [app/services/carrier-quotation-optimizer.server.ts:83](../../app/services/carrier-quotation-optimizer.server.ts#L83) — `const MAX_STOPS_PER_ROUTE = 7`.
- Operator memory: `feedback_max_orders_per_route.md`.

### Proposed fix direction
Replace `10` with `config.lalamoveMaxOrdersPerRoute ?? MAX_STOPS_PER_ROUTE`. Read from per-tenant `LalamoveConfig`. No flag needed — constraint correctness, low risk.

### Acceptance criteria
- [ ] No production cron run produces a route with > 7 stops.
- [ ] `LalamoveConfig` admin UI exposes `lalamoveMaxOrdersPerRoute`.
- [ ] Migration backfills existing tenants to the 7 default.

---

## Issue 4 — `[optimizer] /api/control/state returns stale dispatch metadata`

**Labels:** `state`, `severity-4`, `day-zero`
**Title:** `[optimizer] /api/control/state returns stale dispatch metadata after slot reuse`

### Summary
`/api/control/state` returns `route.dispatch.status` and `requestedAt` for each slot regardless of whether the orders currently tagged with `ld_rota-NN` match the orders that were dispatched. After fresh optimize moves new orders into a slot, the state still shows yesterday's COMPLETED Lalamove order ID. Confirmed live on 2026-05-01 across SP slot 0, PE slot 0, RJ slots 0 + 1.

### Defect class
State integrity. Blocks Issue 1 (mark-delivered bucketing depends on trustworthy state).

### Evidence
- Reproduced 2026-05-01: state returned `requestedAt: 2026-04-30T20:08:54.963Z`, `status: COMPLETED` for slots holding fresh orders.
- Slot metadata is cached against the slot, not against the order set.

### Proposed fix direction
Two options, prefer option 2:
1. **Invalidate slot metadata on tag change.** When `ld_rota-NN` is added/removed, clear cached `dispatch` on that slot.
2. **`Dispatch` table keyed by `lalamoveOrderId` with `orderIds[]` snapshot.** State queries the latest dispatch whose `orderIds` exactly matches the current tag-grouped order set; if no match, slot is fresh. Better audit, full dispatch history per slot.

### Acceptance criteria
- [ ] State for a slot whose order set differs from any historical dispatch returns `dispatch: null`.
- [ ] State for a slot whose orders match a prior dispatch returns that dispatch's metadata.
- [ ] Live refresh by `lalamoveOrderId` is on-demand via `--live`, not cached against the slot.

---

## Issue 5 — `[optimizer] CLI/cron don't compare primary vs secondary vehicle types`

**Labels:** `optimizer`, `service-type`, `severity-3`, `day-zero`
**Title:** `[optimizer] CLI/cron don't pass vehicleOptions to optimizer (no LALAGO/CAR comparison)`

### Summary
Depends on Issue 2. Once cost-aware lands on programmatic paths, the optimizer can compare primary and secondary vehicle types per partition — but only if the call sites pass `vehicleOptions`. Today they don't, so the optimizer defaults to a single vehicle type and the LALAGO-vs-CAR cost comparison is lost on CLI/cron/auto-routing.

### Defect class
`service-type`.

### Evidence
- `LalamoveConfig.preferredServiceType` (primary) and `CarrierServiceConfigData.lalamoveSecondaryServiceType` are populated in production.
- `optimizeByCarrierQuotation` accepts `vehicleOptions: { primary, secondary? }` and quotes both.
- UI path passes them; programmatic paths don't (will become apparent after Issue 2 lands).

### Proposed fix direction
At each programmatic call site, pass `{ primary: config.preferredServiceType, secondary: carrierConfig.lalamoveSecondaryServiceType }`.

### Acceptance criteria
- [ ] When both vehicle types configured, optimize logs show quotes against both.
- [ ] Cheapest-of-both selected per cluster.

---

## Issue 6 — `[optimizer] CLI/cron don't pass special requests to Lalamove quotes`

**Labels:** `optimizer`, `pricing`, `severity-3`, `day-zero`
**Title:** `[optimizer] CLI/cron don't pass specialRequests to optimizer (DOOR_TO_DOOR pricing missing)`

### Summary
Depends on Issue 2. `optimizeByCarrierQuotation` accepts `specialRequests?: string[]` (e.g., `DOOR_TO_DOOR` for `BR_SAO`). `CarrierServiceConfigData.lalamoveSpecialRequests` is per-market. UI path passes them; programmatic paths don't.

### Evidence
- Per-market special-requests config exists in production.
- `optimizeByCarrierQuotation` 7th argument unused on programmatic call sites.
- Per-city availability quirk: `BR_SAO` market contains multiple cities with different special-request availability — config stores city in `lalamoveLocationConfig.data.city`. (Recorded in CLAUDE.md "Carrier Services" section.)

### Proposed fix direction
At each programmatic call site, look up `lalamoveSpecialRequests[market]` (filtered by city when applicable) and pass as the 7th argument.

### Acceptance criteria
- [ ] When `lalamoveSpecialRequests[market]` non-empty, array passed to every Lalamove quote call.
- [ ] Quotes reflect special-request surcharge where applicable.

---

## Issue 7 — `[epic] collapse optimizeByVRP and optimizeByCarrierQuotation into one path`

**Labels:** `optimizer`, `epic`, `severity-3`, `tech-debt`
**Title:** `[epic] collapse optimizeByVRP and optimizeByCarrierQuotation into one path`

### Summary
After Issues 2 + 5 + 6 ship, two parallel optimization paths remain: the UI's `optimizeByVRP` (Google Routes-based) and the programmatic `optimizeByCarrierQuotation` (Lalamove-pricing-only). Operators get different clusterings depending on which path runs. ~2-week project, files as an epic with sub-issues. Does not block day-zero work.

### Evidence
- `optimizeByVRP` at [carrier-quotation-optimizer.server.ts:1504](../../app/services/carrier-quotation-optimizer.server.ts#L1504).
- `optimizeByCarrierQuotation` at [carrier-quotation-optimizer.server.ts:670](../../app/services/carrier-quotation-optimizer.server.ts#L670).

### Proposed fix direction
Audit divergences. Pick one. Migrate callers. Remove the loser.

### Acceptance criteria
- [ ] Single optimization function across all call sites.
- [ ] No call site imports both functions.
- [ ] Removed function fully deleted.

---

## Issue 8 — `[optimizer] hardcoded tuning constants instead of per-tenant config`

**Labels:** `optimizer`, `multi-tenant`, `severity-2`, `day-zero`
**Title:** `[optimizer] hardcoded tuning constants instead of per-tenant config`

### Summary
Multiple optimizer constants are hardcoded across the codebase: `CLAUDE_OPTIMIZE_MAX_ROUTES = 20`, `CLAUDE_OPTIMIZE_TARGET_PER_ROUTE = 5`, the `10` from Issue 3, and various detour/proximity thresholds. Invisible while gebeauty is the only tenant; hostile defaults the moment a second tenant has different driver capacity, fleet density, or city geography.

### Defect class
Multi-tenant readiness.

### Proposed fix direction
Move each constant onto `LalamoveConfig` (or `CarrierServiceConfigData`) as an `OptimizerTuning` record. Defaults preserved as code-level constants but read from config first. Admin UI surfaces them under "Advanced" per location.

### Acceptance criteria
- [ ] Every numeric tuning parameter readable per-tenant from config.
- [ ] Defaults match today's hardcoded values to avoid behavior change for existing tenants.
- [ ] Admin UI exposes the fields with inline help text.

---

## Filing plan after approval

```bash
# One gh call per issue, in this order:
gh issue create --title "..." --body "..." --label optimizer,pod-mismatch,severity-5,day-zero    # Issue 1
gh issue create --title "..." --body "..." --label optimizer,cost-aware,severity-5,day-zero       # Issue 2
gh issue create --title "..." --body "..." --label optimizer,capacity-overflow,severity-4,day-zero # Issue 3
gh issue create --title "..." --body "..." --label state,severity-4,day-zero                       # Issue 4
gh issue create --title "..." --body "..." --label optimizer,service-type,severity-3,day-zero      # Issue 5
gh issue create --title "..." --body "..." --label optimizer,pricing,severity-3,day-zero           # Issue 6
gh issue create --title "..." --body "..." --label optimizer,epic,severity-3,tech-debt             # Issue 7
gh issue create --title "..." --body "..." --label optimizer,multi-tenant,severity-2,day-zero      # Issue 8
```

Labels that don't yet exist will be created with `gh label create` first (one batch call).
