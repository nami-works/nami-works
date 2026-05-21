/**
 * Polyline utilities for route optimization.
 * Google encoded polyline format: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */

export type Coordinate = { latitude: number; longitude: number };

/**
 * Decode a Google encoded polyline string into an array of coordinates.
 * Uses precision 5 (standard for Google Maps).
 */
export function decodePolyline(encoded: string): Coordinate[] {
  if (!encoded || encoded.length === 0) return [];
  const precision = 5;
  const factor = 10 ** precision;
  const coords: Coordinate[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dLat = (result & 1) ? ~(result >> 1) : result >> 1;
    lat += dLat;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dLng = (result & 1) ? ~(result >> 1) : result >> 1;
    lng += dLng;

    coords.push({
      latitude: lat / factor,
      longitude: lng / factor,
    });
  }
  return coords;
}

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Haversine distance in meters between two coordinates.
 */
export function haversineMeters(a: Coordinate, b: Coordinate): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Convert lat/lon to local Euclidean meters (equirectangular approx).
 * Center at segmentStart for numerical stability.
 */
function toLocalMeters(
  c: Coordinate,
  center: Coordinate,
): { x: number; y: number } {
  const latMid = toRad((c.latitude + center.latitude) / 2);
  const x = toRad(c.longitude - center.longitude) * Math.cos(latMid) * EARTH_RADIUS_M;
  const y = toRad(c.latitude - center.latitude) * EARTH_RADIUS_M;
  return { x, y };
}

/**
 * Cross-track distance: perpendicular distance from point P to the line segment A-B.
 * Returns distance in meters. Uses equirectangular approximation (accurate for urban distances).
 */
export function crossTrackDistance(
  point: Coordinate,
  segmentStart: Coordinate,
  segmentEnd: Coordinate,
): number {
  const d12 = haversineMeters(segmentStart, segmentEnd);
  if (d12 < 1e-6) return haversineMeters(point, segmentStart);

  const p = toLocalMeters(point, segmentStart);
  const b = toLocalMeters(segmentEnd, segmentStart);
  const bx = b.x;
  const by = b.y;
  const denom = bx * bx + by * by;
  if (denom < 1e-12) return haversineMeters(point, segmentStart);
  const t = Math.max(0, Math.min(1, (p.x * bx + p.y * by) / denom));
  const projX = t * bx;
  const projY = t * by;
  const dx = p.x - projX;
  const dy = p.y - projY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Find the minimum distance from a point to any segment of a polyline.
 * Also returns the closest point on the path (for tie-breaking).
 */
export function findClosestPointOnPath(
  point: Coordinate,
  encodedPolyline: string,
): { distanceMeters: number; closestPoint: Coordinate | null } {
  const segments = decodePolyline(encodedPolyline);
  if (segments.length < 2) {
    if (segments.length === 1) {
      return {
        distanceMeters: haversineMeters(point, segments[0]!),
        closestPoint: segments[0]!,
      };
    }
    return { distanceMeters: Number.POSITIVE_INFINITY, closestPoint: null };
  }

  let minDist = Number.POSITIVE_INFINITY;
  let closest: Coordinate | null = null;

  for (let i = 0; i < segments.length - 1; i += 1) {
    const a = segments[i]!;
    const b = segments[i + 1]!;
    const dist = crossTrackDistance(point, a, b);
    if (dist < minDist) {
      minDist = dist;
      closest = a;
    }
  }
  return { distanceMeters: minDist, closestPoint: closest };
}

/**
 * Distance from point to polyline (minimum over all segments).
 */
export function distanceToPolyline(point: Coordinate, encodedPolyline: string): number {
  return findClosestPointOnPath(point, encodedPolyline).distanceMeters;
}

/**
 * Check if two line segments (a1-a2 and b1-b2) intersect.
 * Uses orientation test for segment intersection.
 */
function segmentsIntersect(
  a1: Coordinate,
  a2: Coordinate,
  b1: Coordinate,
  b2: Coordinate,
): boolean {
  const ccw = (p: Coordinate, q: Coordinate, r: Coordinate) =>
    (q.longitude - p.longitude) * (r.latitude - p.latitude) -
      (q.latitude - p.latitude) * (r.longitude - p.longitude);

  const o1 = ccw(a1, a2, b1);
  const o2 = ccw(a1, a2, b2);
  const o3 = ccw(b1, b2, a1);
  const o4 = ccw(b1, b2, a2);

  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  if (o1 === 0 && onSegment(a1, b1, a2)) return true;
  if (o2 === 0 && onSegment(a1, b2, a2)) return true;
  if (o3 === 0 && onSegment(b1, a1, b2)) return true;
  if (o4 === 0 && onSegment(b1, a2, b2)) return true;
  return false;
}

function onSegment(p: Coordinate, q: Coordinate, r: Coordinate): boolean {
  return (
    q.latitude <= Math.max(p.latitude, r.latitude) &&
    q.latitude >= Math.min(p.latitude, r.latitude) &&
    q.longitude <= Math.max(p.longitude, r.longitude) &&
    q.longitude >= Math.min(p.longitude, r.longitude)
  );
}

/**
 * Check if two polylines intersect (X-shape or any crossing).
 * Used as guardrail to reject merges that would create path cross-overs.
 */
export function pathsIntersect(
  encodedA: string,
  encodedB: string,
): boolean {
  const segsA = decodePolyline(encodedA);
  const segsB = decodePolyline(encodedB);
  if (segsA.length < 2 || segsB.length < 2) return false;

  for (let i = 0; i < segsA.length - 1; i += 1) {
    const a1 = segsA[i]!;
    const a2 = segsA[i + 1]!;
    for (let j = 0; j < segsB.length - 1; j += 1) {
      const b1 = segsB[j]!;
      const b2 = segsB[j + 1]!;
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}
