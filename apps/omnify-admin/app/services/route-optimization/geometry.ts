/**
 * Pure geometry helpers used by the route-optimization pipeline.
 *
 * Deliberately decoupled from `carrier-quotation-optimizer.server.ts` so the
 * route-optimization module is self-contained and unit-testable without
 * pulling in optimizer + Lalamove + Prisma. Algorithms are equivalent.
 *
 * Everything here is haversine-based — no Google Maps API calls. Suitable for
 * server and test environments.
 */

import type { Coordinate } from "./types";

// ── Distance ───────────────────────────────────────────────────────────────

const EARTH_RADIUS_METERS = 6_371_000;

const toRadians = (value: number): number => (value * Math.PI) / 180;

/** Great-circle distance in meters between two coordinates. */
export function haversineMeters(a: Coordinate, b: Coordinate): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// ── Centroids ──────────────────────────────────────────────────────────────

/** Centroid of a non-empty array of coordinates. Returns null on empty input. */
export function centroidOf(points: Coordinate[]): Coordinate | null {
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
}

/** Distance from `point` to the nearest centroid; returns index + distance. */
export function nearestCentroid(
  point: Coordinate,
  centroids: Coordinate[],
): { index: number; distanceMeters: number } {
  if (centroids.length === 0) {
    return { index: -1, distanceMeters: Number.POSITIVE_INFINITY };
  }
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < centroids.length; i += 1) {
    const distance = haversineMeters(point, centroids[i]!);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return { index: bestIndex, distanceMeters: bestDistance };
}

// ── Directional helpers ────────────────────────────────────────────────────

/** Polar angle of `point` relative to `depot`, in radians (-π..π). */
export function polarAngle(depot: Coordinate, point: Coordinate): number {
  const dy = point.latitude - depot.latitude;
  // Correct for longitude shrinking near the poles. At equator this is a no-op.
  const dx =
    (point.longitude - depot.longitude) *
    Math.cos((depot.latitude * Math.PI) / 180);
  return Math.atan2(dy, dx);
}

/** Smallest angular distance between two angles, in radians (0..π). */
export function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

// ── Spread (max pairwise distance) ─────────────────────────────────────────

/**
 * Maximum pairwise haversine distance among a set of points. Used by the
 * absorption-test variant: 2-order routes with ≥5km spread are absorption
 * candidates.
 */
export function maxPairwiseSpreadMeters(points: Coordinate[]): number {
  if (points.length < 2) return 0;
  let max = 0;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const d = haversineMeters(points[i]!, points[j]!);
      if (d > max) max = d;
    }
  }
  return max;
}

// ── K-means (haversine) ────────────────────────────────────────────────────

/**
 * Single haversine k-means assignment with deterministic seed initialization
 * (first K points sorted by polar angle from depot). Convergence is detected
 * when no point's nearest centroid changes between iterations.
 *
 * Returns clusters in the same order as the seed centroids. Empty clusters
 * are returned as empty arrays (caller decides whether to drop or retry).
 */
export function kMeansAssign<T extends { coordinates: Coordinate }>(
  items: T[],
  k: number,
  depot: Coordinate,
  options: { maxIterations?: number } = {},
): T[][] {
  if (k <= 0 || items.length === 0) return [];
  if (k >= items.length) return items.map((it) => [it]);

  const maxIters = options.maxIterations ?? 50;

  // Seed: K items sorted by polar angle, evenly spaced indices.
  const sorted = [...items].sort(
    (a, b) =>
      polarAngle(depot, a.coordinates) - polarAngle(depot, b.coordinates),
  );
  const seedIndices: number[] = [];
  for (let i = 0; i < k; i += 1) {
    seedIndices.push(Math.floor((i * sorted.length) / k));
  }
  let centroids: Coordinate[] = seedIndices.map((idx) => sorted[idx]!.coordinates);

  let assignment: number[] = new Array(items.length).fill(-1);

  for (let iter = 0; iter < maxIters; iter += 1) {
    let changed = false;
    const next: number[] = new Array(items.length).fill(-1);
    for (let i = 0; i < items.length; i += 1) {
      next[i] = nearestCentroid(items[i]!.coordinates, centroids).index;
      if (next[i] !== assignment[i]) changed = true;
    }
    assignment = next;
    if (!changed) break;

    // Recompute centroids.
    const clusters: Coordinate[][] = Array.from({ length: k }, () => []);
    for (let i = 0; i < items.length; i += 1) {
      const c = assignment[i];
      if (c !== undefined && c >= 0) clusters[c]!.push(items[i]!.coordinates);
    }
    const newCentroids: Coordinate[] = [];
    for (let i = 0; i < k; i += 1) {
      const candidate = centroidOf(clusters[i]!);
      newCentroids.push(candidate ?? centroids[i]!);
    }
    centroids = newCentroids;
  }

  // Build cluster output in seed order.
  const out: T[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < items.length; i += 1) {
    const c = assignment[i];
    if (c !== undefined && c >= 0) out[c]!.push(items[i]!);
  }
  return out;
}

// ── Median ─────────────────────────────────────────────────────────────────

/** Median of a numeric array. Empty input returns 0. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}
