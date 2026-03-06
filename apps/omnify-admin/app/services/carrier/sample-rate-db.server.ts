/**
 * Sample rate database: quadrant-based rates from real orders for checkout quotes.
 * Builds when a location is added or carrier zones are updated.
 * Checkout ALWAYS uses this database for quotes (no live carrier API).
 */

import prisma from "../../db.server";
import type { CarrierProviderId } from "./types";
import type { CarrierServiceConfigData } from "./types";
import { quoteLalamove } from "./lalamove-adapter.server";
import { geocodeAddress } from "./geocode.server";
import { haversineKm } from "./geocode.server";
import { getRuntimeCredentialsForShop } from "../lalamove-credentials.server";

const QUADRANT_SIZE_KM = 0.5;
const DEGREES_PER_KM_LAT = 1 / 111;

/** Degrees per 0.5km east at a given latitude. */
function degreesPerHalfKmEast(lat: number): number {
  const latRad = (lat * Math.PI) / 180;
  return QUADRANT_SIZE_KM / (111 * Math.cos(latRad));
}

/** Compute quadrant indices for a point (lat, lon) relative to origin. */
export function getQuadrantIndices(
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number,
): { northIndex: number; eastIndex: number } {
  const dLat = QUADRANT_SIZE_KM * DEGREES_PER_KM_LAT;
  const dLon = degreesPerHalfKmEast(originLat);
  return {
    northIndex: Math.floor((destLat - originLat) / dLat),
    eastIndex: Math.floor((destLon - originLon) / dLon),
  };
}

/** Get max delivery zone radius in km from config. */
export function getMaxZoneRadiusKm(config: CarrierServiceConfigData | null): number {
  if (!config?.distanceZones?.length) return 20;
  const unit = config.distanceUnit ?? "km";
  let max = 0;
  for (const z of config.distanceZones) {
    const r = z.radiusKm ?? (z.radiusMiles ? z.radiusMiles * 1.60934 : 0);
    if (r > max) max = r;
  }
  return max || 20;
}

export type OrderWithCoords = {
  id: string;
  shippingAddress: {
    latitude: number;
    longitude: number;
    address1?: string | null;
    city?: string | null;
    province?: string | null;
    country?: string | null;
  };
};

/**
 * Fetch orders from last 12 months with shipping coordinates.
 * Requires admin GraphQL client. Note: Shopify defaults to 60 days; request read_all_orders
 * scope in shopify.app.toml for full 12-month access.
 */
export async function fetchOrdersForSampleBuild(
  admin: { graphql: (q: string, v?: { variables?: Record<string, unknown> }) => Promise<Response> },
  shop: string,
): Promise<OrderWithCoords[]> {
  const since = new Date();
  since.setFullYear(since.getFullYear() - 1);
  const queryStr = `created_at:>=${since.toISOString().slice(0, 10)}`;
  const all: OrderWithCoords[] = [];
  let cursor: string | null = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const variables: Record<string, unknown> = {
      first: 100,
      query: queryStr,
    };
    if (cursor) variables.after = cursor;

    const res = await admin.graphql(
      `#graphql
        query SampleRateOrders($first: Int!, $query: String, $after: String) {
          orders(first: $first, query: $query, after: $after) {
            nodes {
              id
              shippingAddress {
                address1
                city
                province
                country
                latitude
                longitude
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }`,
      { variables },
    );
    const json = (await res.json()) as {
      data?: {
        orders?: {
          nodes: Array<{
            id: string;
            shippingAddress: {
              latitude: number | null;
              longitude: number | null;
              address1?: string | null;
              city?: string | null;
              province?: string | null;
              country?: string | null;
            } | null;
          }>;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      };
    };
    const nodes = json.data?.orders?.nodes ?? [];
    const pageInfo = json.data?.orders?.pageInfo;

    for (const n of nodes) {
      const addr = n.shippingAddress;
      if (
        addr &&
        addr.latitude != null &&
        addr.longitude != null &&
        !Number.isNaN(addr.latitude) &&
        !Number.isNaN(addr.longitude)
      ) {
        all.push({
          id: n.id,
          shippingAddress: {
            latitude: addr.latitude,
            longitude: addr.longitude,
            address1: addr.address1,
            city: addr.city,
            province: addr.province,
            country: addr.country,
          },
        });
      }
    }

    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
    cursor = pageInfo.endCursor;
  }

  return all;
}

/**
 * Build and store sample rates for a location using real orders from last 12 months.
 * Divides delivery zone into 0.5km x 0.5km quadrants, picks one order per quadrant,
 * fetches actual carrier price, stores in DB.
 * Triggered on: location add, carrier zone update.
 */
export async function buildSampleRatesForLocation(
  shop: string,
  locationId: string,
  provider: CarrierProviderId,
  originAddress: string,
  maxRadiusKm: number,
  currency: string,
  orders: OrderWithCoords[],
  options?: { googleMapsApiKey?: string },
): Promise<number> {
  if (provider !== "lalamove") return 0;

  const row = await prisma.lalamoveLocationConfig.findUnique({
    where: { shop_locationId: { shop, locationId } },
  });
  if (!row) return 0;
  const config = row.data as {
    market: string;
    language: string;
    preferredServiceType: string;
    locationAddress?: string | null;
  };
  if (!config?.market || !config?.language || !config?.preferredServiceType)
    return 0;

  const apiKey = options?.googleMapsApiKey?.trim();
  if (!apiKey) return 0;

  const originCoords = await geocodeAddress(originAddress, apiKey);
  if (!originCoords) return 0;
  const credentials = await getRuntimeCredentialsForShop(shop);
  if (!credentials) return 0;

  const originLat = originCoords.lat;
  const originLon = originCoords.lng;

  const quadrantToOrder = new Map<string, OrderWithCoords>();
  for (const order of orders) {
    const dist = haversineKm(
      originLat,
      originLon,
      order.shippingAddress.latitude,
      order.shippingAddress.longitude,
    );
    if (dist > maxRadiusKm) continue;

    const { northIndex, eastIndex } = getQuadrantIndices(
      originLat,
      originLon,
      order.shippingAddress.latitude,
      order.shippingAddress.longitude,
    );
    const key = `${northIndex}_${eastIndex}`;
    if (!quadrantToOrder.has(key)) {
      quadrantToOrder.set(key, order);
    }
  }

  let stored = 0;
  for (const [key, order] of quadrantToOrder) {
    try {
      const [northIndex, eastIndex] = key.split("_").map(Number);
      const destAddr =
        [
          order.shippingAddress.address1,
          order.shippingAddress.city,
          order.shippingAddress.province,
          order.shippingAddress.country,
        ]
          .filter(Boolean)
          .join(", ") || `${order.shippingAddress.latitude},${order.shippingAddress.longitude}`;

      const result = await quoteLalamove(
        {
          origin: {
            address: originAddress,
            latitude: originCoords.lat,
            longitude: originCoords.lng,
          },
          destination: {
            address: destAddr,
            address1: destAddr,
            latitude: order.shippingAddress.latitude,
            longitude: order.shippingAddress.longitude,
          },
          currency,
          items: [{ weight: 1, quantity: 1 }],
        },
        {
          market: config.market,
          language: config.language,
          preferredServiceType: config.preferredServiceType,
          locationAddress: config.locationAddress ?? originAddress,
        },
        { googleMapsApiKey: apiKey, credentials },
      );

      if (!result.error && result.priceSubunits > 0) {
        await prisma.carrierRateSample.upsert({
          where: {
            shop_locationId_provider_quadrantNorthIndex_quadrantEastIndex: {
              shop,
              locationId,
              provider: "lalamove",
              quadrantNorthIndex: northIndex,
              quadrantEastIndex: eastIndex,
            },
          },
          create: {
            shop,
            locationId,
            provider: "lalamove",
            quadrantNorthIndex: northIndex,
            quadrantEastIndex: eastIndex,
            priceSubunits: result.priceSubunits,
            currency: result.currency,
          },
          update: {
            priceSubunits: result.priceSubunits,
            currency: result.currency,
            fetchedAt: new Date(),
          },
        });
        stored++;
      }
    } catch {
      // Skip this quadrant on error
    }
  }
  return stored;
}

/**
 * Lookup sample rate for a destination by quadrant.
 * Returns the stored price for the quadrant containing (destLat, destLon).
 */
export async function lookupSampleRateByQuadrant(
  shop: string,
  locationId: string,
  provider: CarrierProviderId,
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number,
): Promise<{
  priceSubunits: number;
  currency: string;
  isEstimate: boolean;
} | null> {
  const { northIndex, eastIndex } = getQuadrantIndices(
    originLat,
    originLon,
    destLat,
    destLon,
  );

  const sample = await prisma.carrierRateSample.findUnique({
    where: {
      shop_locationId_provider_quadrantNorthIndex_quadrantEastIndex: {
        shop,
        locationId,
        provider,
        quadrantNorthIndex: northIndex,
        quadrantEastIndex: eastIndex,
      },
    },
  });

  if (!sample) return null;

  return {
    priceSubunits: sample.priceSubunits,
    currency: sample.currency,
    isEstimate: true,
  };
}

/**
 * Build sample rates for all locations with Lalamove config in a shop.
 * Uses orders from last 12 months. Call when carrier zones are updated.
 */
export async function buildAllSampleRatesForShop(
  admin: { graphql: (q: string, v?: { variables?: Record<string, unknown> }) => Promise<Response> },
  shop: string,
  config: CarrierServiceConfigData | null,
  options?: { googleMapsApiKey?: string },
): Promise<number> {
  const rows = await prisma.lalamoveLocationConfig.findMany({
    where: { shop },
  });
  const apiKey = options?.googleMapsApiKey?.trim();
  if (!apiKey) return 0;

  const maxRadiusKm = getMaxZoneRadiusKm(config);
  const orders = await fetchOrdersForSampleBuild(admin, shop);

  let total = 0;
  for (const row of rows) {
    const data = row.data as { locationAddress?: string | null };
    const addr = data?.locationAddress?.trim();
    if (!addr) continue;
    const stored = await buildSampleRatesForLocation(
      shop,
      row.locationId,
      "lalamove",
      addr,
      maxRadiusKm,
      "BRL",
      orders,
      options,
    );
    total += stored;
  }
  return total;
}

/**
 * Build sample rates for a single location. Fetches orders and delegates to buildSampleRatesForLocation.
 * Call when a new location is added (first Lalamove config for that locationId).
 */
export async function buildSampleRatesForLocationWithOrders(
  admin: { graphql: (q: string, v?: { variables?: Record<string, unknown> }) => Promise<Response> },
  shop: string,
  locationId: string,
  provider: CarrierProviderId,
  originAddress: string,
  maxRadiusKm: number,
  currency: string,
  options?: { googleMapsApiKey?: string },
): Promise<number> {
  const orders = await fetchOrdersForSampleBuild(admin, shop);
  return buildSampleRatesForLocation(
    shop,
    locationId,
    provider,
    originAddress,
    maxRadiusKm,
    currency,
    orders,
    options,
  );
}

/**
 * Monthly refresh: discover new quadrants from recent orders and update prices.
 * Run via cron or scheduled job.
 */
export async function refreshSampleRatesMonthly(
  admin: { graphql: (q: string, v?: { variables?: Record<string, unknown> }) => Promise<Response> },
  shop: string,
  options?: { googleMapsApiKey?: string },
): Promise<number> {
  const configRow = await prisma.carrierServiceConfig.findUnique({
    where: { shop },
  });
  const config = configRow?.data as CarrierServiceConfigData | undefined;
  return buildAllSampleRatesForShop(admin, shop, config ?? null, options);
}
