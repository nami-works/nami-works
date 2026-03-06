/**
 * Human-Centric Route Optimization (VRP-Geo).
 * Prioritizes topological coherence: cone-shaped routes, no U-turns >120°.
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
  distanceToPolyline,
  pathsIntersect,
} from "../utils/polyline.server";

const U_TURN_THRESHOLD_DEG = 120;
const DENSE_THRESHOLD_M = 500;
const SPARSE_THRESHOLD_M = 3000;
const HEADING_WEIGHT = 0.7;
const DISTANCE_WEIGHT = 0.3;

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

function headingDeg(a: Coordinate, b: Coordinate): number {
  const deg = (Math.atan2(b.longitude - a.longitude, b.latitude - a.latitude) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}

function angleAtVertex(a: Coordinate, b: Coordinate, c: Coordinate): number {
  const ba = headingDeg(b, a);
  const bc = headingDeg(b, c);
  let diff = Math.abs(bc - ba);
  if (diff > 180) diff = 360 - diff;
  return diff;
}

function getDynamicThreshold(depot: Coordinate, orders: OptimizerOrderInput[]): number {
  const avgDist =
    orders.reduce((s, o) => s + haversineMeters(depot, o.shippingCoordinates), 0) /
    Math.max(1, orders.length);
  return avgDist < 2000 ? DENSE_THRESHOLD_M : SPARSE_THRESHOLD_M;
}

function calculateSuitability(
  order: OptimizerOrderInput,
  route: { polyline: string; targetHeading: number; depot: Coordinate },
  allOrders: OptimizerOrderInput[],
): number {
  const depot = route.depot;
  const orderAngle = polarAngle(depot, order.shippingCoordinates);
  const headingCompat = 1 - angleDiff(orderAngle, route.targetHeading) / Math.PI;
  const distToDepot = haversineMeters(depot, order.shippingCoordinates);
  const maxDist = Math.max(
    ...allOrders.map((o) => haversineMeters(depot, o.shippingCoordinates)),
    1,
  );
  const distScore = 1 - distToDepot / maxDist;
  return HEADING_WEIGHT * headingCompat + DISTANCE_WEIGHT * distScore;
}

function radialCluster(
  orders: OptimizerOrderInput[],
  routeCount: number,
  depot: Coordinate,
): OptimizerOrderInput[][] {
  if (orders.length <= 1 || routeCount <= 1) return [orders];
  const sorted = [...orders].sort(
    (a, b) =>
      haversineMeters(depot, b.shippingCoordinates) -
      haversineMeters(depot, a.shippingCoordinates),
  );
  const seedStep = Math.max(1, Math.floor(sorted.length / routeCount));
  const seeds = Array.from({ length: routeCount }, (_, i) =>
    sorted[Math.min(i * seedStep, sorted.length - 1)]!,
  );
  const cones: OptimizerOrderInput[][] = Array.from({ length: routeCount }, () => []);
  const seedAngles = seeds.map((s) => polarAngle(depot, s.shippingCoordinates));

  for (const order of orders) {
    const angle = polarAngle(depot, order.shippingCoordinates);
    let bestIdx = 0;
    let bestDiff = angleDiff(angle, seedAngles[0]!);
    for (let i = 1; i < seedAngles.length; i += 1) {
      const d = angleDiff(angle, seedAngles[i]!);
      if (d < bestDiff) {
        bestDiff = d;
        bestIdx = i;
      }
    }
    cones[bestIdx]!.push(order);
  }

  const result: OptimizerOrderInput[][] = [];
  for (const cone of cones) {
    if (cone.length === 0) continue;
    for (let i = 0; i < cone.length; i += MAX_ORDERS_PER_ROUTE) {
      result.push(cone.slice(i, i + MAX_ORDERS_PER_ROUTE));
    }
  }
  return result;
}

export async function optimizeFleetRoutesTopological(
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

  for (const [locationId, locationOrders] of byLocation.entries()) {
    const depot = locationOrders[0]!.locationCoordinates;
    const minRoutes = Math.max(1, Math.ceil(locationOrders.length / MAX_ORDERS_PER_ROUTE));
    const maxRoutes = Math.min(locationOrders.length, 10);
    let bestTotal = Number.POSITIVE_INFINITY;
    let bestRoutes: OptimizerRouteResult[] = [];

    for (let k = minRoutes; k <= maxRoutes; k += 1) {
      const clusters = radialCluster(locationOrders, k, depot);
      const partitionRoutes: OptimizerRouteResult[] = [];
      let total = 0;
      for (let i = 0; i < clusters.length; i += 1) {
        const cluster = clusters[i]!;
        if (cluster.length === 0) continue;
        const origin = cluster[0]!.locationCoordinates;
        const result = await computeRoutePolyline(apiKey, origin, cluster);
        partitionRoutes.push({
          routeIndex: globalIdx + partitionRoutes.length,
          locationId,
          orderIds: result.ordered.map((o) => o.orderId),
          polyline: result.polyline,
          totalDistanceMeters: result.distanceMeters,
          totalDurationSeconds: result.durationSeconds,
        });
        total += result.distanceMeters;
      }
      if (total < bestTotal) {
        bestTotal = total;
        bestRoutes = partitionRoutes;
      }
    }

    for (const r of bestRoutes) {
      routes.push({ ...r, routeIndex: globalIdx++ });
    }
  }

  const threshold = getDynamicThreshold(
    phase1[0]!.locationCoordinates,
    phase1,
  );
  const allOrders = [...phase1, ...phase2];

  const cleanupPass = async () => {
    for (let ri = 0; ri < routes.length; ri += 1) {
      const route = routes[ri]!;
      if (route.orderIds.length < 3 || !route.polyline) continue;
      const routeOrders = route.orderIds
        .map((id) => allOrders.find((o) => o.orderId === id))
        .filter((o): o is OptimizerOrderInput => o != null);
      const depot = routeOrders[0]!.locationCoordinates;
      const coords = [depot, ...routeOrders.map((o) => o.shippingCoordinates)];

      for (let i = 1; i < coords.length - 1; i += 1) {
        const angle = angleAtVertex(coords[i - 1]!, coords[i]!, coords[i + 1]!);
        if (angle <= U_TURN_THRESHOLD_DEG) continue;
        const order = routeOrders[i - 1]!;
        let bestOtherIdx = -1;
        let bestPathDist = Number.POSITIVE_INFINITY;

        for (let rj = 0; rj < routes.length; rj += 1) {
          if (rj === ri) continue;
          const other = routes[rj]!;
          if (other.locationId !== route.locationId || !other.polyline) continue;
          const pathDist = distanceToPolyline(order.shippingCoordinates, other.polyline);
          if (pathDist < threshold && pathDist < bestPathDist) {
            const wouldCreateCross =
              pathsIntersect(route.polyline, other.polyline);
            if (!wouldCreateCross) {
              bestPathDist = pathDist;
              bestOtherIdx = rj;
            }
          }
        }

        if (bestOtherIdx >= 0) {
          const other = routes[bestOtherIdx]!;
          other.orderIds.push(order.orderId);
          route.orderIds = route.orderIds.filter((id) => id !== order.orderId);
          route.polyline = "";
          other.polyline = "";
        }
      }
    }

    for (const route of routes) {
      if (route.polyline !== "" || route.orderIds.length === 0) continue;
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
  };

  await cleanupPass();

  for (const order of phase2) {
    let bestIdx = -1;
    let bestSuit = -1;
    const depot = order.locationCoordinates;

    for (let i = 0; i < routes.length; i += 1) {
      const r = routes[i]!;
      if (r.locationId !== order.locationId) continue;
      if (r.orderIds.length >= MAX_ORDERS_PER_ROUTE) continue;
      const routeOrders = r.orderIds
        .map((id) => allOrders.find((o) => o.orderId === id))
        .filter((o): o is OptimizerOrderInput => o != null);
      const seedOrder = routeOrders[routeOrders.length - 1];
      const targetHeading = seedOrder
        ? polarAngle(depot, seedOrder.shippingCoordinates)
        : polarAngle(depot, order.shippingCoordinates);
      const suit = calculateSuitability(
        order,
        { polyline: r.polyline, targetHeading, depot },
        allOrders,
      );
      if (suit > bestSuit) {
        bestSuit = suit;
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
