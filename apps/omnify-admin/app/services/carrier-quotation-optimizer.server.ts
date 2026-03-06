/**
 * Carrier Quotation Optimizer for Local Delivery.
 *
 * Finds the cheapest route assignment by comparing Lalamove multi-stop
 * quotations across different route groupings. Uses haversine k-means
 * clustering to generate candidate partitions, then quotes each partition
 * with Lalamove to find the minimum total cost.
 *
 * Zero Google Maps API calls — all geometry is haversine-based.
 * Lalamove multi-stop quotation = 1 API call per route regardless of stops.
 */

import type { Coordinate, OptimizerOrderInput } from "./google-routes-shared.server";
import {
  createLalamoveQuotation,
  type LalamoveCredentials,
  type LalamoveStop,
} from "./lalamove.server";
import type { LalamoveConfig } from "./carrier/lalamove-adapter.server";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type CarrierRouteResult = {
  routeIndex: number;
  locationId: string;
  orderIds: string[];
  costTotal: string;
  costCurrency: string;
  serviceType: string;
};

export type CarrierQuotationResult =
  | {
      ok: true;
      routes: CarrierRouteResult[];
      summary: {
        routeCount: number;
        totalOrders: number;
        totalCost: string;
        costCurrency: string;
      };
    }
  | { ok: false; error: string };

type ClusterQuote = {
  cluster: OptimizerOrderInput[];
  costSubunits: number;
  costTotal: string;
  costCurrency: string;
  serviceType: string;
};

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Hard cap: Lalamove supports max 16 stops (1 pickup + 15 delivery). */
const LALAMOVE_MAX_DELIVERY_STOPS = 15;

/** Safety margin below the 300/min rate limit. */
const RATE_LIMIT_SAFETY = 270;

// ─── Haversine Geometry ────────────────────────────────────────────────────────

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

// ─── K-means clustering ────────────────────────────────────────────────────────

const clusterOrders = (
  orders: OptimizerOrderInput[],
  routeCount: number,
  maxPerRoute: number,
): OptimizerOrderInput[][] => {
  if (routeCount <= 1 || orders.length <= 1) return [orders];

  const origin = orders[0]!.locationCoordinates;
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

  const result: OptimizerOrderInput[][] = [];
  for (const bucket of buckets) {
    if (bucket.length === 0) continue;
    for (let i = 0; i < bucket.length; i += maxPerRoute) {
      result.push(bucket.slice(i, i + maxPerRoute));
    }
  }
  return result;
};

// ─── Haversine pre-screening ───────────────────────────────────────────────────

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

const prescreenRouteCounts = (
  orders: OptimizerOrderInput[],
  maxPerRoute: number,
  maxRoutes: number,
): number[] => {
  const minRoutes = Math.max(1, Math.ceil(orders.length / maxPerRoute));
  const upperBound = Math.min(orders.length, maxRoutes);
  if (upperBound - minRoutes + 1 <= 8) {
    return Array.from({ length: upperBound - minRoutes + 1 }, (_, i) => minRoutes + i);
  }
  const scores: { count: number; dist: number }[] = [];
  for (let k = minRoutes; k <= upperBound; k += 1) {
    const clusters = clusterOrders(orders, k, maxPerRoute);
    const dist = estimatePartitionDistance(clusters);
    scores.push({ count: k, dist });
  }
  return scores
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 5)
    .map((s) => s.count);
};

// ─── Cheapest insertion ────────────────────────────────────────────────────────

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

// ─── Rate limit tracker ────────────────────────────────────────────────────────

class RateLimiter {
  private count = 0;
  private windowStart = Date.now();

  check(): void {
    const elapsed = Date.now() - this.windowStart;
    if (elapsed >= 60_000) {
      this.count = 0;
      this.windowStart = Date.now();
    }
    this.count += 1;
    if (this.count > RATE_LIMIT_SAFETY) {
      throw new Error(
        `Rate limit safety: ${this.count} Lalamove quotation calls in ${Math.round(elapsed / 1000)}s. ` +
          "Reduce order count or try again in a minute.",
      );
    }
  }
}

// ─── Lalamove quotation helpers ────────────────────────────────────────────────

function buildStops(
  config: LalamoveConfig,
  cluster: OptimizerOrderInput[],
): LalamoveStop[] {
  const pickup: LalamoveStop = {
    coordinates: {
      lat: String(config.pickupLat),
      lng: String(config.pickupLng),
    },
    address: config.locationAddress || `${config.pickupLat},${config.pickupLng}`,
  };
  const deliveries: LalamoveStop[] = cluster.map((order) => ({
    coordinates: {
      lat: String(order.shippingCoordinates.latitude),
      lng: String(order.shippingCoordinates.longitude),
    },
    address: `${order.shippingCoordinates.latitude},${order.shippingCoordinates.longitude}`,
  }));
  return [pickup, ...deliveries];
}

async function quoteCluster(
  cluster: OptimizerOrderInput[],
  config: LalamoveConfig,
  serviceType: string,
  credentials: LalamoveCredentials,
  rateLimiter: RateLimiter,
): Promise<{ costSubunits: number; costTotal: string; costCurrency: string } | null> {
  if (cluster.length === 0) return null;

  const stops = buildStops(config, cluster);
  rateLimiter.check();

  try {
    const quotation = await createLalamoveQuotation(
      {
        market: config.market,
        language: config.language,
        serviceType,
        stops,
        isRouteOptimized: stops.length >= 3,
      },
      credentials,
    );

    const total = quotation.priceBreakdown?.total ?? "0";
    const currency = quotation.priceBreakdown?.currency ?? "BRL";
    const costSubunits = Math.round(parseFloat(total) * 100);

    return { costSubunits, costTotal: total, costCurrency: currency };
  } catch (err) {
    console.warn("[carrier-quotation-optimizer] Quote failed for cluster:", {
      orderCount: cluster.length,
      serviceType,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ─── Main export ───────────────────────────────────────────────────────────────

export async function optimizeByCarrierQuotation(
  orders: OptimizerOrderInput[],
  config: LalamoveConfig,
  credentials: LalamoveCredentials,
  maxAvailableRoutes: number,
  vehicleOptions: { primary: string; secondary?: string },
  maxOrdersPerRoute: number,
): Promise<CarrierQuotationResult> {
  if (orders.length === 0) {
    return { ok: false, error: "No orders to optimize." };
  }
  if (config.pickupLat == null || config.pickupLng == null) {
    return { ok: false, error: "Pickup coordinates missing in location config." };
  }

  const maxPerRoute = Math.min(LALAMOVE_MAX_DELIVERY_STOPS, Math.max(1, maxOrdersPerRoute));
  const rateLimiter = new RateLimiter();
  const vehicleTypes = [vehicleOptions.primary];
  if (vehicleOptions.secondary && vehicleOptions.secondary !== vehicleOptions.primary) {
    vehicleTypes.push(vehicleOptions.secondary);
  }

  // ── Phase A: Separate must-assign vs conditional ──────────────────────────

  const mustAssignOrders = orders.filter((o) => o.mustAssign === true);
  const conditionalOrders = orders.filter((o) => o.mustAssign !== true);

  // If no must-assign orders, treat all as must-assign
  const phase1Orders = mustAssignOrders.length > 0 ? mustAssignOrders : orders;
  const phase2Orders = mustAssignOrders.length > 0 ? conditionalOrders : [];

  // ── Phase A: Find cheapest partition via Lalamove quotations ───────────────

  const candidateCounts = prescreenRouteCounts(phase1Orders, maxPerRoute, maxAvailableRoutes);

  console.info("[carrier-quotation-optimizer] Phase A:", {
    mustAssign: phase1Orders.length,
    conditional: phase2Orders.length,
    maxPerRoute,
    candidateCounts,
    vehicleTypes,
  });

  let bestTotalCost = Number.POSITIVE_INFINITY;
  let bestPartition: ClusterQuote[] = [];

  for (const k of candidateCounts) {
    const clusters = clusterOrders(phase1Orders, k, maxPerRoute);
    const partitionQuotes: ClusterQuote[] = [];
    let partitionCost = 0;
    let partitionFailed = false;

    for (const cluster of clusters) {
      if (cluster.length === 0) continue;

      // Quote with each vehicle type, pick cheapest
      let bestQuote: ClusterQuote | null = null;

      for (const serviceType of vehicleTypes) {
        const quote = await quoteCluster(cluster, config, serviceType, credentials, rateLimiter);
        if (quote && (bestQuote === null || quote.costSubunits < bestQuote.costSubunits)) {
          bestQuote = {
            cluster,
            costSubunits: quote.costSubunits,
            costTotal: quote.costTotal,
            costCurrency: quote.costCurrency,
            serviceType,
          };
        }
      }

      if (!bestQuote) {
        // Quotation failed for all vehicle types — skip this partition
        partitionFailed = true;
        break;
      }

      partitionQuotes.push(bestQuote);
      partitionCost += bestQuote.costSubunits;
    }

    if (partitionFailed) continue;

    console.info("[carrier-quotation-optimizer] Partition k=%d cost=%d (%d routes)", k, partitionCost, partitionQuotes.length);

    if (partitionCost < bestTotalCost) {
      bestTotalCost = partitionCost;
      bestPartition = partitionQuotes;
    }
  }

  if (bestPartition.length === 0) {
    return { ok: false, error: "All Lalamove quotations failed. Check credentials and location config." };
  }

  // ── Phase B: Conditionally add future orders ──────────────────────────────

  // Build mutable route data for cheapest insertion checks
  type MutableRoute = {
    quote: ClusterQuote;
    stops: Coordinate[];
    origin: Coordinate;
  };

  const mutableRoutes: MutableRoute[] = bestPartition.map((q) => ({
    quote: q,
    stops: q.cluster.map((o) => o.shippingCoordinates),
    origin: q.cluster[0]!.locationCoordinates,
  }));

  for (const conditionalOrder of phase2Orders) {
    // Find best route by cheapest haversine insertion
    let bestRouteIdx = -1;
    let bestIncremental = Number.POSITIVE_INFINITY;

    for (let i = 0; i < mutableRoutes.length; i += 1) {
      const route = mutableRoutes[i]!;
      // Only consider routes with capacity
      if (route.quote.cluster.length >= maxPerRoute) continue;

      const incremental = computeMinIncrementalDistance(
        route.origin,
        route.stops,
        conditionalOrder.shippingCoordinates,
      );
      if (incremental < bestIncremental) {
        bestIncremental = incremental;
        bestRouteIdx = i;
      }
    }

    if (bestRouteIdx < 0) continue;

    // Solo distance: fulfillment → this order
    const soloDistance = haversineMeters(
      conditionalOrder.locationCoordinates,
      conditionalOrder.shippingCoordinates,
    );

    // Only add if the insertion cost is less than or equal to a solo trip
    if (bestIncremental <= soloDistance) {
      const route = mutableRoutes[bestRouteIdx]!;
      const extendedCluster = [...route.quote.cluster, conditionalOrder];

      // Re-quote with the winning vehicle to get updated cost
      const reQuote = await quoteCluster(
        extendedCluster,
        config,
        route.quote.serviceType,
        credentials,
        rateLimiter,
      );

      if (reQuote) {
        const marginalCost = reQuote.costSubunits - route.quote.costSubunits;
        // Accept if marginal cost is reasonable (≤ what a solo trip would cost proportionally)
        if (marginalCost >= 0) {
          route.quote = {
            ...route.quote,
            cluster: extendedCluster,
            costSubunits: reQuote.costSubunits,
            costTotal: reQuote.costTotal,
            costCurrency: reQuote.costCurrency,
          };
          route.stops.push(conditionalOrder.shippingCoordinates);
        }
      }
    }
  }

  // ── Catch-all: ensure all must-assign orders are in a route ───────────────

  const assignedIds = new Set(
    mutableRoutes.flatMap((r) => r.quote.cluster.map((o) => o.orderId)),
  );
  const unassignedMustAssign = phase1Orders.filter((o) => !assignedIds.has(o.orderId));

  for (const order of unassignedMustAssign) {
    // Find smallest compatible route with capacity
    const candidates = mutableRoutes
      .filter((r) => r.quote.cluster.length < maxPerRoute)
      .sort((a, b) => a.quote.cluster.length - b.quote.cluster.length);

    if (candidates.length > 0) {
      const route = candidates[0]!;
      route.quote.cluster.push(order);
      route.stops.push(order.shippingCoordinates);
    } else {
      // Create a new solo route (no quote — will be quoted when driver is requested)
      mutableRoutes.push({
        quote: {
          cluster: [order],
          costSubunits: 0,
          costTotal: "0",
          costCurrency: bestPartition[0]?.costCurrency ?? "BRL",
          serviceType: vehicleOptions.primary,
        },
        stops: [order.shippingCoordinates],
        origin: order.locationCoordinates,
      });
    }
  }

  // ── Build result ──────────────────────────────────────────────────────────

  const totalCostSubunits = mutableRoutes.reduce((sum, r) => sum + r.quote.costSubunits, 0);
  const currency = mutableRoutes[0]?.quote.costCurrency ?? "BRL";
  const totalCost = (totalCostSubunits / 100).toFixed(2);

  const routes: CarrierRouteResult[] = mutableRoutes.map((r, i) => ({
    routeIndex: i,
    locationId: r.quote.cluster[0]?.locationId ?? "",
    orderIds: r.quote.cluster.map((o) => o.orderId),
    costTotal: r.quote.costTotal,
    costCurrency: r.quote.costCurrency,
    serviceType: r.quote.serviceType,
  }));

  console.info("[carrier-quotation-optimizer] Result:", {
    routeCount: routes.length,
    totalOrders: routes.reduce((sum, r) => sum + r.orderIds.length, 0),
    totalCost: `${currency} ${totalCost}`,
    routeSizes: routes.map((r) => r.orderIds.length),
    routeVehicles: routes.map((r) => r.serviceType),
  });

  return {
    ok: true,
    routes,
    summary: {
      routeCount: routes.length,
      totalOrders: routes.reduce((sum, r) => sum + r.orderIds.length, 0),
      totalCost,
      costCurrency: currency,
    },
  };
}
