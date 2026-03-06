import {
  type Coordinate,
  type OptimizerOrderInput,
  type OptimizerRouteResult,
  type OptimizeFleetResult,
  computeRoutePolyline,
  MAX_WAYPOINTS_PER_ROUTE,
  MAX_ORDERS_PER_ROUTE,
} from "./google-routes-shared.server";
import { optimizeFleetRoutesTopological } from "./google-routes-optimizer-topological.server";
import { optimizeFleetRoutesInward } from "./google-routes-optimizer-inward.server";

export type { OptimizerOrderInput, OptimizerRouteResult, OptimizeFleetResult };

export type RoutingLogic = "distance" | "topological" | "inward" | "carrier-quotation";

export async function optimizeFleetRoutesDispatcher(
  apiKey: string,
  orders: OptimizerOrderInput[],
  logic: RoutingLogic = "distance",
): Promise<OptimizeFleetResult> {
  switch (logic) {
    case "topological":
      return optimizeFleetRoutesTopological(apiKey, orders);
    case "inward":
      return optimizeFleetRoutesInward(apiKey, orders);
    case "carrier-quotation":
      throw new Error("carrier-quotation must be handled by the action, not the optimizer");
    default:
      return optimizeFleetRoutes(apiKey, orders);
  }
}

const toRadians = (value: number) => (value * Math.PI) / 180;

const haversineMeters = (a: Coordinate, b: Coordinate) => {
  const R = 6371000;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

const nearestCentroidIndex = (point: Coordinate, centroids: Coordinate[]) => {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < centroids.length; i += 1) {
    const distance = haversineMeters(point, centroids[i]!);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
};

const recenter = (points: Coordinate[]) => {
  if (points.length === 0) return null;
  const sum = points.reduce(
    (acc, point) => ({
      latitude: acc.latitude + point.latitude,
      longitude: acc.longitude + point.longitude,
    }),
    { latitude: 0, longitude: 0 },
  );
  return {
    latitude: sum.latitude / points.length,
    longitude: sum.longitude / points.length,
  };
};

/**
 * Origin-aware k-means clustering.
 * Seeds centroids by sorting orders by distance from the fulfillment location,
 * ensuring each centroid starts from a different distance ring outward — not
 * from arbitrary order positions as the previous implementation did.
 */
const clusterOrders = (
  orders: OptimizerOrderInput[],
  routeCount: number,
): OptimizerOrderInput[][] => {
  if (routeCount <= 1 || orders.length <= 1) return [orders];

  const origin = orders[0]!.locationCoordinates;

  // Sort by distance from fulfillment so seeds fan outward uniformly
  const sorted = [...orders].sort(
    (a, b) =>
      haversineMeters(origin, a.shippingCoordinates) -
      haversineMeters(origin, b.shippingCoordinates),
  );

  const seedStep = Math.max(1, Math.floor(sorted.length / routeCount));
  let centroids: Coordinate[] = Array.from({ length: routeCount }, (_, i) =>
    sorted[Math.min(i * seedStep, sorted.length - 1)]!.shippingCoordinates,
  );

  let buckets: OptimizerOrderInput[][] = Array.from({ length: routeCount }, () => []);
  for (let iteration = 0; iteration < 12; iteration += 1) {
    buckets = Array.from({ length: routeCount }, () => []);
    orders.forEach((order) => {
      const index = nearestCentroidIndex(order.shippingCoordinates, centroids);
      buckets[index]!.push(order);
    });
    centroids = buckets.map((bucket, index) => {
      const center = recenter(bucket.map((item) => item.shippingCoordinates));
      return center ?? centroids[index]!;
    });
  }

  // Enforce per-route cap: split any oversized bucket into chunks of MAX_ORDERS_PER_ROUTE
  const result: OptimizerOrderInput[][] = [];
  for (const bucket of buckets) {
    if (bucket.length === 0) continue;
    for (let i = 0; i < bucket.length; i += MAX_ORDERS_PER_ROUTE) {
      result.push(bucket.slice(i, i + MAX_ORDERS_PER_ROUTE));
    }
  }
  return result;
};

/**
 * Nearest-neighbor greedy TSP estimate: origin → stops (no return).
 * Used for fast haversine pre-screening before calling the Google Routes API.
 */
const estimateRouteTotalDistance = (origin: Coordinate, stops: Coordinate[]): number => {
  if (stops.length === 0) return 0;
  let total = 0;
  let current = origin;
  const remaining = [...stops];
  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = haversineMeters(current, remaining[0]!);
    for (let i = 1; i < remaining.length; i += 1) {
      const d = haversineMeters(current, remaining[i]!);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }
    total += nearestDist;
    current = remaining[nearestIdx]!;
    remaining.splice(nearestIdx, 1);
  }
  return total;
};

const estimatePartitionDistance = (clusters: OptimizerOrderInput[][]): number =>
  clusters.reduce((sum, cluster) => {
    if (cluster.length === 0) return sum;
    const origin = cluster[0]!.locationCoordinates;
    return sum + estimateRouteTotalDistance(origin, cluster.map((o) => o.shippingCoordinates));
  }, 0);

/**
 * Pre-screens the full range of valid route counts using cheap haversine estimates,
 * returning the top 5 candidates for Google Routes API verification.
 *
 * Lower bound = enough routes to keep each at <= MAX_ORDERS_PER_ROUTE.
 * Upper bound = orders.length (one order per route — fine for haversine).
 */
const prescreenRouteCounts = (orders: OptimizerOrderInput[]): number[] => {
  const minRoutes = Math.max(1, Math.ceil(orders.length / MAX_ORDERS_PER_ROUTE));
  const maxRoutes = orders.length;
  const scores: { count: number; dist: number }[] = [];
  for (let k = minRoutes; k <= maxRoutes; k += 1) {
    const clusters = clusterOrders(orders, k);
    const dist = estimatePartitionDistance(clusters);
    scores.push({ count: k, dist });
  }
  return scores
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 5)
    .map((s) => s.count);
};

/**
 * Minimum additional haversine distance to optimally insert newStop into a route.
 * Tries every insertion position in the chain [origin, ...currentStops] and
 * returns the cheapest incremental cost.
 */
const computeMinIncrementalDistance = (
  origin: Coordinate,
  currentStops: Coordinate[],
  newStop: Coordinate,
): number => {
  const chain = [origin, ...currentStops];
  let minIncremental = Number.POSITIVE_INFINITY;
  for (let i = 0; i < chain.length; i += 1) {
    const prev = chain[i]!;
    const next = chain[i + 1] ?? null;
    const before = next ? haversineMeters(prev, next) : 0;
    const after =
      haversineMeters(prev, newStop) + (next ? haversineMeters(newStop, next) : 0);
    const incremental = after - before;
    if (incremental < minIncremental) minIncremental = incremental;
  }
  return minIncremental;
};

/**
 * Compute total distance and duration for a single route (location → orders).
 * Used to refresh route stats after manual assignment.
 */
export async function computeRouteMetrics(
  apiKey: string,
  locationCoordinates: Coordinate,
  locationId: string,
  orders: { orderId: string; shippingCoordinates: Coordinate }[],
): Promise<{ totalDistanceMeters: number; totalDurationSeconds: number }> {
  if (!apiKey.trim() || orders.length === 0) {
    return { totalDistanceMeters: 0, totalDurationSeconds: 0 };
  }
  const optimizerOrders: OptimizerOrderInput[] = orders.map((o) => ({
    orderId: o.orderId,
    locationId,
    shippingCoordinates: o.shippingCoordinates,
    locationCoordinates,
  }));
  const result = await computeRoutePolyline(apiKey, locationCoordinates, optimizerOrders);
  return {
    totalDistanceMeters: result.distanceMeters,
    totalDurationSeconds: result.durationSeconds,
  };
}

/**
 * Run the Google Routes API on the top-5 haversine-screened route counts for a
 * set of orders from one location. Returns the clustering that produces the
 * minimum total distance across all routes.
 */
const optimizeOrdersForLocation = async (
  apiKey: string,
  locationId: string,
  locationOrders: OptimizerOrderInput[],
  globalRouteIndexStart: number,
): Promise<{
  routes: OptimizerRouteResult[];
  totalDistanceMeters: number;
}> => {
  const candidateCounts = prescreenRouteCounts(locationOrders);

  let bestTotalDistance = Number.POSITIVE_INFINITY;
  let bestRouteResults: OptimizerRouteResult[] = [];

  for (const routeCount of candidateCounts) {
    const clusters = clusterOrders(locationOrders, routeCount);
    let partitionDistance = 0;
    const partitionRoutes: OptimizerRouteResult[] = [];

    for (let i = 0; i < clusters.length; i += 1) {
      const cluster = clusters[i]!;
      const locationCoordinates = cluster[0]!.locationCoordinates;
      const route = await computeRoutePolyline(apiKey, locationCoordinates, cluster);
      partitionDistance += route.distanceMeters;
      partitionRoutes.push({
        routeIndex: globalRouteIndexStart + partitionRoutes.length,
        locationId,
        orderIds: route.ordered.map((order) => order.orderId),
        polyline: route.polyline,
        totalDistanceMeters: route.distanceMeters,
        totalDurationSeconds: route.durationSeconds,
      });
    }

    if (partitionDistance < bestTotalDistance) {
      bestTotalDistance = partitionDistance;
      bestRouteResults = partitionRoutes;
    }
  }

  return { routes: bestRouteResults, totalDistanceMeters: bestTotalDistance };
};

export const optimizeFleetRoutes = async (
  apiKey: string,
  orders: OptimizerOrderInput[],
): Promise<OptimizeFleetResult> => {
  if (!apiKey.trim() || orders.length === 0) {
    return {
      routes: [],
      summary: {
        routeCount: 0,
        totalDistanceMeters: 0,
        totalDurationSeconds: 0,
        totalOrders: orders.length,
      },
    };
  }

  // --- Phase A: Separate must-assign (due today) from conditional orders ---
  const mustAssignOrders = orders.filter((o) => o.mustAssign === true);
  const conditionalOrders = orders.filter((o) => o.mustAssign !== true);

  // If there are no must-assign orders, treat everything as mandatory so we
  // still produce routes (edge case: merchant runs optimizer with only future orders).
  const phase1Orders = mustAssignOrders.length > 0 ? mustAssignOrders : orders;
  const phase2Orders = mustAssignOrders.length > 0 ? conditionalOrders : [];

  // Group phase-1 orders by fulfillment location
  const ordersByLocation = new Map<string, OptimizerOrderInput[]>();
  phase1Orders.forEach((order) => {
    const bucket = ordersByLocation.get(order.locationId) ?? [];
    bucket.push(order);
    ordersByLocation.set(order.locationId, bucket);
  });

  // --- Phase A: Optimize mandatory orders, find globally minimum-distance partition ---
  const routes: OptimizerRouteResult[] = [];
  let globalRouteIndex = 0;

  for (const [locationId, locationOrders] of ordersByLocation.entries()) {
    const { routes: locationRoutes } = await optimizeOrdersForLocation(
      apiKey,
      locationId,
      locationOrders,
      globalRouteIndex,
    );
    // Re-index sequentially across locations
    for (const r of locationRoutes) {
      routes.push({ ...r, routeIndex: globalRouteIndex++ });
    }
  }

  // --- Phase B: Conditionally assign future orders ---
  // A conditional order is slotted into an existing route only when the marginal
  // cost of adding it (haversine cheapest insertion) is <= its solo one-way distance
  // from the fulfillment location. This prevents distant orders from being silently
  // skipped while ensuring close ones don't demand a dedicated route.

  // Build mutable stop-lists for each route (for incremental distance checks)
  type RouteStopList = { routeIdx: number; origin: Coordinate; stops: Coordinate[] };
  const routeStopLists: RouteStopList[] = routes.map((r) => {
    // Reconstruct ordered stop coordinates from the route's ordered orderIds
    const routeOrigin = phase1Orders.find((o) => r.orderIds[0] && o.orderId === r.orderIds[0])
      ?.locationCoordinates ?? phase1Orders.find((o) => o.locationId === r.locationId)
      ?.locationCoordinates;

    const stops: Coordinate[] = r.orderIds
      .map((id) => phase1Orders.find((o) => o.orderId === id)?.shippingCoordinates)
      .filter((c): c is Coordinate => c !== undefined);

    return { routeIdx: r.routeIndex, origin: routeOrigin!, stops };
  });

  for (const conditionalOrder of phase2Orders) {
    // Solo one-way haversine distance: fulfillment → this order's address
    const soloDistance = haversineMeters(
      conditionalOrder.locationCoordinates,
      conditionalOrder.shippingCoordinates,
    );

    // Find the route where inserting this order costs the least
    let bestRouteIdx = -1;
    let bestIncremental = Number.POSITIVE_INFINITY;

    for (const stopList of routeStopLists) {
      // Only consider routes from the same fulfillment location
      if (!stopList.origin) continue;
      const incremental = computeMinIncrementalDistance(
        stopList.origin,
        stopList.stops,
        conditionalOrder.shippingCoordinates,
      );
      if (incremental < bestIncremental) {
        bestIncremental = incremental;
        bestRouteIdx = stopList.routeIdx;
      }
    }

    // Assign only if solo trip would cost at least as much as the incremental addition
    if (bestRouteIdx >= 0 && soloDistance >= bestIncremental) {
      const route = routes.find((r) => r.routeIndex === bestRouteIdx);
      const stopList = routeStopLists.find((s) => s.routeIdx === bestRouteIdx);
      if (route && stopList) {
        route.orderIds.push(conditionalOrder.orderId);
        stopList.stops.push(conditionalOrder.shippingCoordinates);
        // Mark as needing polyline refresh (will be done below)
        route.polyline = "";
      }
    }
  }

  const allOrdersForCatchAll = [...phase1Orders, ...phase2Orders];
  const assignedOrderIds = new Set(routes.flatMap((r) => r.orderIds));
  for (const order of allOrdersForCatchAll) {
    if (assignedOrderIds.has(order.orderId)) continue;
    const candidates = routes
      .filter(
        (r) =>
          r.locationId === order.locationId &&
          r.orderIds.length < MAX_ORDERS_PER_ROUTE,
      )
      .sort((a, b) => a.orderIds.length - b.orderIds.length);
    if (candidates.length > 0) {
      const route = candidates[0]!;
      route.orderIds.push(order.orderId);
      route.polyline = "";
      assignedOrderIds.add(order.orderId);
    } else {
      const nextIdx = routes.length;
      routes.push({
        routeIndex: nextIdx,
        locationId: order.locationId,
        orderIds: [order.orderId],
        polyline: "",
        totalDistanceMeters: 0,
        totalDurationSeconds: 0,
      });
      assignedOrderIds.add(order.orderId);
    }
  }

  // Recompute polylines for routes that received new conditional stops
  for (const route of routes) {
    if (route.polyline !== "" || route.orderIds.length === 0) continue;
    // Rebuild OptimizerOrderInput list for this route
    const allOrders = [...phase1Orders, ...phase2Orders];
    const routeOrders: OptimizerOrderInput[] = route.orderIds
      .map((id) => allOrders.find((o) => o.orderId === id))
      .filter((o): o is OptimizerOrderInput => o !== undefined);

    if (routeOrders.length === 0) continue;
    const origin = routeOrders[0]!.locationCoordinates;
    const refreshed = await computeRoutePolyline(apiKey, origin, routeOrders);
    route.polyline = refreshed.polyline;
    route.totalDistanceMeters = refreshed.distanceMeters;
    route.totalDurationSeconds = refreshed.durationSeconds;
    // Update orderIds to the Google-optimized order
    route.orderIds = refreshed.ordered.map((o) => o.orderId);
  }

  const totalDistanceMeters = routes.reduce((sum, r) => sum + r.totalDistanceMeters, 0);
  const totalDurationSeconds = routes.reduce((sum, r) => sum + r.totalDurationSeconds, 0);

  return {
    routes,
    summary: {
      routeCount: routes.length,
      totalDistanceMeters,
      totalDurationSeconds,
      totalOrders: orders.length,
    },
  };
};
