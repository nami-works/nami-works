import prisma from "../../db.server";
import {
  createLalamoveQuotation,
  type LalamoveCredentials,
} from "../lalamove.server";
import type { CarrierQuoteRequest, CarrierQuoteResult } from "./types";
import { geocodeAddress, formatAddressForGeocode } from "./geocode.server";

export type LalamoveConfig = {
  market: string;
  language: string;
  preferredServiceType: string;
  locationAddress?: string | null;
  /** Injected from Shopify location; used as sender name on place order */
  locationName?: string | null;
  locationPhone?: string | null;
  locationDetails?: string | null;
  /** Passed as sender remarks on place order */
  pickupInstructions?: string | null;
  /** Pickup location latitude — stored for auto-routing background service. */
  pickupLat?: number | null;
  /** Pickup location longitude — stored for auto-routing background service. */
  pickupLng?: number | null;
};

function normalizeForMatch(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Match origin address to a Lalamove config by comparing to stored locationAddress.
 */
function matchOriginToConfig(
  originStr: string,
  configs: Array<{ locationId: string; data: unknown }>,
): { locationId: string; data: unknown } | null {
  const norm = normalizeForMatch(originStr);
  if (!norm) return null;
  for (const c of configs) {
    const addr = (c.data as { locationAddress?: string | null })?.locationAddress;
    if (addr && normalizeForMatch(addr) === norm) return c;
  }
  for (const c of configs) {
    const addr = (c.data as { locationAddress?: string | null })?.locationAddress;
    if (addr && (norm.includes(normalizeForMatch(addr)) || normalizeForMatch(addr).includes(norm))) {
      return c;
    }
  }
  return null;
}

/**
 * Get Lalamove config for a shop. Uses first available LalamoveLocationConfig.
 */
export async function getLalamoveConfigForShop(
  shop: string,
): Promise<LalamoveConfig | null> {
  const row = await prisma.lalamoveLocationConfig.findFirst({
    where: { shop },
  });
  if (!row) return null;
  return row.data as LalamoveConfig;
}

/**
 * Get Lalamove config for a specific origin address. Matches by locationAddress.
 * Fallback: first config if no match (single-location shops).
 */
export async function getLalamoveConfigForOrigin(
  shop: string,
  origin: {
    address?: string | null;
    address1?: string | null;
    city?: string | null;
    province?: string | null;
    country?: string | null;
    postalCode?: string | null;
  },
): Promise<LalamoveConfig | null> {
  const rows = await prisma.lalamoveLocationConfig.findMany({
    where: { shop },
  });
  if (rows.length === 0) return null;
  const originStr = formatAddressForGeocode({
    address1: origin.address1 ?? origin.address,
    city: origin.city,
    province: origin.province,
    country: origin.country,
    postalCode: origin.postalCode,
  });
  const matched = matchOriginToConfig(originStr, rows);
  const row = matched ?? rows[0];
  return row.data as LalamoveConfig;
}

/**
 * Get locationId for an origin address. Used for sample rate lookup.
 */
export async function getLocationIdForOrigin(
  shop: string,
  origin: {
    address?: string | null;
    address1?: string | null;
    city?: string | null;
    province?: string | null;
    country?: string | null;
    postalCode?: string | null;
  },
): Promise<string | null> {
  const rows = await prisma.lalamoveLocationConfig.findMany({
    where: { shop },
  });
  if (rows.length === 0) return null;
  const originStr = formatAddressForGeocode({
    address1: origin.address1 ?? origin.address,
    city: origin.city,
    province: origin.province,
    country: origin.country,
    postalCode: origin.postalCode,
  });
  const matched = matchOriginToConfig(originStr, rows);
  return matched?.locationId ?? rows[0]?.locationId ?? null;
}

/**
 * Convert price string (e.g. "12.90" or "1290") to subunits.
 * Lalamove typically returns decimal string in major units.
 */
function toSubunits(value: string | undefined, currency: string): number {
  if (value == null || value === "") return 0;
  const num = parseFloat(String(value).replace(/,/g, "."));
  if (Number.isNaN(num)) return 0;
  // Most currencies use 2 decimal places; JPY etc use 0.
  const decimals = ["JPY", "KRW", "VND"].includes(currency.toUpperCase()) ? 0 : 2;
  return Math.round(num * Math.pow(10, decimals));
}

/**
 * Quote Lalamove for a single origin->destination delivery.
 * Geocodes origin/destination if coordinates not provided (requires GOOGLE_MAPS_API_KEY).
 */
export async function quoteLalamove(
  request: CarrierQuoteRequest,
  config: LalamoveConfig,
  options?: { googleMapsApiKey?: string; credentials?: LalamoveCredentials },
): Promise<CarrierQuoteResult> {
  const apiKey = options?.googleMapsApiKey?.trim();
  let originLat: number | null = request.origin.latitude ?? null;
  let originLng: number | null = request.origin.longitude ?? null;
  let destLat: number | null = request.destination.latitude ?? null;
  let destLng: number | null = request.destination.longitude ?? null;

  const originAddress =
    config.locationAddress ||
    formatAddressForGeocode({
      address1: request.origin.address,
      city: request.origin.city,
      province: request.origin.province,
      country: request.origin.country,
      postalCode: request.origin.postalCode,
    });
  const destAddress = formatAddressForGeocode({
    address1: request.destination.address1 ?? request.destination.address,
    city: request.destination.city,
    province: request.destination.province,
    country: request.destination.country,
    postalCode: request.destination.postalCode,
  });

  if ((originLat == null || originLng == null) && apiKey && originAddress) {
    const co = await geocodeAddress(originAddress, apiKey);
    if (co) {
      originLat = co.lat;
      originLng = co.lng;
    }
  }
  if ((destLat == null || destLng == null) && apiKey && destAddress) {
    const co = await geocodeAddress(destAddress, apiKey);
    if (co) {
      destLat = co.lat;
      destLng = co.lng;
    }
  }

  if (originLat == null || originLng == null || destLat == null || destLng == null) {
    return {
      provider: "lalamove",
      priceSubunits: 0,
      currency: request.currency,
      error: "Missing coordinates for origin or destination",
    };
  }

  try {
    const quotation = await createLalamoveQuotation({
      market: config.market,
      language: config.language,
      serviceType: config.preferredServiceType,
      stops: [
        {
          coordinates: { lat: String(originLat), lng: String(originLng) },
          address: originAddress || `${originLat},${originLng}`,
        },
        {
          coordinates: { lat: String(destLat), lng: String(destLng) },
          address: destAddress || `${destLat},${destLng}`,
        },
      ],
      isRouteOptimized: false,
    }, options?.credentials);

    const total = quotation.priceBreakdown?.total;
    const curr = quotation.priceBreakdown?.currency ?? request.currency;
    const priceSubunits = toSubunits(total, curr);

    return {
      provider: "lalamove",
      priceSubunits,
      currency: curr,
      minDeliveryDate: quotation.expiresAt,
      maxDeliveryDate: quotation.expiresAt,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Lalamove quote failed";
    return {
      provider: "lalamove",
      priceSubunits: 0,
      currency: request.currency,
      error: message,
    };
  }
}
