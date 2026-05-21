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
import { computeRoutePolyline } from "./google-routes-shared.server";
import {
  createLalamoveQuotation,
  type LalamoveCredentials,
  type LalamoveStop,
} from "./lalamove.server";
import type { LalamoveConfig } from "./carrier/lalamove-adapter.server";
import prisma from "../db.server";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type CarrierRouteResult = {
  routeIndex: number;
  locationId: string;
  orderIds: string[];
  costTotal: string;
  costCurrency: string;
  serviceType: string;
  costSubunits: number;
  waitSurchargeSubunits: number;
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
        totalLalamoveCost: string;
        totalWaitSurcharge: string;
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

/** R$14.00 fixed wait-time surcharge per route. */
export const WAIT_SURCHARGE_SUBUNITS = 1400;

/** Minimum orders per route (except directionally isolated outliers). */
const MIN_ORDERS_PER_ROUTE = 2;

/** Angular threshold for directional isolation (120°). */
const DIRECTIONAL_ISOLATION_RAD = (2 * Math.PI) / 3;

/** Distance threshold: clusters within 1 km always merge regardless of angle. */
const PROXIMITY_MERGE_METERS = 1000;

/** 2-opt improvement: max passes before stopping (safety net; converges in <10). */
const TWO_OPT_MAX_ITERATIONS = 100;

/** Maximum delivery stops per route (hard cap applied after depot-distance splitting). */
const MAX_STOPS_PER_ROUTE = 7;

/** Detour-based refinement: move an order between routes when
 *  (removal_saving_from_src - insertion_cost_to_dst) exceeds this threshold.
 *  Adaptive: for small batches (8-10 orders), routes are short and border-zone
 *  differences are small, so a lower threshold (150m) catches more. For large
 *  batches (20+), a higher threshold (300m) avoids trivial swaps. */
const DETOUR_GAIN_FLOOR = 150;
const DETOUR_GAIN_CEILING = 300;
const DETOUR_GAIN_PER_ORDER = 15;
const detourMinGain = (orderCount: number): number =>
  Math.max(DETOUR_GAIN_FLOOR, Math.min(DETOUR_GAIN_CEILING, orderCount * DETOUR_GAIN_PER_ORDER));

/** Maximum iterations for the detour refinement loop. */
const DETOUR_REFINEMENT_MAX_ITERATIONS = 3;

/** Solo-route dissolution reward (meters). When moving the only order from a
 *  size-1 route to another route, the move empties the source route and saves
 *  the R$14 base fee. Expressed as a detour-distance equivalent: 5000m
 *  ≈ R$14 at ~R$2.80/km effective Lalamove rate in BR_SAO. */
const BASE_FEE_METERS_EQUIVALENT = 5000;

/** Consolidation operational tolerance (subunits).
 *  Accept a route merger even when the merged Lalamove quote is marginally
 *  more expensive than the separate quotes, because merging still removes one
 *  dispatch (less driver coordination, less back-office work). R$3.00 = 300
 *  subunits captures the real-world operational cost of managing one extra
 *  dispatch. Observed from user corrections where routes that Lalamove
 *  quoted within R$3 of each other were manually merged. */
const CONSOLIDATION_OPERATIONAL_TOLERANCE_SUBUNITS = 300;

/** Max spread relaxation factor for solo-dissolution moves.
 *  When absorbing a geographically isolated solo route, the receiving route
 *  can temporarily exceed MAX_ROUTE_SPREAD_METERS by up to this factor —
 *  the assumption being that fewer dispatches is worth a wider driver path.
 *  Derived from observed manual corrections where users accepted ~17km spread
 *  to absorb solo orders. */
const SOLO_DISSOLUTION_SPREAD_FACTOR = 1.75;

/** Maximum haversine spread (meters) between any two orders in a route.
 *  Routes exceeding this are split into tighter geographic clusters.
 *  Derived from correction data: routes with >15km spread are consistently overridden. */
const MAX_ROUTE_SPREAD_METERS = 12_000;

// ─── Distance Matrix Type ──────────────────────────────────────────────────────

type DistanceMatrix = number[][];

// ─── Haversine Geometry ────────────────────────────────────────────────────────

const toRadians = (value: number) => (value * Math.PI) / 180;

export const haversineMeters = (a: Coordinate, b: Coordinate) => {
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

// ─── Directional geometry ─────────────────────────────────────────────────────

const polarAngle = (depot: Coordinate, point: Coordinate): number => {
  const dy = point.latitude - depot.latitude;
  const dx =
    (point.longitude - depot.longitude) * Math.cos((depot.latitude * Math.PI) / 180);
  return Math.atan2(dy, dx);
};

const angleDiff = (a: number, b: number): number => {
  let d = Math.abs(a - b);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
};

const clusterCentroid = (cluster: OptimizerOrderInput[]): Coordinate | null =>
  recenter(cluster.map((o) => o.shippingCoordinates));

/**
 * Returns true when a cluster is genuinely isolated: far (>1 km) from all
 * other clusters AND in a direction (>120°) that differs from every other
 * cluster's bearing relative to the depot.
 */
const isDirectionallyIsolated = (
  centroid: Coordinate,
  otherCentroids: Coordinate[],
  depot: Coordinate,
): boolean => {
  if (otherCentroids.length === 0) return true;
  const myAngle = polarAngle(depot, centroid);
  for (const other of otherCentroids) {
    const dist = haversineMeters(centroid, other);
    if (dist <= PROXIMITY_MERGE_METERS) return false; // close enough → not isolated
    if (angleDiff(myAngle, polarAngle(depot, other)) < DIRECTIONAL_ISOLATION_RAD) {
      return false; // similar direction → not isolated
    }
  }
  return true;
};

// ─── Enforce minimum orders per route ─────────────────────────────────────────

const enforceMinOrdersPerRoute = (
  clusters: OptimizerOrderInput[][],
  depot: Coordinate,
  maxPerRoute: number,
): OptimizerOrderInput[][] => {
  const result = clusters.map((c) => [...c]); // shallow-copy each cluster

  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    for (let i = result.length - 1; i >= 0; i -= 1) {
      const cluster = result[i]!;
      if (cluster.length === 0 || cluster.length >= MIN_ORDERS_PER_ROUTE) continue;

      const myCentroid = clusterCentroid(cluster);
      if (!myCentroid) continue;

      // ── Strategy A: Steal nearby orders from other clusters ──────────
      // Pull the closest orders from adjacent clusters, but ONLY if the order
      // is NOT "on the way" to farther stops in its current route. An order is
      // on-the-way when its bearing from depot is closer to its current route's
      // bearing than to the orphan's bearing.

      const needed = MIN_ORDERS_PER_ROUTE - cluster.length;
      const orphanAngle = polarAngle(depot, myCentroid);

      // Pre-compute each source cluster's trajectory angle (depot → centroid)
      const clusterAngles = new Map<number, number>();
      for (let j = 0; j < result.length; j += 1) {
        if (j === i || result[j]!.length === 0) continue;
        const c = clusterCentroid(result[j]!);
        if (c) clusterAngles.set(j, polarAngle(depot, c));
      }

      const stealCandidates: { fromIdx: number; orderIdx: number; dist: number }[] = [];

      for (let j = 0; j < result.length; j += 1) {
        if (j === i || result[j]!.length <= MIN_ORDERS_PER_ROUTE) continue;
        const sourceAngle = clusterAngles.get(j);
        if (sourceAngle == null) continue;

        for (let k = 0; k < result[j]!.length; k += 1) {
          const order = result[j]![k]!;
          const orderAngle = polarAngle(depot, order.shippingCoordinates);

          // On-the-way check: skip if order is better aligned with its
          // current route's trajectory than with the orphan
          const affinityToSource = angleDiff(orderAngle, sourceAngle);
          const affinityToOrphan = angleDiff(orderAngle, orphanAngle);
          if (affinityToSource < affinityToOrphan) continue;

          const dist = haversineMeters(myCentroid, order.shippingCoordinates);
          stealCandidates.push({ fromIdx: j, orderIdx: k, dist });
        }
      }

      stealCandidates.sort((a, b) => a.dist - b.dist);

      let stolen = 0;
      const usedIndices = new Map<number, Set<number>>(); // fromIdx → set of orderIdx
      for (const candidate of stealCandidates) {
        if (stolen >= needed) break;
        if (cluster.length >= maxPerRoute) break;
        const sourceCluster = result[candidate.fromIdx]!;
        const alreadyStolen = usedIndices.get(candidate.fromIdx)?.size ?? 0;
        if (sourceCluster.length - alreadyStolen <= MIN_ORDERS_PER_ROUTE) continue;
        // Skip if stealing this order would make the orphan cluster exceed spread
        const trialCluster = [...cluster, sourceCluster[candidate.orderIdx]!];
        if (clusterSpread(trialCluster) > MAX_ROUTE_SPREAD_METERS) continue;
        if (!usedIndices.has(candidate.fromIdx)) usedIndices.set(candidate.fromIdx, new Set());
        usedIndices.get(candidate.fromIdx)!.add(candidate.orderIdx);
        stolen += 1;
      }

      if (stolen >= needed) {
        for (const [fromIdx, orderIndices] of usedIndices) {
          const sorted = [...orderIndices].sort((a, b) => b - a);
          for (const orderIdx of sorted) {
            const [order] = result[fromIdx]!.splice(orderIdx, 1);
            cluster.push(order!);
          }
        }
        changed = true;
        continue;
      }

      // ── Strategy B: Merge into nearest compatible cluster ────────────
      const others: { idx: number; centroid: Coordinate; dist: number }[] = [];
      for (let j = 0; j < result.length; j += 1) {
        if (j === i || result[j]!.length === 0) continue;
        const oc = clusterCentroid(result[j]!);
        if (!oc) continue;
        others.push({ idx: j, centroid: oc, dist: haversineMeters(myCentroid, oc) });
      }
      if (others.length === 0) continue;

      others.sort((a, b) => a.dist - b.dist);

      const nearest = others.find(
        (o) => result[o.idx]!.length + cluster.length <= maxPerRoute,
      );

      if (nearest) {
        // Check if merging would exceed geographic spread threshold
        const mergedCluster = [...result[nearest.idx]!, ...cluster];
        if (clusterSpread(mergedCluster) > MAX_ROUTE_SPREAD_METERS) {
          continue; // keep solo — better alone than in a geographically bad pairing
        }

        if (nearest.dist <= PROXIMITY_MERGE_METERS) {
          // Within 1 km → always merge regardless of angle
          result[nearest.idx]!.push(...cluster);
          result[i] = [];
          changed = true;
          continue;
        }

        const otherCentroids = others.map((o) => o.centroid);
        if (isDirectionallyIsolated(myCentroid, otherCentroids, depot)) {
          continue; // keep as exception
        }

        // Not isolated → merge into nearest with capacity
        result[nearest.idx]!.push(...cluster);
        result[i] = [];
        changed = true;
      }
    }
    if (!changed) break;
  }

  return result.filter((c) => c.length > 0);
};

// ─── Max-spread enforcement ───────────────────────────────────────────────────

/**
 * Computes the maximum pairwise distance between any two orders in a cluster.
 * When a distance matrix is provided, uses the real driving distance (average
 * of both directions, since Google's matrix is asymmetric). Falls back to
 * haversine when the matrix isn't available or an order isn't mapped.
 *
 * Matrix-based spread is critical for cities with water barriers (e.g. Rio's
 * Guanabara Bay) where haversine underestimates actual driving distance.
 */
const clusterSpread = (
  cluster: OptimizerOrderInput[],
  matrix?: DistanceMatrix,
  idxMap?: Map<string, number>,
): number => {
  if (cluster.length < 2) return 0;
  const useMatrix = Boolean(matrix && idxMap);
  let maxDist = 0;
  for (let i = 0; i < cluster.length; i += 1) {
    for (let j = i + 1; j < cluster.length; j += 1) {
      let d: number;
      if (useMatrix) {
        const ii = idxMap!.get(cluster[i]!.orderId);
        const jj = idxMap!.get(cluster[j]!.orderId);
        if (ii != null && jj != null && matrix![ii] && matrix![jj]) {
          // Average both directions (Google matrix is asymmetric)
          const dij = matrix![ii]![jj] ?? 0;
          const dji = matrix![jj]![ii] ?? 0;
          d = (dij + dji) / 2;
        } else {
          d = haversineMeters(cluster[i]!.shippingCoordinates, cluster[j]!.shippingCoordinates);
        }
      } else {
        d = haversineMeters(cluster[i]!.shippingCoordinates, cluster[j]!.shippingCoordinates);
      }
      if (d > maxDist) maxDist = d;
    }
  }
  return maxDist;
};

/**
 * Splits clusters that exceed MAX_ROUTE_SPREAD_METERS using k-means bisection.
 * Each oversized cluster is recursively split in two until all clusters are
 * within the spread threshold or cannot be split further (≤2 orders).
 * Uses the distance matrix when available for real-driving-distance spreads.
 */
const enforceMaxSpread = (
  clusters: OptimizerOrderInput[][],
  maxSpreadMeters: number,
  matrix?: DistanceMatrix,
  idxMap?: Map<string, number>,
): OptimizerOrderInput[][] => {
  const result: OptimizerOrderInput[][] = [];

  const splitCluster = (cluster: OptimizerOrderInput[]): void => {
    if (cluster.length <= 2 || clusterSpread(cluster, matrix, idxMap) <= maxSpreadMeters) {
      result.push(cluster);
      return;
    }

    // Bisect using 2-means: seed with the two farthest-apart orders
    let seedA = 0;
    let seedB = 1;
    let maxDist = 0;
    for (let i = 0; i < cluster.length; i += 1) {
      for (let j = i + 1; j < cluster.length; j += 1) {
        const d = haversineMeters(cluster[i]!.shippingCoordinates, cluster[j]!.shippingCoordinates);
        if (d > maxDist) {
          maxDist = d;
          seedA = i;
          seedB = j;
        }
      }
    }

    let centroidA = cluster[seedA]!.shippingCoordinates;
    let centroidB = cluster[seedB]!.shippingCoordinates;

    let bucketA: OptimizerOrderInput[] = [];
    let bucketB: OptimizerOrderInput[] = [];

    for (let iter = 0; iter < 8; iter += 1) {
      bucketA = [];
      bucketB = [];
      for (const order of cluster) {
        const dA = haversineMeters(order.shippingCoordinates, centroidA);
        const dB = haversineMeters(order.shippingCoordinates, centroidB);
        if (dA <= dB) bucketA.push(order);
        else bucketB.push(order);
      }
      if (bucketA.length === 0 || bucketB.length === 0) break;
      centroidA = recenter(bucketA.map((o) => o.shippingCoordinates)) ?? centroidA;
      centroidB = recenter(bucketB.map((o) => o.shippingCoordinates)) ?? centroidB;
    }

    // If bisection failed (all in one bucket), push as-is
    if (bucketA.length === 0 || bucketB.length === 0) {
      result.push(cluster);
      return;
    }

    // Recurse on each half
    splitCluster(bucketA);
    splitCluster(bucketB);
  };

  for (const cluster of clusters) {
    splitCluster(cluster);
  }
  return result;
};

// ─── K-means clustering ────────────────────────────────────────────────────────

export const clusterOrders = (
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

  const chunks: OptimizerOrderInput[][] = [];
  for (const bucket of buckets) {
    if (bucket.length === 0) continue;
    for (let i = 0; i < bucket.length; i += maxPerRoute) {
      chunks.push(bucket.slice(i, i + maxPerRoute));
    }
  }
  return enforceMinOrdersPerRoute(chunks, origin, maxPerRoute);
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
  specialRequests?: string[],
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
        specialRequests,
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
  specialRequests?: string[],
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
        const quote = await quoteCluster(cluster, config, serviceType, credentials, rateLimiter, specialRequests);
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

    const waitSurcharge = partitionQuotes.length * WAIT_SURCHARGE_SUBUNITS;
    const totalWithSurcharge = partitionCost + waitSurcharge;

    console.info(
      "[carrier-quotation-optimizer] Partition k=%d rawCost=%d surcharge=%d total=%d (%d routes)",
      k, partitionCost, waitSurcharge, totalWithSurcharge, partitionQuotes.length,
    );

    if (totalWithSurcharge < bestTotalCost) {
      bestTotalCost = totalWithSurcharge;
      bestPartition = partitionQuotes;
    }
  }

  if (bestPartition.length === 0) {
    return { ok: false, error: "All Lalamove quotations failed. Check credentials and location config." };
  }

  // ── Phase B: Conditionally add future orders ──────────────────────────────

  // Build mutable route data for cheapest insertion checks
  type MutableCarrierRoute = {
    quote: ClusterQuote;
    stops: Coordinate[];
    origin: Coordinate;
  };

  const mutableRoutes: MutableCarrierRoute[] = bestPartition.map((q) => ({
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
        specialRequests,
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

  // ── Phase C: Post-optimization consolidation ─────────────────────────────
  // Try merging small routes when the saved R$14 surcharge outweighs the
  // increased Lalamove cost of a longer multi-stop route.

  for (let consolidationPass = 0; consolidationPass < 3; consolidationPass += 1) {
    let didMerge = false;
    for (let i = 0; i < mutableRoutes.length; i += 1) {
      const routeA = mutableRoutes[i];
      if (!routeA || routeA.quote.cluster.length === 0) continue;
      for (let j = i + 1; j < mutableRoutes.length; j += 1) {
        const routeB = mutableRoutes[j];
        if (!routeB || routeB.quote.cluster.length === 0) continue;
        if (routeA.quote.cluster.length + routeB.quote.cluster.length > maxPerRoute) continue;

        const separateCost =
          routeA.quote.costSubunits + routeB.quote.costSubunits + 2 * WAIT_SURCHARGE_SUBUNITS;
        const mergedCluster = [...routeA.quote.cluster, ...routeB.quote.cluster];

        // Quote merged cluster with both vehicle types
        let bestMergedQuote: { costSubunits: number; costTotal: string; costCurrency: string; serviceType: string } | null = null;
        for (const serviceType of vehicleTypes) {
          const q = await quoteCluster(mergedCluster, config, serviceType, credentials, rateLimiter, specialRequests);
          if (q && (bestMergedQuote === null || q.costSubunits < bestMergedQuote.costSubunits)) {
            bestMergedQuote = { ...q, serviceType };
          }
        }
        if (!bestMergedQuote) continue;

        const mergedCost = bestMergedQuote.costSubunits + WAIT_SURCHARGE_SUBUNITS;
        if (mergedCost < separateCost) {
          console.info(
            "[carrier-quotation-optimizer] Consolidation: merging routes %d+%d (%d+%d orders), saving %d subunits",
            i, j, routeA.quote.cluster.length, routeB.quote.cluster.length, separateCost - mergedCost,
          );
          routeA.quote = {
            cluster: mergedCluster,
            costSubunits: bestMergedQuote.costSubunits,
            costTotal: bestMergedQuote.costTotal,
            costCurrency: bestMergedQuote.costCurrency,
            serviceType: bestMergedQuote.serviceType,
          };
          routeA.stops = mergedCluster.map((o) => o.shippingCoordinates);
          routeB.quote.cluster = [];
          routeB.stops = [];
          didMerge = true;
        }
      }
    }
    // Remove emptied routes
    const beforeCount = mutableRoutes.length;
    for (let k = mutableRoutes.length - 1; k >= 0; k -= 1) {
      if (mutableRoutes[k]!.quote.cluster.length === 0) mutableRoutes.splice(k, 1);
    }
    if (!didMerge || mutableRoutes.length === beforeCount) break;
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

  // ── Final min-3 enforcement: steal nearby orders or merge ─────────────────
  // After all phases, some routes may still have < 3 orders. First try to
  // grow them by pulling nearby orders from larger routes. Only dissolve
  // (merge away) as a last resort.

  const depot = { latitude: config.pickupLat!, longitude: config.pickupLng! };
  for (let i = mutableRoutes.length - 1; i >= 0; i -= 1) {
    const route = mutableRoutes[i]!;
    if (route.quote.cluster.length === 0 || route.quote.cluster.length >= MIN_ORDERS_PER_ROUTE) continue;

    const myCentroid = clusterCentroid(route.quote.cluster);
    if (!myCentroid) continue;

    // Strategy A: Steal nearby orders, but only if they're NOT on-the-way
    // to farther stops in their current route (directional affinity check).
    const needed = MIN_ORDERS_PER_ROUTE - route.quote.cluster.length;
    const orphanAngle = polarAngle(depot, myCentroid);

    // Pre-compute each source route's trajectory angle
    const routeAngles = new Map<number, number>();
    for (let j = 0; j < mutableRoutes.length; j += 1) {
      if (j === i || mutableRoutes[j]!.quote.cluster.length === 0) continue;
      const c = clusterCentroid(mutableRoutes[j]!.quote.cluster);
      if (c) routeAngles.set(j, polarAngle(depot, c));
    }

    const stealCandidates: { fromIdx: number; orderIdx: number; dist: number }[] = [];

    for (let j = 0; j < mutableRoutes.length; j += 1) {
      if (j === i || mutableRoutes[j]!.quote.cluster.length <= MIN_ORDERS_PER_ROUTE) continue;
      const sourceAngle = routeAngles.get(j);
      if (sourceAngle == null) continue;

      for (let k = 0; k < mutableRoutes[j]!.quote.cluster.length; k += 1) {
        const order = mutableRoutes[j]!.quote.cluster[k]!;
        const orderAngle = polarAngle(depot, order.shippingCoordinates);

        // On-the-way check: skip if order aligns better with its current route
        if (angleDiff(orderAngle, sourceAngle) < angleDiff(orderAngle, orphanAngle)) continue;

        stealCandidates.push({
          fromIdx: j,
          orderIdx: k,
          dist: haversineMeters(myCentroid, order.shippingCoordinates),
        });
      }
    }

    stealCandidates.sort((a, b) => a.dist - b.dist);

    let stolen = 0;
    const usedIndices = new Map<number, Set<number>>();
    for (const candidate of stealCandidates) {
      if (stolen >= needed) break;
      if (route.quote.cluster.length + stolen >= maxPerRoute) break;
      const sourceRoute = mutableRoutes[candidate.fromIdx]!;
      const alreadyStolen = usedIndices.get(candidate.fromIdx)?.size ?? 0;
      if (sourceRoute.quote.cluster.length - alreadyStolen <= MIN_ORDERS_PER_ROUTE) continue;
      if (!usedIndices.has(candidate.fromIdx)) usedIndices.set(candidate.fromIdx, new Set());
      usedIndices.get(candidate.fromIdx)!.add(candidate.orderIdx);
      stolen += 1;
    }

    if (stolen >= needed) {
      for (const [fromIdx, orderIndices] of usedIndices) {
        const sorted = [...orderIndices].sort((a, b) => b - a);
        for (const orderIdx of sorted) {
          const [order] = mutableRoutes[fromIdx]!.quote.cluster.splice(orderIdx, 1);
          mutableRoutes[fromIdx]!.stops.splice(orderIdx, 1);
          route.quote.cluster.push(order!);
          route.stops.push(order!.shippingCoordinates);
        }
      }
      continue;
    }

    // Strategy B: Merge into nearest route if not directionally isolated
    const otherCentroids: Coordinate[] = [];
    let bestTarget: { idx: number; dist: number } | null = null;

    for (let j = 0; j < mutableRoutes.length; j += 1) {
      if (j === i || mutableRoutes[j]!.quote.cluster.length === 0) continue;
      const oc = clusterCentroid(mutableRoutes[j]!.quote.cluster);
      if (!oc) continue;
      otherCentroids.push(oc);
      const dist = haversineMeters(myCentroid, oc);
      if (
        mutableRoutes[j]!.quote.cluster.length + route.quote.cluster.length <= maxPerRoute &&
        (bestTarget === null || dist < bestTarget.dist)
      ) {
        bestTarget = { idx: j, dist };
      }
    }

    if (!bestTarget) continue;
    if (bestTarget.dist <= PROXIMITY_MERGE_METERS || !isDirectionallyIsolated(myCentroid, otherCentroids, depot)) {
      const target = mutableRoutes[bestTarget.idx]!;
      target.quote.cluster.push(...route.quote.cluster);
      target.stops.push(...route.stops);
      route.quote.cluster = [];
      route.stops = [];
    }
  }
  // Remove emptied routes
  for (let k = mutableRoutes.length - 1; k >= 0; k -= 1) {
    if (mutableRoutes[k]!.quote.cluster.length === 0) mutableRoutes.splice(k, 1);
  }

  // ── Build result ──────────────────────────────────────────────────────────

  const rawLalamoveCostSubunits = mutableRoutes.reduce((sum, r) => sum + r.quote.costSubunits, 0);
  const totalWaitSurchargeSubunits = mutableRoutes.length * WAIT_SURCHARGE_SUBUNITS;
  const totalCostSubunits = rawLalamoveCostSubunits + totalWaitSurchargeSubunits;
  const currency = mutableRoutes[0]?.quote.costCurrency ?? "BRL";

  const routes: CarrierRouteResult[] = mutableRoutes.map((r, i) => ({
    routeIndex: i,
    locationId: r.quote.cluster[0]?.locationId ?? "",
    orderIds: r.quote.cluster.map((o) => o.orderId),
    costTotal: r.quote.costTotal,
    costCurrency: r.quote.costCurrency,
    serviceType: r.quote.serviceType,
    costSubunits: r.quote.costSubunits,
    waitSurchargeSubunits: WAIT_SURCHARGE_SUBUNITS,
  }));

  console.info("[carrier-quotation-optimizer] Result:", {
    routeCount: routes.length,
    totalOrders: routes.reduce((sum, r) => sum + r.orderIds.length, 0),
    lalamoveCost: `${currency} ${(rawLalamoveCostSubunits / 100).toFixed(2)}`,
    waitSurcharge: `${currency} ${(totalWaitSurchargeSubunits / 100).toFixed(2)}`,
    totalCost: `${currency} ${(totalCostSubunits / 100).toFixed(2)}`,
    routeSizes: routes.map((r) => r.orderIds.length),
    routeVehicles: routes.map((r) => r.serviceType),
  });

  return {
    ok: true,
    routes,
    summary: {
      routeCount: routes.length,
      totalOrders: routes.reduce((sum, r) => sum + r.orderIds.length, 0),
      totalCost: (totalCostSubunits / 100).toFixed(2),
      costCurrency: currency,
      totalLalamoveCost: (rawLalamoveCostSubunits / 100).toFixed(2),
      totalWaitSurcharge: (totalWaitSurchargeSubunits / 100).toFixed(2),
    },
  };
}

// ─── Distance Matrix ──────────────────────────────────────────────────────────

const MATRIX_CHUNK_SIZE = 10;

async function fetchDistanceMatrixChunk(
  apiKey: string,
  origins: Coordinate[],
  destinations: Coordinate[],
): Promise<{ rows: { elements: { distance?: { value: number }; status: string }[] }[] }> {
  const originsStr = origins.map((c) => `${c.latitude},${c.longitude}`).join("|");
  const destsStr = destinations.map((c) => `${c.latitude},${c.longitude}`).join("|");
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(originsStr)}&destinations=${encodeURIComponent(destsStr)}&mode=driving&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Distance Matrix API request failed");
  const json = await res.json();
  if (json.status !== "OK") throw new Error(`Distance Matrix API error: ${json.status}`);
  return json;
}

async function fetchFullDistanceMatrix(
  apiKey: string,
  points: Coordinate[],
): Promise<DistanceMatrix> {
  const n = points.length;
  const matrix: DistanceMatrix = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => 0),
  );
  for (let oStart = 0; oStart < n; oStart += MATRIX_CHUNK_SIZE) {
    const oEnd = Math.min(oStart + MATRIX_CHUNK_SIZE, n);
    const origins = points.slice(oStart, oEnd);
    for (let dStart = 0; dStart < n; dStart += MATRIX_CHUNK_SIZE) {
      const dEnd = Math.min(dStart + MATRIX_CHUNK_SIZE, n);
      const destinations = points.slice(dStart, dEnd);
      const json = await fetchDistanceMatrixChunk(apiKey, origins, destinations);
      const rows = json.rows ?? [];
      for (let i = 0; i < rows.length; i += 1) {
        const elements = rows[i]?.elements ?? [];
        for (let j = 0; j < elements.length; j += 1) {
          const el = elements[j];
          const oIdx = oStart + i;
          const dIdx = dStart + j;
          if (el?.status === "OK" && el.distance?.value != null) {
            matrix[oIdx]![dIdx]! = el.distance.value;
          } else {
            matrix[oIdx]![dIdx]! = haversineMeters(points[oIdx]!, points[dIdx]!);
          }
        }
      }
    }
  }
  return matrix;
}

// ─── Route-First Split-Second: TSP + Gap Splitting ───────────────────────────

/**
 * Nearest-neighbor TSP heuristic on the distance matrix.
 * Starts at depot (index 0), visits all orders (1..orderCount).
 * Returns a one-way tour as 1-based order indices (depot excluded).
 */
function tspNearestNeighbor(
  matrix: DistanceMatrix,
  orderCount: number,
): number[] {
  const visited = new Set<number>();
  const tour: number[] = [];
  let current = 0; // depot

  for (let step = 0; step < orderCount; step += 1) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let candidate = 1; candidate <= orderCount; candidate += 1) {
      if (visited.has(candidate)) continue;
      const d = matrix[current]?.[candidate] ?? Infinity;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = candidate;
      }
    }
    if (bestIdx === -1) break;
    visited.add(bestIdx);
    tour.push(bestIdx);
    current = bestIdx;
  }

  return tour;
}

/**
 * Classic 2-opt local search on a one-way tour (depot → stops, no return).
 * Reverses sub-segments when doing so reduces total distance.
 * Returns the improved tour (mutated in place).
 */
function twoOptImprove(tour: number[], matrix: DistanceMatrix): number[] {
  const n = tour.length;
  if (n < 3) return tour;

  let improved = true;
  let iterations = 0;

  while (improved && iterations < TWO_OPT_MAX_ITERATIONS) {
    improved = false;
    iterations += 1;

    for (let i = 0; i < n - 1; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        // Delta evaluation: compare old edges vs new edges after reversing [i..j]
        const prevI = i === 0 ? 0 : tour[i - 1]!; // 0 = depot
        const oldStart = matrix[prevI]?.[tour[i]!] ?? 0;
        const newStart = matrix[prevI]?.[tour[j]!] ?? 0;

        let oldEnd = 0;
        let newEnd = 0;
        if (j < n - 1) {
          oldEnd = matrix[tour[j]!]?.[tour[j + 1]!] ?? 0;
          newEnd = matrix[tour[i]!]?.[tour[j + 1]!] ?? 0;
        }

        if (newStart + newEnd < oldStart + oldEnd) {
          // Reverse the sub-segment [i..j]
          let left = i;
          let right = j;
          while (left < right) {
            const tmp = tour[left]!;
            tour[left] = tour[right]!;
            tour[right] = tmp;
            left += 1;
            right -= 1;
          }
          improved = true;
        }
      }
    }
  }

  return tour;
}

/** Recursively splits an oversized segment at its largest internal gap. */
function recursiveSubSplit(
  segment: number[],
  matrix: DistanceMatrix,
  maxPerSegment: number,
): number[][] {
  if (segment.length <= maxPerSegment) return [segment];

  // Find largest internal gap
  let largestIdx = 1;
  let largestVal = 0;
  for (let k = 0; k < segment.length - 1; k += 1) {
    const g = matrix[segment[k]!]?.[segment[k + 1]!] ?? 0;
    if (g > largestVal) {
      largestVal = g;
      largestIdx = k + 1;
    }
  }

  const left = segment.slice(0, largestIdx);
  const right = segment.slice(largestIdx);

  return [
    ...recursiveSubSplit(left, matrix, maxPerSegment),
    ...recursiveSubSplit(right, matrix, maxPerSegment),
  ];
}

// ─── VRP Result Types ─────────────────────────────────────────────────────────

/** Result type including polylines for map rendering. */
export type VRPRouteResult = CarrierRouteResult & {
  corridorPolyline: string; // encoded polyline for free map rendering
};

export type VRPQuotationResult =
  | {
      ok: true;
      routes: VRPRouteResult[];
      summary: {
        routeCount: number;
        totalOrders: number;
        totalCost: string;
        costCurrency: string;
        totalLalamoveCost: string;
        totalWaitSurcharge: string;
      };
    }
  | { ok: false; error: string };

type MutableRoute = {
  cluster: OptimizerOrderInput[];
  costSubunits: number;
  costTotal: string;
  costCurrency: string;
  serviceType: string;
};

// ─── Local Search Relocate Refinement ─────────────────────────────────────────

const MAX_RELOCATE_ITERATIONS = 3;
const RELOCATE_API_BUDGET = 60;
const RELOCATE_IMPROVEMENT_THRESHOLD = 0.85;

/**
 * Post-optimization local search: tries relocating individual orders between
 * routes and keeps moves that reduce total cost (Lalamove quote + R$14 surcharge).
 * Mutates `mutableRoutes` in place.
 */
async function localSearchRelocate(
  mutableRoutes: MutableRoute[],
  matrix: DistanceMatrix,
  orderIndexMap: Map<string, number>,
  config: LalamoveConfig,
  credentials: LalamoveCredentials,
  vehicleTypes: string[],
  maxPerRoute: number,
  rateLimiter: RateLimiter,
  specialRequests?: string[],
): Promise<{ movesApplied: number; apiCallsUsed: number }> {
  let totalMoves = 0;
  let totalApiCalls = 0;

  if (mutableRoutes.length < 2) return { movesApplied: 0, apiCallsUsed: 0 };

  for (let iteration = 0; iteration < MAX_RELOCATE_ITERATIONS; iteration += 1) {
    // Step 1: Build candidate list with pre-filtering
    type Candidate = {
      order: OptimizerOrderInput;
      srcIdx: number;
      dstIdx: number;
      savingsEstimate: number;
    };
    const candidates: Candidate[] = [];

    for (let srcIdx = 0; srcIdx < mutableRoutes.length; srcIdx += 1) {
      const src = mutableRoutes[srcIdx]!;
      // Strict min-3: can only remove if route has >3 orders, or if it would empty the route
      // Routes with <=3 orders can only lose orders if ALL orders move out (route elimination)
      // — but we handle single-order moves, so skip routes with <=3 for now
      if (src.cluster.length <= MIN_ORDERS_PER_ROUTE) continue;

      for (const order of src.cluster) {
        const matrixIdx = orderIndexMap.get(order.orderId);

        for (let dstIdx = 0; dstIdx < mutableRoutes.length; dstIdx += 1) {
          if (dstIdx === srcIdx) continue;
          const dst = mutableRoutes[dstIdx]!;
          if (dst.cluster.length >= maxPerRoute) continue;

          // Compute average distance to own route vs destination route
          let avgDistToOwn: number;
          let avgDistToDst: number;

          if (matrixIdx !== undefined) {
            // Use distance matrix (real road distances)
            const ownIndices = src.cluster
              .filter((o) => o.orderId !== order.orderId)
              .map((o) => orderIndexMap.get(o.orderId))
              .filter((idx): idx is number => idx !== undefined);
            const dstIndices = dst.cluster
              .map((o) => orderIndexMap.get(o.orderId))
              .filter((idx): idx is number => idx !== undefined);

            if (ownIndices.length === 0 || dstIndices.length === 0) continue;

            avgDistToOwn =
              ownIndices.reduce((sum, idx) => sum + (matrix[matrixIdx]?.[idx] ?? 0), 0) /
              ownIndices.length;
            avgDistToDst =
              dstIndices.reduce((sum, idx) => sum + (matrix[matrixIdx]?.[idx] ?? 0), 0) /
              dstIndices.length;
          } else {
            // Haversine fallback for conditional orders not in the matrix
            const ownCoords = src.cluster.filter((o) => o.orderId !== order.orderId);
            const dstCoords = dst.cluster;
            if (ownCoords.length === 0 || dstCoords.length === 0) continue;

            avgDistToOwn =
              ownCoords.reduce(
                (sum, o) => sum + haversineMeters(order.shippingCoordinates, o.shippingCoordinates),
                0,
              ) / ownCoords.length;
            avgDistToDst =
              dstCoords.reduce(
                (sum, o) => sum + haversineMeters(order.shippingCoordinates, o.shippingCoordinates),
                0,
              ) / dstCoords.length;
          }

          // Pre-filter: only consider if destination is 15% closer
          if (avgDistToDst < avgDistToOwn * RELOCATE_IMPROVEMENT_THRESHOLD) {
            candidates.push({
              order,
              srcIdx,
              dstIdx,
              savingsEstimate: avgDistToOwn - avgDistToDst,
            });
          }
        }
      }
    }

    if (candidates.length === 0) break;

    // Step 2: Sort by estimated savings descending
    candidates.sort((a, b) => b.savingsEstimate - a.savingsEstimate);

    // Step 3: Greedily apply non-conflicting moves
    const touchedRoutes = new Set<number>();
    const movedOrderIds = new Set<string>();
    let improved = false;

    for (const candidate of candidates) {
      if (totalApiCalls >= RELOCATE_API_BUDGET) break;
      if (movedOrderIds.has(candidate.order.orderId)) continue;
      if (touchedRoutes.has(candidate.srcIdx) || touchedRoutes.has(candidate.dstIdx)) continue;

      const src = mutableRoutes[candidate.srcIdx]!;
      const dst = mutableRoutes[candidate.dstIdx]!;

      // Re-check constraints
      const newSrcSize = src.cluster.length - 1;
      if (newSrcSize > 0 && newSrcSize < MIN_ORDERS_PER_ROUTE) continue;
      if (dst.cluster.length + 1 > maxPerRoute) continue;

      // Build trial clusters
      const newSrcCluster = src.cluster.filter((o) => o.orderId !== candidate.order.orderId);
      const newDstCluster = [...dst.cluster, candidate.order];

      // Skip if destination cluster would exceed geographic spread threshold
      if (clusterSpread(newDstCluster, matrix, orderIndexMap) > MAX_ROUTE_SPREAD_METERS) continue;

      // Old cost with surcharges
      const oldCost =
        src.costSubunits +
        dst.costSubunits +
        (src.cluster.length > 0 ? WAIT_SURCHARGE_SUBUNITS : 0) +
        WAIT_SURCHARGE_SUBUNITS;

      // Quote new source route
      let newSrcQuote: { costSubunits: number; costTotal: string; costCurrency: string; serviceType: string } | null =
        null;
      if (newSrcCluster.length > 0) {
        for (const serviceType of vehicleTypes) {
          const q = await quoteCluster(newSrcCluster, config, serviceType, credentials, rateLimiter, specialRequests);
          totalApiCalls += 1;
          if (q && (newSrcQuote === null || q.costSubunits < newSrcQuote.costSubunits)) {
            newSrcQuote = { ...q, serviceType };
          }
        }
      }

      // Quote new destination route
      let newDstQuote: { costSubunits: number; costTotal: string; costCurrency: string; serviceType: string } | null =
        null;
      for (const serviceType of vehicleTypes) {
        const q = await quoteCluster(newDstCluster, config, serviceType, credentials, rateLimiter, specialRequests);
        totalApiCalls += 1;
        if (q && (newDstQuote === null || q.costSubunits < newDstQuote.costSubunits)) {
          newDstQuote = { ...q, serviceType };
        }
      }

      if (!newDstQuote) continue; // quotation failed

      // New cost with surcharges
      const newCost =
        (newSrcQuote?.costSubunits ?? 0) +
        newDstQuote.costSubunits +
        (newSrcCluster.length > 0 ? WAIT_SURCHARGE_SUBUNITS : 0) +
        WAIT_SURCHARGE_SUBUNITS;

      if (newCost < oldCost) {
        // Accept the move
        const savings = oldCost - newCost;
        console.info(
          `[vrp-optimizer] Relocate: order ${candidate.order.orderId} route ${candidate.srcIdx}->${candidate.dstIdx}, saving ${savings} subunits`,
        );

        src.cluster = newSrcCluster;
        src.costSubunits = newSrcQuote?.costSubunits ?? 0;
        src.costTotal = newSrcQuote?.costTotal ?? "0";
        src.costCurrency = newSrcQuote?.costCurrency ?? "BRL";
        src.serviceType = newSrcQuote?.serviceType ?? src.serviceType;

        dst.cluster = newDstCluster;
        dst.costSubunits = newDstQuote.costSubunits;
        dst.costTotal = newDstQuote.costTotal;
        dst.costCurrency = newDstQuote.costCurrency;
        dst.serviceType = newDstQuote.serviceType;

        touchedRoutes.add(candidate.srcIdx);
        touchedRoutes.add(candidate.dstIdx);
        movedOrderIds.add(candidate.order.orderId);
        totalMoves += 1;
        improved = true;
      }
    }

    // Clean up empty routes
    for (let k = mutableRoutes.length - 1; k >= 0; k -= 1) {
      if (mutableRoutes[k]!.cluster.length === 0) mutableRoutes.splice(k, 1);
    }

    if (!improved) break;
  }

  return { movesApplied: totalMoves, apiCallsUsed: totalApiCalls };
}

// ─── VRP Optimizer ────────────────────────────────────────────────────────────

/**
 * VRP-based route optimizer using TSP tour + gap-based splitting + Google Distance Matrix.
 *
 * Uses real road distances for clustering decisions (no haversine geometry for routing).
 * Lalamove quotes for cost validation + consolidation. Google polylines for rendering.
 */
export async function optimizeByVRP(
  orders: OptimizerOrderInput[],
  config: LalamoveConfig,
  credentials: LalamoveCredentials,
  googleApiKey: string,
  shop: string,
  maxAvailableRoutes: number,
  vehicleOptions: { primary: string; secondary?: string },
  maxOrdersPerRoute: number,
  specialRequests?: string[],
): Promise<VRPQuotationResult> {
  if (orders.length === 0) {
    return { ok: false, error: "No orders to optimize." };
  }
  if (config.pickupLat == null || config.pickupLng == null) {
    return { ok: false, error: "Pickup coordinates missing in location config." };
  }

  const depot: Coordinate = { latitude: config.pickupLat, longitude: config.pickupLng };
  const maxPerRoute = Math.min(LALAMOVE_MAX_DELIVERY_STOPS, Math.max(1, maxOrdersPerRoute));
  const rateLimiter = new RateLimiter();
  const vehicleTypes = [vehicleOptions.primary];
  if (vehicleOptions.secondary && vehicleOptions.secondary !== vehicleOptions.primary) {
    vehicleTypes.push(vehicleOptions.secondary);
  }

  // ── Separate must-assign vs conditional ──────────────────────────────────
  const mustAssignOrders = orders.filter((o) => o.mustAssign === true);
  const conditionalOrders = orders.filter((o) => o.mustAssign !== true);
  const phase1Orders = mustAssignOrders.length > 0 ? mustAssignOrders : orders;
  const phase2Orders = mustAssignOrders.length > 0 ? conditionalOrders : [];

  console.info("[vrp-optimizer] START", {
    total: orders.length,
    mustAssign: phase1Orders.length,
    conditional: phase2Orders.length,
    maxPerRoute,
    vehicleTypes,
  });

  // ── Phase 1: Build distance matrix via Google Distance Matrix API ────────
  const points: Coordinate[] = [depot, ...phase1Orders.map((o) => o.shippingCoordinates)];
  const startMs = Date.now();
  let matrix: DistanceMatrix;
  let matrixFallback = false;
  try {
    matrix = await fetchFullDistanceMatrix(googleApiKey, points);
  } catch (err) {
    console.warn("[vrp-optimizer] Distance matrix API failed, using haversine fallback:", err instanceof Error ? err.message : String(err));
    matrix = points.map((_, i) => points.map((_, j) => haversineMeters(points[i]!, points[j]!)));
    matrixFallback = true;
  }
  const chunks = Math.ceil(points.length / MATRIX_CHUNK_SIZE) ** 2;
  console.info(`[vrp-optimizer] Phase 1: distance matrix built points=${points.length} chunks=${chunks} elapsed=${Date.now() - startMs}ms fallback=${matrixFallback}`);

  // Pre-compute orderId -> matrix index so spread checks downstream can use
  // real driving distance (critical for cities with water barriers like Rio).
  const phase1IdxMap = new Map<string, number>();
  for (let i = 0; i < phase1Orders.length; i += 1) {
    phase1IdxMap.set(phase1Orders[i]!.orderId, i + 1); // 1-based (0 = depot)
  }

  // ── Phase 2a: TSP Tour (nearest-neighbor + 2-opt) ────────────────────────
  const rawTour = tspNearestNeighbor(matrix, phase1Orders.length);
  const improvedTour = twoOptImprove(rawTour, matrix);
  console.info(`[vrp-optimizer] Phase 2a: TSP tour length=${improvedTour.length}`);

  // ── Phase 2b: Max-stop enforcement ──────────────────────────────────────
  const initialRoutes: number[][] = [];
  if (improvedTour.length > MAX_STOPS_PER_ROUTE) {
    initialRoutes.push(...recursiveSubSplit(improvedTour, matrix, MAX_STOPS_PER_ROUTE));
  } else {
    initialRoutes.push(improvedTour);
  }
  console.info(
    `[vrp-optimizer] Phase 2b: ${initialRoutes.length} routes`,
    initialRoutes.map((r) => r.length),
  );

  // Convert 1-based matrix indices back to OptimizerOrderInput arrays
  let clusters: OptimizerOrderInput[][] = initialRoutes.map((route) =>
    route.map((idx) => phase1Orders[idx - 1]!),
  );

  // ── Phase 2c: Max-spread enforcement ────────────────────────────────────
  const preSpreadCount = clusters.length;
  clusters = enforceMaxSpread(clusters, MAX_ROUTE_SPREAD_METERS, matrix, phase1IdxMap);
  if (clusters.length !== preSpreadCount) {
    console.info(`[vrp-optimizer] Phase 2c: max-spread enforcement split ${preSpreadCount} -> ${clusters.length} routes (threshold=${MAX_ROUTE_SPREAD_METERS}m)`);
  }

  // ── Phase 3: Conditional order insertion ─────────────────────────────────
  let conditionalAdded = 0;
  for (const conditionalOrder of phase2Orders) {
    let bestClusterIdx = -1;
    let bestIncremental = Infinity;

    for (let c = 0; c < clusters.length; c += 1) {
      if (clusters[c]!.length >= maxPerRoute) continue;
      // Check if adding this order would exceed geographic spread
      // (phase2 orders aren't in the matrix, so this falls back to haversine)
      const trialCluster = [...clusters[c]!, conditionalOrder];
      if (clusterSpread(trialCluster, matrix, phase1IdxMap) > MAX_ROUTE_SPREAD_METERS) continue;
      const origin = clusters[c]![0]!.locationCoordinates;
      const stops = clusters[c]!.map((o) => o.shippingCoordinates);
      const incremental = computeMinIncrementalDistance(origin, stops, conditionalOrder.shippingCoordinates);
      if (incremental < bestIncremental) {
        bestIncremental = incremental;
        bestClusterIdx = c;
      }
    }

    const soloDistance = haversineMeters(depot, conditionalOrder.shippingCoordinates);
    if (bestClusterIdx >= 0 && bestIncremental <= soloDistance) {
      clusters[bestClusterIdx]!.push(conditionalOrder);
      conditionalAdded += 1;
    }
  }
  if (phase2Orders.length > 0) {
    console.info(`[vrp-optimizer] Phase 3: conditional insertion added=${conditionalAdded} of ${phase2Orders.length}`);
  }

  // ── Phase 4: Min-3 enforcement + Lalamove validation + consolidation ────

  // Min-3 enforcement (uses haversine steal/merge — distance matrix indices don't carry over)
  clusters = enforceMinOrdersPerRoute(clusters, depot, maxPerRoute);

  // Cap at maxAvailableRoutes — force-merge smallest
  while (clusters.length > maxAvailableRoutes) {
    clusters.sort((a, b) => a.length - b.length);
    const smallest = clusters.shift()!;
    // Find nearest cluster by centroid distance
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let c = 0; c < clusters.length; c += 1) {
      if (clusters[c]!.length + smallest.length > maxPerRoute) continue;
      const centroid = clusterCentroid(clusters[c]!);
      const smallCentroid = clusterCentroid(smallest);
      if (centroid && smallCentroid) {
        const d = haversineMeters(centroid, smallCentroid);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = c;
        }
      }
    }
    clusters[bestIdx]!.push(...smallest);
  }

  // Build mutable route structures for Lalamove quoting + consolidation
  const mutableRoutes: MutableRoute[] = [];
  for (const cluster of clusters) {
    if (cluster.length === 0) continue;
    let bestQuote: { costSubunits: number; costTotal: string; costCurrency: string; serviceType: string } | null = null;
    for (const serviceType of vehicleTypes) {
      const q = await quoteCluster(cluster, config, serviceType, credentials, rateLimiter, specialRequests);
      if (q && (bestQuote === null || q.costSubunits < bestQuote.costSubunits)) {
        bestQuote = { ...q, serviceType };
      }
    }
    mutableRoutes.push({
      cluster,
      costSubunits: bestQuote?.costSubunits ?? 0,
      costTotal: bestQuote?.costTotal ?? "0",
      costCurrency: bestQuote?.costCurrency ?? "BRL",
      serviceType: bestQuote?.serviceType ?? vehicleOptions.primary,
    });
  }

  // ── Phase 4b: Local search relocate refinement ──────────────────────────────
  const orderIndexMap = new Map<string, number>();
  for (let i = 0; i < phase1Orders.length; i += 1) {
    orderIndexMap.set(phase1Orders[i]!.orderId, i + 1); // 1-based matrix index
  }

  const relocateResult = await localSearchRelocate(
    mutableRoutes,
    matrix,
    orderIndexMap,
    config,
    credentials,
    vehicleTypes,
    maxPerRoute,
    rateLimiter,
    specialRequests,
  );
  console.info(
    `[vrp-optimizer] Phase 4b: local search relocate moves=${relocateResult.movesApplied} apiCalls=${relocateResult.apiCallsUsed}`,
  );

  // Consolidation — merge pairs where R$14 surcharge savings > cost increase
  for (let consolidationPass = 0; consolidationPass < 3; consolidationPass += 1) {
    let didMerge = false;
    for (let i = 0; i < mutableRoutes.length; i += 1) {
      const a = mutableRoutes[i];
      if (!a || a.cluster.length === 0) continue;
      for (let j = i + 1; j < mutableRoutes.length; j += 1) {
        const b = mutableRoutes[j];
        if (!b || b.cluster.length === 0) continue;
        if (a.cluster.length + b.cluster.length > maxPerRoute) continue;

        const separateCost = a.costSubunits + b.costSubunits + 2 * WAIT_SURCHARGE_SUBUNITS;
        const merged = [...a.cluster, ...b.cluster];

        // Skip merge if combined cluster would exceed geographic spread threshold
        if (clusterSpread(merged, matrix, phase1IdxMap) > MAX_ROUTE_SPREAD_METERS) continue;

        let bestMergedQuote: { costSubunits: number; costTotal: string; costCurrency: string; serviceType: string } | null = null;
        for (const serviceType of vehicleTypes) {
          const q = await quoteCluster(merged, config, serviceType, credentials, rateLimiter, specialRequests);
          if (q && (bestMergedQuote === null || q.costSubunits < bestMergedQuote.costSubunits)) {
            bestMergedQuote = { ...q, serviceType };
          }
        }
        if (!bestMergedQuote) continue;

        const mergedCost = bestMergedQuote.costSubunits + WAIT_SURCHARGE_SUBUNITS;
        // Accept the merge even if marginally more expensive: removing one
        // dispatch has operational value (less driver coordination, less
        // back-office work). Tolerance is R$3 worth of subunits.
        if (mergedCost < separateCost + CONSOLIDATION_OPERATIONAL_TOLERANCE_SUBUNITS) {
          const delta = separateCost - mergedCost;
          const label = delta >= 0 ? `saving ${delta}` : `extra ${-delta} within tolerance`;
          console.info(`[vrp-optimizer] Consolidation: merging routes ${i}+${j} (${a.cluster.length}+${b.cluster.length} orders), ${label} subunits`);
          a.cluster = merged;
          a.costSubunits = bestMergedQuote.costSubunits;
          a.costTotal = bestMergedQuote.costTotal;
          a.costCurrency = bestMergedQuote.costCurrency;
          a.serviceType = bestMergedQuote.serviceType;
          b.cluster = [];
          didMerge = true;
        }
      }
    }
    for (let k = mutableRoutes.length - 1; k >= 0; k -= 1) {
      if (mutableRoutes[k]!.cluster.length === 0) mutableRoutes.splice(k, 1);
    }
    if (!didMerge) break;
  }

  console.info("[vrp-optimizer] Phase 4: after enforcement + consolidation:", mutableRoutes.map((r) => r.cluster.length));

  // ── Phase 5: Render polylines + cache ────────────────────────────────────
  const routes: VRPRouteResult[] = [];
  for (let i = 0; i < mutableRoutes.length; i += 1) {
    const r = mutableRoutes[i]!;
    let renderPolyline = "";
    if (r.cluster.length >= 1 && googleApiKey) {
      try {
        const routeResult = await computeRoutePolyline(googleApiKey, depot, r.cluster);
        renderPolyline = routeResult.polyline;
      } catch {
        console.warn(`[vrp-optimizer] Render polyline fetch failed for route ${i}`);
      }
    }
    routes.push({
      routeIndex: i,
      locationId: r.cluster[0]!.locationId,
      orderIds: r.cluster.map((o) => o.orderId),
      costTotal: r.costTotal,
      costCurrency: r.costCurrency,
      serviceType: r.serviceType,
      costSubunits: r.costSubunits,
      waitSurchargeSubunits: WAIT_SURCHARGE_SUBUNITS,
      corridorPolyline: renderPolyline,
    });
  }

  // ── Phase 5b: Detour-cost refinement ─────────────────────────────────────
  // For each order in a non-minimum-size route, compute the distance saved by
  // removing it from its current route vs. the distance added by inserting it
  // into another route. Threshold is adaptive: lower for small batches where
  // border-zone differences are subtle, higher for large batches to avoid
  // trivial swaps.
  const detourThreshold = detourMinGain(orders.length);
  if (routes.length >= 2) {
    // Build orderId → OptimizerOrderInput lookup once
    const allOrdersById = new Map<string, OptimizerOrderInput>();
    for (const o of phase1Orders) allOrdersById.set(o.orderId, o);
    for (const o of phase2Orders) allOrdersById.set(o.orderId, o);

    for (let pIter = 0; pIter < DETOUR_REFINEMENT_MAX_ITERATIONS; pIter += 1) {
      // Pre-compute each route's current TSP total (nearest-neighbor estimate)
      const routeTotals: number[] = routes.map((r) => {
        const stops = r.orderIds
          .map((id) => allOrdersById.get(id)?.shippingCoordinates)
          .filter(Boolean) as Coordinate[];
        return estimateRouteTotalDistance(depot, stops);
      });

      type DetourCandidate = {
        orderId: string;
        fromRoute: number;
        toRoute: number;
        netGain: number;
      };
      const candidates: DetourCandidate[] = [];

      for (let ri = 0; ri < routes.length; ri += 1) {
        const src = routes[ri]!;
        // Size-1 (solo) routes are allowed as sources: removing their only
        // order dissolves the route entirely and saves the base fee.
        // Size-2 routes are skipped because removing one would leave a new solo.
        // Size-3+ routes are always allowed.
        if (src.orderIds.length >= 2 && src.orderIds.length <= MIN_ORDERS_PER_ROUTE) continue;

        for (const oid of src.orderIds) {
          const order = allOrdersById.get(oid);
          if (!order) continue;

          // Removal saving: distance shrunk by removing this order from src
          const srcStopsWithout = src.orderIds
            .filter((id) => id !== oid)
            .map((id) => allOrdersById.get(id)?.shippingCoordinates)
            .filter(Boolean) as Coordinate[];
          const srcTotalWithout = estimateRouteTotalDistance(depot, srcStopsWithout);
          const removalSaving = routeTotals[ri]! - srcTotalWithout;

          // Evaluate each possible destination route
          for (let rj = 0; rj < routes.length; rj += 1) {
            if (rj === ri) continue;
            const dst = routes[rj]!;
            if (dst.orderIds.length >= maxPerRoute) continue;

            // Spread constraint on the receiving route.
            // Solo dissolution moves get a relaxed spread limit since the
            // alternative (keeping the solo) has a fixed R$14 cost.
            const dstOrders = dst.orderIds
              .map((id) => allOrdersById.get(id))
              .filter(Boolean) as OptimizerOrderInput[];
            const trialCluster = [...dstOrders, order];
            const isSoloDissolution = src.orderIds.length === 1;
            const spreadLimit = isSoloDissolution
              ? MAX_ROUTE_SPREAD_METERS * SOLO_DISSOLUTION_SPREAD_FACTOR
              : MAX_ROUTE_SPREAD_METERS;
            if (clusterSpread(trialCluster, matrix, phase1IdxMap) > spreadLimit) continue;

            // Insertion cost: distance added by inserting this order into dst
            const dstStopsWith = [...dstOrders.map((o) => o.shippingCoordinates), order.shippingCoordinates];
            const dstTotalWith = estimateRouteTotalDistance(depot, dstStopsWith);
            const insertionCost = dstTotalWith - routeTotals[rj]!;

            // Solo dissolution reward: if removing this order empties the
            // source route, the move saves the R$14 base fee.
            const soloReward = src.orderIds.length === 1 ? BASE_FEE_METERS_EQUIVALENT : 0;

            const netGain = removalSaving - insertionCost + soloReward;
            if (netGain >= detourThreshold) {
              candidates.push({ orderId: oid, fromRoute: ri, toRoute: rj, netGain });
            }
          }
        }
      }

      if (candidates.length === 0) {
        console.info(`[vrp-optimizer] Phase 5b: detour refinement iter=${pIter} -- no candidates (threshold=${detourThreshold}m, orders=${orders.length})`);
        break;
      }

      // Sort by biggest gain first
      candidates.sort((a, b) => b.netGain - a.netGain);

      // Greedily apply non-conflicting moves (only one move per route per iter)
      const touchedRoutes = new Set<number>();
      const movedIds = new Set<string>();
      let movesApplied = 0;

      for (const cand of candidates) {
        if (movedIds.has(cand.orderId)) continue;
        if (touchedRoutes.has(cand.fromRoute) || touchedRoutes.has(cand.toRoute)) continue;

        const srcRoute = routes[cand.fromRoute]!;
        const dstRoute = routes[cand.toRoute]!;
        // Same source-size rule as candidate generation: allow size-1 (dissolve),
        // block size-2 (would leave a new solo), allow size-3+.
        if (srcRoute.orderIds.length >= 2 && srcRoute.orderIds.length <= MIN_ORDERS_PER_ROUTE) continue;
        if (dstRoute.orderIds.length >= maxPerRoute) continue;

        srcRoute.orderIds = srcRoute.orderIds.filter((id) => id !== cand.orderId);
        dstRoute.orderIds.push(cand.orderId);
        touchedRoutes.add(cand.fromRoute);
        touchedRoutes.add(cand.toRoute);
        movedIds.add(cand.orderId);
        movesApplied += 1;

        const dissolvedTag = srcRoute.orderIds.length === 0 ? " [dissolved source]" : "";
        console.info(
          `[vrp-optimizer] Phase 5b: detour relocate ${cand.orderId.split("/").pop()} route ${cand.fromRoute}->${cand.toRoute} (gain=${Math.round(cand.netGain)}m)${dissolvedTag}`,
        );
      }

      if (movesApplied === 0) break;

      // Re-render polylines and re-quote only for touched non-empty routes
      for (const ri of touchedRoutes) {
        const route = routes[ri]!;
        if (route.orderIds.length === 0) continue; // will be removed below
        const routeOrders = route.orderIds
          .map((id) => allOrdersById.get(id))
          .filter(Boolean) as OptimizerOrderInput[];

        if (routeOrders.length >= 1 && googleApiKey) {
          try {
            const result = await computeRoutePolyline(googleApiKey, depot, routeOrders);
            route.corridorPolyline = result.polyline;
          } catch {
            console.warn(`[vrp-optimizer] Phase 5b: polyline re-render failed route ${ri} -- clearing stale polyline`);
            route.corridorPolyline = "";
          }
        } else {
          route.corridorPolyline = "";
        }

        // Re-quote with Lalamove
        let bestQuote: { costSubunits: number; costTotal: string; costCurrency: string; serviceType: string } | null = null;
        for (const serviceType of vehicleTypes) {
          const q = await quoteCluster(routeOrders, config, serviceType, credentials, rateLimiter, specialRequests);
          if (q && (bestQuote === null || q.costSubunits < bestQuote.costSubunits)) {
            bestQuote = { ...q, serviceType };
          }
        }
        if (bestQuote) {
          route.costSubunits = bestQuote.costSubunits;
          route.costTotal = bestQuote.costTotal;
          route.costCurrency = bestQuote.costCurrency;
          route.serviceType = bestQuote.serviceType;
        }
      }

      // Remove any routes that were emptied by dissolution moves, then
      // reindex so routeIndex still matches the array position.
      const dissolvedCount = routes.filter((r) => r.orderIds.length === 0).length;
      if (dissolvedCount > 0) {
        for (let k = routes.length - 1; k >= 0; k -= 1) {
          if (routes[k]!.orderIds.length === 0) routes.splice(k, 1);
        }
        routes.forEach((r, idx) => { r.routeIndex = idx; });
        console.info(`[vrp-optimizer] Phase 5b: dissolved ${dissolvedCount} empty route(s), now ${routes.length} routes`);
      }

      console.info(
        `[vrp-optimizer] Phase 5b: detour refinement iter=${pIter} moves=${movesApplied} reRendered=${touchedRoutes.size}`,
      );
    }
  }

  // Cache polylines to DB
  try {
    await Promise.all(
      routes
        .filter((r) => r.corridorPolyline)
        .map((r) => {
          const orderIdsKey = [...r.orderIds].sort().join("|");
          return prisma.routePolylineCache.upsert({
            where: { shop_locationId_orderIdsKey: { shop, locationId: r.locationId, orderIdsKey } },
            update: { encodedPolyline: r.corridorPolyline },
            create: { shop, locationId: r.locationId, orderIdsKey, encodedPolyline: r.corridorPolyline },
          });
        }),
    );
  } catch (err) {
    console.warn("[vrp-optimizer] Failed to cache polylines:", err instanceof Error ? err.message : String(err));
  }

  // ── Build summary ────────────────────────────────────────────────────────
  const rawLalamoveCostSubunits = routes.reduce((sum, r) => sum + r.costSubunits, 0);
  const totalWaitSurchargeSubunits = routes.length * WAIT_SURCHARGE_SUBUNITS;
  const totalCostSubunits = rawLalamoveCostSubunits + totalWaitSurchargeSubunits;
  const currency = routes[0]?.costCurrency ?? "BRL";

  console.info("[vrp-optimizer] Result:", {
    routeCount: routes.length,
    totalOrders: routes.reduce((sum, r) => sum + r.orderIds.length, 0),
    lalamoveCost: `${currency} ${(rawLalamoveCostSubunits / 100).toFixed(2)}`,
    waitSurcharge: `${currency} ${(totalWaitSurchargeSubunits / 100).toFixed(2)}`,
    totalCost: `${currency} ${(totalCostSubunits / 100).toFixed(2)}`,
    routeSizes: routes.map((r) => r.orderIds.length),
  });

  return {
    ok: true,
    routes,
    summary: {
      routeCount: routes.length,
      totalOrders: routes.reduce((sum, r) => sum + r.orderIds.length, 0),
      totalCost: (totalCostSubunits / 100).toFixed(2),
      costCurrency: currency,
      totalLalamoveCost: (rawLalamoveCostSubunits / 100).toFixed(2),
      totalWaitSurcharge: (totalWaitSurchargeSubunits / 100).toFixed(2),
    },
  };
}

// ─── Polyline cache lookup ─────────────────────────────────────────────────

/**
 * Look up cached corridor polylines for a set of routes.
 * Returns a map of routeId → encoded polyline string.
 * Used by the loader to render road paths without Google API calls.
 */
export async function lookupCachedPolylines(
  shop: string,
  routes: Array<{ id: string; locationId: string; orderIds: string[] }>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (routes.length === 0) return result;

  try {
    const lookups = routes
      .filter((r) => r.orderIds.length > 0)
      .map((r) => ({
        routeId: r.id,
        locationId: r.locationId,
        orderIdsKey: [...r.orderIds].sort().join("|"),
      }));

    const cached = await prisma.routePolylineCache.findMany({
      where: {
        shop,
        OR: lookups.map((l) => ({
          locationId: l.locationId,
          orderIdsKey: l.orderIdsKey,
        })),
      },
    });

    const byKey = new Map(cached.map((c) => [`${c.locationId}|${c.orderIdsKey}`, c.encodedPolyline]));

    for (const lookup of lookups) {
      const polyline = byKey.get(`${lookup.locationId}|${lookup.orderIdsKey}`);
      if (polyline) {
        result.set(lookup.routeId, polyline);
      }
    }
  } catch {
    // DB unavailable — return empty map, routes render as straight-line connectors
  }

  return result;
}

// ─── Add-to-best-route export ───────────────────────────────────────────────

export type ExistingRouteInput = {
  routeIndex: number;
  locationId: string;
  orderIds: string[];
};

/**
 * For each unassigned order, quotes it against every existing route and
 * assigns it to the route that produces the minimum incremental cost increase.
 * Returns the updated routes in the same CarrierQuotationResult shape as
 * optimizeByCarrierQuotation so the UI effect can handle both responses.
 */
export async function addToExistingRoutesByCarrierQuotation(
  existingRoutes: ExistingRouteInput[],
  unassignedOrders: OptimizerOrderInput[],
  allOrdersById: Map<string, OptimizerOrderInput>,
  config: LalamoveConfig,
  credentials: LalamoveCredentials,
  vehicleOptions: { primary: string; secondary?: string },
  specialRequests?: string[],
): Promise<CarrierQuotationResult> {
  if (unassignedOrders.length === 0) {
    return { ok: false, error: "No unassigned orders to assign." };
  }
  if (existingRoutes.length === 0) {
    return { ok: false, error: "No existing routes to assign orders to." };
  }
  if (config.pickupLat == null || config.pickupLng == null) {
    return { ok: false, error: "Pickup coordinates missing in location config." };
  }

  const rateLimiter = new RateLimiter();
  const vehicleTypes = [vehicleOptions.primary];
  if (vehicleOptions.secondary && vehicleOptions.secondary !== vehicleOptions.primary) {
    vehicleTypes.push(vehicleOptions.secondary);
  }

  // Build mutable route state: current cluster + cached current quote cost
  type MutableExistingRoute = {
    routeIndex: number;
    locationId: string;
    cluster: OptimizerOrderInput[];
    currentCostSubunits: number;
    costCurrency: string;
    serviceType: string;
  };

  // Initialise: look up order details for each route's current orderIds
  const mutableRoutes: MutableExistingRoute[] = existingRoutes.map((r) => {
    const cluster = r.orderIds
      .map((id) => allOrdersById.get(id))
      .filter((o): o is OptimizerOrderInput => Boolean(o));
    return {
      routeIndex: r.routeIndex,
      locationId: r.locationId,
      cluster,
      currentCostSubunits: 0,
      costCurrency: "BRL",
      serviceType: vehicleOptions.primary,
    };
  });

  // Quote each existing route to get baseline costs
  for (const route of mutableRoutes) {
    if (route.cluster.length === 0) continue;
    let bestQuote: { costSubunits: number; costCurrency: string; serviceType: string } | null = null;
    for (const serviceType of vehicleTypes) {
      const q = await quoteCluster(route.cluster, config, serviceType, credentials, rateLimiter, specialRequests);
      if (q && (bestQuote === null || q.costSubunits < bestQuote.costSubunits)) {
        bestQuote = { costSubunits: q.costSubunits, costCurrency: q.costCurrency, serviceType };
      }
    }
    if (bestQuote) {
      route.currentCostSubunits = bestQuote.costSubunits;
      route.costCurrency = bestQuote.costCurrency;
      route.serviceType = bestQuote.serviceType;
    }
  }

  // For each unassigned order, find the route with minimum incremental cost
  for (const order of unassignedOrders) {
    const compatible = mutableRoutes.filter(
      (r) => r.locationId === order.locationId && r.cluster.length < LALAMOVE_MAX_DELIVERY_STOPS,
    );
    if (compatible.length === 0) continue;

    let bestRouteIdx = -1;
    let bestIncremental = Number.POSITIVE_INFINITY;

    for (let i = 0; i < compatible.length; i++) {
      const route = compatible[i]!;
      const extended = [...route.cluster, order];
      let cheapestExtended: number | null = null;
      for (const serviceType of vehicleTypes) {
        const q = await quoteCluster(extended, config, serviceType, credentials, rateLimiter, specialRequests);
        if (q && (cheapestExtended === null || q.costSubunits < cheapestExtended)) {
          cheapestExtended = q.costSubunits;
        }
      }
      if (cheapestExtended === null) continue;
      const incremental = cheapestExtended - route.currentCostSubunits;
      if (incremental < bestIncremental) {
        bestIncremental = incremental;
        bestRouteIdx = i;
      }
    }

    if (bestRouteIdx >= 0) {
      const target = compatible[bestRouteIdx]!;
      target.cluster.push(order);
      // Re-quote with cheapest vehicle after adding the order
      let newCost = target.currentCostSubunits;
      for (const serviceType of vehicleTypes) {
        const q = await quoteCluster(target.cluster, config, serviceType, credentials, rateLimiter, specialRequests);
        if (q && q.costSubunits < newCost) {
          newCost = q.costSubunits;
          target.costCurrency = q.costCurrency;
          target.serviceType = serviceType;
        }
      }
      target.currentCostSubunits = newCost;
    }
  }

  // Build result in the same shape as optimizeByCarrierQuotation
  const activeRoutes = mutableRoutes.filter((r) => r.cluster.length > 0);
  const routes: CarrierRouteResult[] = activeRoutes.map((r) => ({
    routeIndex: r.routeIndex,
    locationId: r.locationId,
    orderIds: r.cluster.map((o) => o.orderId),
    costTotal: (r.currentCostSubunits / 100).toFixed(2),
    costCurrency: r.costCurrency,
    serviceType: r.serviceType,
    costSubunits: r.currentCostSubunits,
    waitSurchargeSubunits: WAIT_SURCHARGE_SUBUNITS,
  }));

  const rawLalamoveCostSubunits = activeRoutes.reduce((sum, r) => sum + r.currentCostSubunits, 0);
  const totalWaitSurchargeSubunits = activeRoutes.length * WAIT_SURCHARGE_SUBUNITS;
  const totalCostSubunits = rawLalamoveCostSubunits + totalWaitSurchargeSubunits;
  const currency = activeRoutes.find((r) => r.costCurrency)?.costCurrency ?? "BRL";

  return {
    ok: true,
    routes,
    summary: {
      routeCount: routes.length,
      totalOrders: routes.reduce((sum, r) => sum + r.orderIds.length, 0),
      totalCost: (totalCostSubunits / 100).toFixed(2),
      costCurrency: currency,
      totalLalamoveCost: (rawLalamoveCostSubunits / 100).toFixed(2),
      totalWaitSurcharge: (totalWaitSurchargeSubunits / 100).toFixed(2),
    },
  };
}
