/**
 * Shared types and utilities for route optimizers.
 */

export type Coordinate = { latitude: number; longitude: number };

export type OptimizerOrderInput = {
  orderId: string;
  locationId: string;
  shippingCoordinates: Coordinate;
  locationCoordinates: Coordinate;
  mustAssign?: boolean;
};

export type OptimizerRouteResult = {
  routeIndex: number;
  locationId: string;
  orderIds: string[];
  polyline: string;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
};

export type OptimizeFleetResult = {
  routes: OptimizerRouteResult[];
  summary: {
    routeCount: number;
    totalDistanceMeters: number;
    totalDurationSeconds: number;
    totalOrders: number;
  };
};

export const MAX_WAYPOINTS_PER_ROUTE = 24;
export const MAX_ORDERS_PER_ROUTE = 20;

const parseDurationToSeconds = (value: string | undefined) => {
  if (!value) return 0;
  const match = /^(\d+)(?:\.\d+)?s$/.exec(value);
  return match ? Number(match[1]) : 0;
};

export async function computeRoutePolyline(
  apiKey: string,
  locationCoordinates: Coordinate,
  orders: OptimizerOrderInput[],
): Promise<{
  polyline: string;
  distanceMeters: number;
  durationSeconds: number;
  ordered: OptimizerOrderInput[];
}> {
  if (orders.length === 0) {
    return { polyline: "", distanceMeters: 0, durationSeconds: 0, ordered: [] };
  }
  const destination = orders[orders.length - 1]!;
  const intermediates = orders.slice(0, -1).slice(0, MAX_WAYPOINTS_PER_ROUTE);
  console.info(`[google-routes] computeRoutePolyline START waypoints=${orders.length}`);
  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "routes.polyline,routes.distanceMeters,routes.duration,routes.optimizedIntermediateWaypointIndex",
    },
    body: JSON.stringify({
      origin: {
        location: {
          latLng: {
            latitude: locationCoordinates.latitude,
            longitude: locationCoordinates.longitude,
          },
        },
      },
      destination: {
        location: {
          latLng: {
            latitude: destination.shippingCoordinates.latitude,
            longitude: destination.shippingCoordinates.longitude,
          },
        },
      },
      intermediates: intermediates.map((order) => ({
        location: {
          latLng: {
            latitude: order.shippingCoordinates.latitude,
            longitude: order.shippingCoordinates.longitude,
          },
        },
      })),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      optimizeWaypointOrder: true,
    }),
  });
  console.info(`[google-routes] computeRoutePolyline status=${response.status}`);
  if (!response.ok) {
    console.error(`[google-routes] computeRoutePolyline FAILED status=${response.status}`);
    return { polyline: "", distanceMeters: 0, durationSeconds: 0, ordered: orders };
  }
  const json = await response.json();
  const route = json?.routes?.[0];
  const optimizedIndices = (route?.optimizedIntermediateWaypointIndex ?? []) as number[];
  const orderedIntermediates = optimizedIndices.length
    ? optimizedIndices.map((index) => intermediates[index]).filter(Boolean)
    : intermediates;
  const ordered = [...orderedIntermediates, destination];
  return {
    polyline: route?.polyline?.encodedPolyline ?? "",
    distanceMeters: Number(route?.distanceMeters ?? 0),
    durationSeconds: parseDurationToSeconds(route?.duration),
    ordered,
  };
}


