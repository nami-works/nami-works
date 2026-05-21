# Session Handover — 2026-03-31

## What was done

### VRP Solver Implementation (complete)
- **Replaced all previous optimizers** with `optimizeByVRP()` in `carrier-quotation-optimizer.server.ts` using Clarke-Wright savings algorithm + Google Distance Matrix API for real road distances
- **Deleted legacy optimizer files**: `google-routes-optimizer.server.ts`, `google-routes-optimizer-topological.server.ts`, `google-routes-optimizer-inward.server.ts`
- **Deleted corridor optimizer**: removed `optimizeByCorridors()` and all corridor-specific code (~578 lines), `fetchCorridorPolyline()`, duplicate `decodePolyline()`, corridor constants
- **Renamed types**: `CorridorRouteResult` -> `VRPRouteResult`, `CorridorQuotationResult` -> `VRPQuotationResult`

### Google API Cost Reduction (complete, ~$390/year saved)
- **Eliminated `DirectionsService.route()`** from all 3 map rendering contexts (main map, manage-route modal, selected orders) — replaced with `google.maps.Polyline` using stored polylines
- **Removed `computePrecomputedRoutes()`** from loader — was calling Google Routes API on every page load
- **Removed routing logic selector** from Map Style modal (was `distance | topological | inward | carrier-quotation`)
- **Removed "Check routes" button** + `refresh-route-stats` server action + `refreshStatsFetcher`
- **Removed waypoint optimize effect** (`pendingRouteOptimize` / `routeOptimizeQueue`)
- **Removed address normalization geocoding** from `auto-routing.server.ts` webhook
- **Optimized carrier rates geocoding** — origin uses stored `LalamoveLocationConfig.pickupLat/pickupLng`
- **Added persistent geocode cache** — `GeocodeCacheEntry` Prisma model, DB-backed cache in `geocode.server.ts` (90-day TTL)

### Route Polyline Cache (complete)
- **`RoutePolylineCache` Prisma model** keyed by `(shop, locationId, sortedOrderIds)`
- **Cache write** after VRP optimization, **cache read** in loader via `lookupCachedPolylines()`
- **Polyline preservation fix** — `routeStats` sync effect used order-sensitive comparison (`every((id, j) => id === orderIds[j])`) that wiped polylines after loader revalidation. Fixed to set-based comparison.

### i18n Cleanup (complete)
- Removed dead translation keys: `checkRoutes`, `checkRoutesLoading`, `routingLogic`, `distanceFirst`, `topological`, `inwardMatrix`, `carrierQuotation` (both en and pt-BR)

## Key decisions

1. **VRP via Clarke-Wright, not OR-Tools** — OR-Tools requires C++/Python bindings. Clarke-Wright is ~60 lines of TypeScript, O(N^2 log N), and produces near-optimal solutions. Same API cost as corridor approach (~$0.06-0.07 per run).

2. **Distance Matrix for clustering, Routes API for rendering** — Google Distance Matrix gives real road distances for all pairs (~$0.02 for 15 orders). Routes API only called for final polyline rendering (~$0.04 for 4 routes). Both cached.

3. **Min-3 enforcement and consolidation merged into Phase 4** — User requested merging these since both aim to reduce route count. Min-3 steals/merges first, then Lalamove validation + R$14 surcharge consolidation.

4. **Polylines only from optimization, not page load** — No Google API calls on page load. Cached polylines from DB render instantly. Fresh orders show as straight-line connectors until next Auto-assign.

## What's pending

### Bug: Polyline not refreshed after manual route changes (HIGH PRIORITY)
**Root cause**: Polylines are only generated during `optimizeByVRP()`. Manual changes (unassign/assign) update `editableRoutes.orderIds` but leave `polyline` stale.

**Specific issues**:
1. **Unassign order** (`unassignSingleOrderFromRoute` at line ~2658): Updates `orderIds` but keeps old polyline showing the removed order's path
2. **Manual assign** (assign handler starting ~line 2394): Adds order to route's `orderIds` but polyline doesn't include the new stop
3. **Route manager card not reset after manual assign**: Still shows old cost, "Request driver" button dispatches without the newly added order
4. **Polylines fall back to haversine after manual changes**: The `routeStats` sync effect (line ~552) eventually runs, and if order composition changed, polyline gets wiped to `""` -> straight lines

**Fix strategy**: After any manual route modification (assign/unassign), clear the polyline for the affected route(s) by setting `polyline: ""` explicitly. This gives immediate visual feedback (straight-line connectors). Optionally, trigger a background `computeRoutePolyline()` call for just the affected route — but this adds a Google API call per manual change. The simpler approach: just show straight lines for manually modified routes until the next Auto-assign.

**Files to modify**:
- `app/routes/app.local-delivery.tsx`:
  - `unassignSingleOrderFromRoute()` (~line 2658): Add `polyline: ""` to the route update
  - `handleUnassignRoute()` (~line 1947): Same — clear polyline when clearing all orders from a route
  - Assign handler (~line 2394): Clear polyline on the target route when orders are added
  - Route manager card: Reset cost/dispatch state when route composition changes

### Bug: Lalamove Cancel has no proper UI feedback (MEDIUM PRIORITY)
**Current behavior**: Cancel works server-side but UI just shows a brief "Cancelling..." message via `lalamoveStatus`, then the status badge disappears because `dispatchedRoutes` entry is deleted (line 2052-2055).

**Expected behavior (per user spec)**:
- **On success**:
  - Display temporary red badge "Request cancelled"
  - Re-enable original state: row 1 = `[Manage] [Request quote]`, row 2 = badge `{Ready for delivery}`
- **On failure**:
  - Display permanent "Request could not be cancelled" at badge position
  - Below badge, show link-styled button "Go to Lalamove" linking to `https://web.lalamove.com/`

**Current cancel handler** (line ~2036-2066):
- Success path: sets `lalamoveStatus[routeId]` with success message, deletes `dispatchedRoutes[routeId]`
- Failure path: sets `lalamoveStatus[routeId]` with error message

**Fix strategy**:
- Success: Keep the temporary status message (already works), but ensure the route card re-renders with `[Manage] [Request quote]` buttons. The `dispatchedRoutes` deletion already does this — verify the card rendering logic shows the right buttons when `dispatchedRoutes[routeId]` is absent.
- Failure: The error message is already set. Need to add the "Go to Lalamove" link. Find the route card rendering section and add a conditional `<a href="https://web.lalamove.com/" target="_blank">` when `lalamoveStatus[routeId].tone === "critical"`.

**Files to modify**:
- `app/routes/app.local-delivery.tsx`: Route card rendering section (search for `lalamoveStatus` usage in JSX, around the route cards in the Route Manager)

## Modified files

### Core optimizer (complete)
- `app/services/carrier-quotation-optimizer.server.ts` — VRP solver added, corridor code deleted, types renamed
- `app/services/google-routes-shared.server.ts` — `fetchCorridorPolyline` + duplicate `decodePolyline` removed

### Deleted files (complete)
- `app/services/google-routes-optimizer.server.ts` — deleted
- `app/services/google-routes-optimizer-topological.server.ts` — deleted
- `app/services/google-routes-optimizer-inward.server.ts` — deleted

### Route UI (complete but has pending bugs)
- `app/routes/app.local-delivery.tsx` — VRP wired, DirectionsService eliminated, routing logic selector removed, Check routes removed, polyline cache loading, set-based order comparison fix. **Pending: manual assign/unassign polyline refresh + cancel UX**

### Google API reduction (complete)
- `app/services/auto-routing.server.ts` — Address normalization geocoding removed
- `app/routes/api.carrier-rates.tsx` — Origin uses stored coordinates instead of geocoding
- `app/services/carrier/geocode.server.ts` — Persistent DB cache added (Prisma-backed, 90-day TTL)

### Schema (complete)
- `prisma/schema.prisma` — Added `GeocodeCacheEntry` + `RoutePolylineCache` models
- Migration `20260331170151_add_geocode_cache` applied locally

### i18n (complete)
- `app/i18n/locales/en/local-delivery.json` — Removed dead keys
- `app/i18n/locales/pt-BR/local-delivery.json` — Removed dead keys

## Current state

- **Typecheck passes**: `npm run typecheck` clean
- **VRP optimizer works**: Tested on GE Beauty store, produces routes with road polylines
- **Polyline rendering works**: After Auto-assign, routes show road paths on the map
- **Polyline preservation works**: Switching locations and back preserves polylines (set-based comparison fix deployed)
- **Not yet committed**: All changes are unstaged in the working tree
- **Migration exists**: `20260331170151_add_geocode_cache` — creates both `GeocodeCacheEntry` and `RoutePolylineCache` tables

## Recommended next steps

1. **Fix polyline refresh on manual route changes** — Clear polyline when orders are unassigned/assigned. See "Bug: Polyline not refreshed" above for exact file locations and fix strategy.

2. **Fix Lalamove cancel UI feedback** — Add proper success/failure states per user spec. See "Bug: Lalamove Cancel" above for exact behavior and file locations.

3. **Commit and deploy** — The VRP solver, Google API cost reduction, and polyline cache are all working. Commit them as a single feature commit, then deploy.

4. **Update `docs/routing-strategy.md`** — Currently documents the old carrier-quotation optimizer. Should reflect the VRP approach (Clarke-Wright + Distance Matrix).

## Context the next session needs

- **`optimizeByVRP()` function signature** includes `shop: string` parameter (5th arg) — needed for polyline DB cache. The call site at `app.local-delivery.tsx` line ~6848 passes it.

- **`VRPRouteResult.corridorPolyline`** — the field name says "corridor" but it's actually the multi-stop render polyline from `computeRoutePolyline()`. The server action maps it to `polyline` in the response (line ~6896). Renaming would be a nice cleanup.

- **The polyline overwrite bug fix** at line ~552: The `routeStats` sync effect compares order sets to decide whether to keep the existing polyline. It uses `new Set()` + `.has()` (set-based). If orders change -> `polyline: ""` -> straight lines. This is correct behavior, but the manual assign/unassign handlers should proactively clear the polyline to avoid showing stale road paths.

- **Route card state** depends on `dispatchedRoutes[routeId]`, `lalamoveStatus[routeId]`, and `routeQuoteTotals[routeId]`. When a route's orders change, `routeQuoteTotals` becomes stale (shows old cost). The card should detect order composition changes and clear the cached quote.

- **Log group for GE Beauty**: `MSYS_NO_PATHCONV=1 aws logs tail '/ecs/omnify-gebeauty'` — must use `MSYS_NO_PATHCONV=1` on Windows Git Bash.

- **`clusterCentroid()` is a private function** in `carrier-quotation-optimizer.server.ts` used by the VRP's force-merge logic for max-routes enforcement. It uses haversine centroids, which is acceptable for this purpose (just finding nearest cluster, not routing decisions).
