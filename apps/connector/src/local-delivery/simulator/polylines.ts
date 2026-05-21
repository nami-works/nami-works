import { createHash } from "node:crypto";
import { prisma } from "../../db/prisma.js";

/**
 * Routed-polyline lookup. Uses Google Routes API
 * (https://routes.googleapis.com/directions/v2:computeRoutes) to compute
 * a road-snapped polyline for a sequence of stops, and caches the result
 * in `LdSimPolylineCache` keyed by sha256(locationId | orderIds).
 *
 * Polylines for fixed stop sequences never change, so this is a
 * write-once-read-many cache.
 */

export type LatLng = { lat: number; lng: number };

const ROUTES_API_URL =
  "https://routes.googleapis.com/directions/v2:computeRoutes";

export type RoutePolyResult =
  | { ok: true; polyline: string; cached: boolean }
  | { ok: false; error: string };

export function buildRouteKey(locationId: string, orderIds: string[]): string {
  const joined = orderIds.join("|");
  return createHash("sha256")
    .update(`${locationId}|${joined}`)
    .digest("hex");
}

export async function getOrComputeRoutePolyline(
  locationId: string,
  orderIds: string[],
  origin: LatLng,
  intermediates: LatLng[],
  destination: LatLng,
  apiKey: string,
): Promise<RoutePolyResult> {
  const routeKey = buildRouteKey(locationId, orderIds);

  const cached = await prisma.ldSimPolylineCache.findUnique({
    where: { routeKey },
  });
  if (cached) return { ok: true, polyline: cached.polyline, cached: true };

  if (!apiKey?.trim()) {
    return { ok: false, error: "GOOGLE_MAPS_API_KEY not set" };
  }

  const body = {
    origin: { location: { latLng: origin } },
    destination: { location: { latLng: destination } },
    intermediates: intermediates.map((c) => ({ location: { latLng: c } })),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_UNAWARE",
    polylineQuality: "HIGH_QUALITY",
  };

  let res: Response;
  try {
    res = await fetch(ROUTES_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.polyline.encodedPolyline",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `Routes API ${res.status}: ${text.slice(0, 200)}` };
  }

  const json = (await res.json()) as {
    routes?: Array<{ polyline?: { encodedPolyline?: string } }>;
  };
  const polyline = json.routes?.[0]?.polyline?.encodedPolyline;
  if (!polyline) {
    return { ok: false, error: "Routes API returned no polyline" };
  }

  await prisma.ldSimPolylineCache.upsert({
    where: { routeKey },
    update: { polyline },
    create: { routeKey, polyline },
  });

  return { ok: true, polyline, cached: false };
}
