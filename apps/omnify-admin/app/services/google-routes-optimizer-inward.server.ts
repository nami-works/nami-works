/**
 * Inverse-Inward Matrix Clustering (Greedy-Seed Logic).
 * Builds routes from farthest seeds inward to depot using real road costs.
 */

import {
  type Coordinate,
  type OptimizerOrderInput,
  type OptimizerRouteResult,
  type OptimizeFleetResult,
  computeRoutePolyline,
  MAX_ORDERS_PER_ROUTE,
} from "./google-routes-shared.server";
import {
  haversineMeters,
  findClosestPointOnPath,
} from "../utils/polyline.server";

const MATRIX_CHUNK_SIZE = 10;

type DistanceMatrix = number[][];

async function fetchDistanceMatrixChunk(
  apiKey: string,
  origins: Coordinate[],
  destinations: Coordinate[],
): Promise<{ rows: { elements: { distance?: { value: number }; status: string }[] }[] }> {
  const originsStr = origins
    .map((c) => `${c.latitude},${c.longitude}`)
    .join("|");
  const destsStr = destinations
    .map((c) => `${c.latitude},${c.longitude}`)
    .join("|");
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(originsStr)}&destinations=${encodeURIComponent(destsStr)}&mode=driving&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Distance Matrix API request failed");
  const json = await res.json();
  if (json.status !== "OK") throw new Error("Distance Matrix API error");
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

function polarAngle(depot: Coordinate, point: Coordinate): number {
  const dy = point.latitude - depot.latitude;
  const dx =
    (point.longitude - depot.longitude) * Math.cos((depot.latitude * Math.PI) / 180);
  return Math.atan2(dy, dx);
}

function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

function getSeedPoints(
  matrix: DistanceMatrix,
  points: Coordinate[],
  depotIdx: number,
  count: number,
): number[] {
  const distFromDepot = matrix[depotIdx]!;
  const indices = Array.from({ length: points.length }, (_, i) => i)
    .filter((i) => i !== depotIdx)
    .sort((a, b) => (distFromDepot[b] ?? 0) - (distFromDepot[a] ?? 0));

  const seeds: number[] = [];
  const depot = points[depotIdx]!;
  for (const idx of indices) {
    if (seeds.length >= count) break;
    const angle = polarAngle(depot, points[idx]!);
    const tooClose = seeds.some((s) => angleDiff(angle, polarAngle(depot, points[s]!)) < 0.5);
    if (!tooClose) seeds.push(idx);
  }
  if (seeds.length < count) {
    for (const idx of indices) {
      if (seeds.length >= count) break;
      if (!seeds.includes(idx)) seeds.push(idx);
    }
  }
  return seeds.slice(0, count);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length <= 1) return 0;
  const m = mean(values);
  const sqDiffs = values.map((v) => (v - m) ** 2);
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / values.length);
}

export async function optimizeFleetRoutesInward(
  apiKey: string,
  orders: OptimizerOrderInput[],
): Promise<OptimizeFleetResult> {
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

  const mustAssign = orders.filter((o) => o.mustAssign === true);
  const conditional = orders.filter((o) => o.mustAssign !== true);
  const phase1 = mustAssign.length > 0 ? mustAssign : orders;
  const phase2 = mustAssign.length > 0 ? conditional : [];

  const byLocation = new Map<string, OptimizerOrderInput[]>();
  phase1.forEach((o) => {
    const bucket = byLocation.get(o.locationId) ?? [];
    bucket.push(o);
    byLocation.set(o.locationId, bucket);
  });

  const routes: OptimizerRouteResult[] = [];
  let globalIdx = 0;
  const allOrders = [...phase1, ...phase2];

  for (const [locationId, locationOrders] of byLocation.entries()) {
    const depot = locationOrders[0]!.locationCoordinates;
    const points: Coordinate[] = [depot, ...locationOrders.map((o) => o.shippingCoordinates)];
    const orderIndices = Array.from({ length: locationOrders.length }, (_, i) => i + 1);
    const depotIdx = 0;

    let matrix: DistanceMatrix;
    try {
      matrix = await fetchFullDistanceMatrix(apiKey, points);
    } catch {
      matrix = points.map((_, i) =>
        points.map((_, j) => haversineMeters(points[i]!, points[j]!)),
      );
    }

    const routeCount = Math.max(
      1,
      Math.min(
        Math.ceil(locationOrders.length / 4),
        locationOrders.length,
      ),
    );
    const seeds = getSeedPoints(matrix, points, depotIdx, routeCount);

    const assigned = new Set<number>();
    const preRoutes: number[][] = [];

    for (const seedIdx of seeds) {
      const bucket: number[] = [];
      let current = seedIdx;
      assigned.add(seedIdx);

      while (true) {
        const distFromCurrent = matrix[current]!;
        const depotDist = distFromCurrent[depotIdx] ?? Infinity;
        let bestNext = -1;
        let bestDist = Infinity;

        for (let j = 1; j < points.length; j += 1) {
          if (assigned.has(j)) continue;
          const d = distFromCurrent[j] ?? Infinity;
          const jToDepot = matrix[j]?.[depotIdx] ?? Infinity;
          if (d < bestDist && jToDepot < depotDist) {
            bestDist = d;
            bestNext = j;
          }
        }

        if (bestNext < 0) break;
        bucket.push(bestNext);
        assigned.add(bestNext);
        current = bestNext;

        if (bucket.length >= MAX_ORDERS_PER_ROUTE) break;
      }

      if (bucket.length > 0) preRoutes.push(bucket);
    }

    if (preRoutes.length === 0) {
      preRoutes.push([...orderIndices]);
      orderIndices.forEach((idx) => assigned.add(idx));
    }

    for (const idx of orderIndices) {
      if (!assigned.has(idx)) {
        let bestRoute = -1;
        let bestDist = Infinity;
        for (let r = 0; r < preRoutes.length; r += 1) {
          const d = matrix[idx]?.[preRoutes[r]![0]!] ?? Infinity;
          if (d < bestDist) {
            bestDist = d;
            bestRoute = r;
          }
        }
        if (bestRoute >= 0) preRoutes[bestRoute]!.push(idx);
      }
    }

    const counts = preRoutes.map((r) => r.length);
    const mu = mean(counts);
    const sigma = standardDeviation(counts);
    const orphanThreshold = Math.max(1, Math.floor(mu - sigma));

    const orphanIndices: number[] = [];
    let nonOrphanRoutes: number[][] = [];
    for (let i = 0; i < preRoutes.length; i += 1) {
      if (counts[i]! < orphanThreshold) {
        orphanIndices.push(...preRoutes[i]!);
      } else {
        nonOrphanRoutes.push(preRoutes[i]!);
      }
    }
    if (nonOrphanRoutes.length === 0) {
      nonOrphanRoutes = [...preRoutes];
      orphanIndices.length = 0;
    }

    const routeOrdersList: OptimizerOrderInput[][] = nonOrphanRoutes.map(
      (indices) => indices.map((i) => locationOrders[i - 1]!),
    );

    for (const routeOrders of routeOrdersList) {
      if (routeOrders.length === 0) continue;
      const origin = routeOrders[0]!.locationCoordinates;
      const result = await computeRoutePolyline(apiKey, origin, routeOrders);
      routes.push({
        routeIndex: globalIdx++,
        locationId,
        orderIds: result.ordered.map((o) => o.orderId),
        polyline: result.polyline,
        totalDistanceMeters: result.distanceMeters,
        totalDurationSeconds: result.durationSeconds,
      });
    }

    for (const orphanIdx of orphanIndices) {
      const orphanOrder = locationOrders[orphanIdx - 1]!;
      const orphanPoint = orphanOrder.shippingCoordinates;
      let bestRouteIdx = -1;
      let bestPathDist = Infinity;

      for (let r = 0; r < routes.length; r += 1) {
        const route = routes[r]!;
        if (route.locationId !== locationId || route.orderIds.length >= MAX_ORDERS_PER_ROUTE)
          continue;
        const { distanceMeters } = findClosestPointOnPath(orphanPoint, route.polyline);
        if (distanceMeters < bestPathDist) {
          bestPathDist = distanceMeters;
          bestRouteIdx = r;
        }
      }

      if (bestRouteIdx >= 0) {
        routes[bestRouteIdx]!.orderIds.push(orphanOrder.orderId);
        routes[bestRouteIdx]!.polyline = "";
      }
    }
  }

  for (const route of routes) {
    if (route.polyline !== "") continue;
    const routeOrders = route.orderIds
      .map((id) => allOrders.find((o) => o.orderId === id))
      .filter((o): o is OptimizerOrderInput => o != null);
    if (routeOrders.length === 0) continue;
    const origin = routeOrders[0]!.locationCoordinates;
    const result = await computeRoutePolyline(apiKey, origin, routeOrders);
    route.polyline = result.polyline;
    route.totalDistanceMeters = result.distanceMeters;
    route.totalDurationSeconds = result.durationSeconds;
    route.orderIds = result.ordered.map((o) => o.orderId);
  }

  for (const order of phase2) {
    let bestIdx = -1;
    let bestPathDist = Infinity;
    for (let i = 0; i < routes.length; i += 1) {
      const r = routes[i]!;
      if (r.locationId !== order.locationId || r.orderIds.length >= MAX_ORDERS_PER_ROUTE)
        continue;
      const { distanceMeters } = findClosestPointOnPath(
        order.shippingCoordinates,
        r.polyline,
      );
      if (distanceMeters < bestPathDist) {
        bestPathDist = distanceMeters;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      routes[bestIdx]!.orderIds.push(order.orderId);
      routes[bestIdx]!.polyline = "";
    }
  }

  const assignedOrderIds = new Set(routes.flatMap((r) => r.orderIds));
  for (const order of allOrders) {
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

  for (const route of routes) {
    if (route.polyline !== "") continue;
    const routeOrders = route.orderIds
      .map((id) => allOrders.find((o) => o.orderId === id))
      .filter((o): o is OptimizerOrderInput => o != null);
    if (routeOrders.length === 0) continue;
    const origin = routeOrders[0]!.locationCoordinates;
    const result = await computeRoutePolyline(apiKey, origin, routeOrders);
    route.polyline = result.polyline;
    route.totalDistanceMeters = result.distanceMeters;
    route.totalDurationSeconds = result.durationSeconds;
    route.orderIds = result.ordered.map((o) => o.orderId);
  }

  const totalDistanceMeters = routes.reduce((s, r) => s + r.totalDistanceMeters, 0);
  const totalDurationSeconds = routes.reduce((s, r) => s + r.totalDurationSeconds, 0);

  return {
    routes,
    summary: {
      routeCount: routes.length,
      totalDistanceMeters,
      totalDurationSeconds,
      totalOrders: orders.length,
    },
  };
}
