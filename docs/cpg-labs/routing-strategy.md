# Local Delivery Routing Strategy — Comprehensive Reference

## Overview

The local delivery system optimizes delivery routes for a Shopify embedded app. It assigns orders to routes (grouped deliveries) and dispatches them via Lalamove (a last-mile delivery platform). The optimization balances **actual delivery cost** (Lalamove quotes) against a **fixed wait-time surcharge** per route.

---

## Cost Model

```
totalCost = Σ(lalamove_quote_per_route) + numberOfRoutes × R$14.00
```

- **Lalamove quote**: The real price Lalamove charges for a multi-stop route. FREE to query via API.
- **Wait surcharge**: R$14.00 (1400 subunits) per route — a fixed business cost for driver wait time at each delivery stop. Fewer routes = fewer surcharges.
- This creates a strong incentive to **consolidate orders into fewer routes**, even if individual route quotes are slightly higher.

---

## Two Optimization Paths

### 1. Auto-Assign (Webhook — Real-Time)

**Trigger:** `orders/create` webhook fires for each new confirmed LOCAL delivery order.

**Algorithm:** Pure haversine k-means clustering (zero external API calls).

**File:** `app/services/auto-routing.server.ts`

**Flow:**
1. Validate order is confirmed, has LOCAL delivery method, has coordinates
2. Load Lalamove location config for the fulfillment location
3. Fetch all existing open pending routes for that location
4. Build full order pool: existing route stops + new order
5. Run `clusterOrders()` with k-means (12 iterations), enforcing min-3 orders per route
6. Atomically replace all open routes with new clustered groupings
7. Fallback: solo route if only 1 order or clustering fails

**Key properties:**
- No Lalamove API calls, no Google API calls — pure geometry
- Runs in <50ms for typical 10-25 order batches
- Min-3 enforcement with directional isolation exception
- The merchant will run "Optimize fleet" later for full cost optimization

### 2. Manual Optimize Fleet (UI — On-Demand)

**Trigger:** Merchant clicks "Auto-assign" in the Local Delivery UI (which triggers "optimize-fleet" with `routingLogic: "carrier-quotation"`).

**Algorithm:** Haversine k-means → Lalamove quotation comparison → route consolidation.

**File:** `app/services/carrier-quotation-optimizer.server.ts`

**Flow:**

#### Phase A: Find cheapest partition
1. Separate orders into `mustAssign` (due today) vs `conditional` (future)
2. Pre-screen candidate route counts (k = minRoutes to maxRoutes) using haversine distance estimates
3. For each candidate k:
   - Run k-means clustering (12 iterations, angular seeding)
   - Enforce min-3 orders per route (with steal + merge logic)
   - Quote each cluster with Lalamove API (primary + secondary vehicle types)
   - Pick cheapest vehicle per cluster
   - Calculate: `partitionCost = Σ(quotes) + k × R$14`
4. Select partition with minimum total cost

#### Phase B: Conditional orders
1. For each conditional order, find the route with cheapest haversine insertion
2. Only add if insertion cost ≤ solo trip distance
3. Re-quote extended route with Lalamove to validate

#### Phase C: Post-optimization consolidation
1. Find pairs of routes where combined order count ≤ maxPerRoute
2. For each pair: `separateCost = quote_i + quote_j + 2×R$14`, `mergedCost = merged_quote + 1×R$14`
3. If `mergedCost < separateCost` → merge
4. Cap at 3 iterations to limit API calls

#### Final min-3 enforcement
- After all phases, any remaining route with < 3 orders either:
  - **Steals** nearby orders from larger routes (with on-the-way directional check)
  - **Merges** into the nearest compatible route
  - **Kept as exception** only if directionally isolated (>1km AND >120° from all others)

---

## Min-3 Orders Per Route — Enforcement Logic

**Constraint:** Each route should have at least 3 orders, except when orders are genuinely in opposite directions.

**Two-strategy approach (applied at clustering time AND after all optimization phases):**

### Strategy A: Steal nearby orders
Before dissolving an undersized route, try to grow it by pulling orders from larger routes:

1. Compute the orphan route's bearing from depot (polar angle)
2. For each order in other routes (that have > 3 orders):
   - Compute the order's bearing from depot
   - Compute the source route's bearing from depot (depot → centroid)
   - **On-the-way check:** If `angleDiff(order, sourceRoute) < angleDiff(order, orphan)` → skip (order belongs to its current route's trajectory)
3. Sort eligible candidates by distance to orphan centroid
4. Pull closest ones until orphan reaches 3 orders
5. Source routes must keep ≥ 3 after losing orders

### Strategy B: Merge (fallback)
If stealing can't reach 3 orders:
1. Find nearest cluster with capacity
2. If within 1km → always merge (proximity overrides angle)
3. If directionally isolated (>1km AND >120° from all others) → keep as exception
4. Otherwise → merge into nearest

---

## Directional Isolation Check

An order/cluster is "directionally isolated" when BOTH conditions hold:
1. Its polar angle from depot differs by > 120° from ALL other cluster centroids
2. Its haversine distance to the nearest other cluster centroid exceeds 1km

This prevents splitting nearby orders just because they're at different angles from the depot.

---

## Polyline Generation (On-Demand)

Polylines are NOT generated during optimization. They are computed on-demand when the merchant clicks "Check routes" in the actions menu.

**API:** Google Routes API v2 `computeRoutes` (TRAFFIC_AWARE, $0.01/request)

**File:** `app/services/google-routes-shared.server.ts` → `computeRoutePolyline()`

**Flow:**
1. User clicks "Check routes" → submits `intent=refresh-route-stats`
2. For each route: fetch location coords + order coords via GraphQL
3. Call `computeRoutePolyline()` → returns polyline, distance, duration
4. Also re-quotes each route via Lalamove for updated cost
5. Results displayed on map + route cards

---

## Key Constants

| Constant | Value | Location |
|----------|-------|----------|
| `WAIT_SURCHARGE_SUBUNITS` | 1400 (R$14.00) | `carrier-quotation-optimizer.server.ts` |
| `MIN_ORDERS_PER_ROUTE` | 3 | `carrier-quotation-optimizer.server.ts` |
| `DIRECTIONAL_ISOLATION_RAD` | 2π/3 (120°) | `carrier-quotation-optimizer.server.ts` |
| `PROXIMITY_MERGE_METERS` | 1000 (1km) | `carrier-quotation-optimizer.server.ts` |
| `LALAMOVE_MAX_DELIVERY_STOPS` | 15 | `carrier-quotation-optimizer.server.ts` |
| `MAX_ORDERS_PER_ROUTE` | 20 | `google-routes-shared.server.ts` |
| `RATE_LIMIT_SAFETY` | 270 calls/min | `carrier-quotation-optimizer.server.ts` |

---

## API Usage Summary

| Operation | Lalamove Calls | Google Calls | Cost |
|-----------|---------------|-------------|------|
| Auto-assign webhook (per order) | 0 | 0 | $0 |
| Manual optimize (15 orders, 5 candidates) | ~15-25 | 0 | $0 |
| Check routes (5 routes) | 5 | 5 | ~$0.05 |
| Consolidation phase | ~5-10 extra | 0 | $0 |

---

## File Map

| File | Purpose |
|------|---------|
| `app/services/carrier-quotation-optimizer.server.ts` | Core algorithm: k-means, Lalamove quoting, consolidation, min-3 enforcement |
| `app/services/auto-routing.server.ts` | Webhook auto-assign: haversine-only clustering |
| `app/services/google-routes-shared.server.ts` | `computeRoutePolyline()` for on-demand polylines |
| `app/services/google-routes-optimizer.server.ts` | Distance-based optimizer (legacy, still available) |
| `app/services/google-routes-optimizer-inward.server.ts` | Inward optimizer (legacy, no longer used by webhook) |
| `app/services/google-routes-optimizer-topological.server.ts` | Topological optimizer (legacy, still available) |
| `app/services/lalamove.server.ts` | Lalamove API client: quotations, orders, auth |
| `app/routes/app.local-delivery.tsx` | UI route: map, route manager, actions |

---

## Data Flow

```
Order Created → Webhook → auto-routing.server.ts
                            ↓
                    haversine k-means clustering
                            ↓
                    pendingDeliveryRoute (DB)
                            ↓
Merchant opens UI → loader → editableRoutes (React state)
                            ↓
Merchant clicks "Auto-assign" → action → carrier-quotation-optimizer.server.ts
                            ↓
                    k-means → Lalamove quotes → consolidation → min-3 enforcement
                            ↓
                    Route tags applied to Shopify orders
                            ↓
Merchant clicks "Check routes" → action → google-routes-shared.server.ts
                            ↓
                    Polylines + distance + duration rendered on map
                            ↓
Merchant clicks "Request driver" → action → lalamove.server.ts
                            ↓
                    Lalamove quotation → order placement → driver assignment
```

---

## Geometry Functions

All geometry is based on haversine (great-circle distance) and polar angles:

- **`haversineMeters(a, b)`**: Distance in meters between two lat/lng coordinates
- **`polarAngle(depot, point)`**: Bearing from depot to point in radians (atan2 with longitude correction for latitude)
- **`angleDiff(a, b)`**: Absolute angular difference normalized to [0, π]
- **`clusterCentroid(cluster)`**: Average lat/lng of all orders in a cluster
- **`isDirectionallyIsolated(centroid, others, depot)`**: True when >120° from all others AND >1km away
- **`enforceMinOrdersPerRoute(clusters, depot, maxPerRoute)`**: Steal-or-merge to ensure min 3 per route
- **`clusterOrders(orders, routeCount, maxPerRoute)`**: k-means with 12 iterations + min-3 enforcement

All exported from `carrier-quotation-optimizer.server.ts`.
