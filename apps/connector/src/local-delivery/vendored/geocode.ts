// @ts-nocheck — vendored from cpg-labs; passes their typecheck. Re-enable after fixing exactOptionalPropertyTypes drift if needed.
import prisma from "./_prisma-stub.js";

const GEOCODE_CACHE = new Map<string, { lat: number; lng: number }>();

/** Cache expiry: 90 days. */
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function cacheKey(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Geocode a single address string to lat/lng using Google Maps Geocoding API.
 * Returns null if key missing, request fails, or no result.
 * Results are cached in memory AND persisted to DB (survives server restarts).
 */
export async function geocodeAddress(
  address: string,
  apiKey: string,
): Promise<{ lat: number; lng: number } | null> {
  if (!address?.trim() || !apiKey?.trim()) return null;
  const key = cacheKey(address);

  // 1. Check in-memory cache
  const memCached = GEOCODE_CACHE.get(key);
  if (memCached) return memCached;

  // 2. Check persistent DB cache
  try {
    const dbEntry = await prisma.geocodeCacheEntry.findUnique({
      where: { queryKey: key },
    });
    if (dbEntry && dbEntry.expiresAt > new Date()) {
      const result = { lat: dbEntry.lat, lng: dbEntry.lng };
      GEOCODE_CACHE.set(key, result);
      return result;
    }
  } catch {
    // DB unavailable — continue to Google API
  }

  // 3. Call Google Geocoding API
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", apiKey);

  try {
    const res = await fetch(url.toString());
    const data = (await res.json()) as {
      status?: string;
      results?: Array<{
        geometry?: { location?: { lat: number; lng: number } };
      }>;
    };
    if (data.status !== "OK" || !data.results?.[0]?.geometry?.location) {
      return null;
    }
    const { lat, lng } = data.results[0].geometry.location;
    const result = { lat, lng };

    // Populate both caches
    GEOCODE_CACHE.set(key, result);
    try {
      await prisma.geocodeCacheEntry.upsert({
        where: { queryKey: key },
        update: { lat, lng, expiresAt: new Date(Date.now() + CACHE_TTL_MS) },
        create: { queryKey: key, lat, lng, expiresAt: new Date(Date.now() + CACHE_TTL_MS) },
      });
    } catch {
      // DB write failure is non-fatal
    }

    return result;
  } catch {
    return null;
  }
}

/**
 * Compute great-circle distance in km between two points (Haversine formula).
 */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Build a single-line address from typical Shopify address parts.
 */
export function formatAddressForGeocode(parts: {
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
  postalCode?: string | null;
}): string {
  const arr = [
    parts.address1,
    parts.address2,
    parts.city,
    parts.province,
    parts.postalCode,
    parts.country,
  ].filter(Boolean) as string[];
  return arr.join(", ");
}

// ─── Address normalization ────────────────────────────────────────────────────

type GeocodedComponents = {
  lat: number;
  lng: number;
  streetNumber?: string; // "street_number" component from Google
  route?: string;        // "route" component — canonical street name
};

const COMPONENTS_CACHE = new Map<string, GeocodedComponents | null>();

/**
 * Geocodes a query string and returns lat/lng plus parsed address_components.
 * Returns null on failure. Results are cached by query string (memory + DB).
 */
async function geocodeAddressComponents(
  query: string,
  apiKey: string,
): Promise<GeocodedComponents | null> {
  if (!query?.trim() || !apiKey?.trim()) return null;
  const key = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (COMPONENTS_CACHE.has(key)) return COMPONENTS_CACHE.get(key) ?? null;

  // Check persistent DB cache (includes route field)
  try {
    const dbEntry = await prisma.geocodeCacheEntry.findUnique({
      where: { queryKey: key },
    });
    if (dbEntry && dbEntry.expiresAt > new Date()) {
      const result: GeocodedComponents = {
        lat: dbEntry.lat,
        lng: dbEntry.lng,
        route: dbEntry.route ?? undefined,
      };
      COMPONENTS_CACHE.set(key, result);
      return result;
    }
  } catch {
    // DB unavailable — continue to Google API
  }

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("key", apiKey);

  try {
    const res = await fetch(url.toString());
    const data = (await res.json()) as {
      status?: string;
      results?: Array<{
        geometry?: { location?: { lat: number; lng: number } };
        address_components?: Array<{ long_name: string; types: string[] }>;
      }>;
    };

    if (data.status !== "OK" || !data.results?.[0]?.geometry?.location) {
      COMPONENTS_CACHE.set(key, null);
      return null;
    }

    const { lat, lng } = data.results[0].geometry.location;
    const components = data.results[0].address_components ?? [];

    const find = (type: string) =>
      components.find((c) => c.types.includes(type))?.long_name;

    const result: GeocodedComponents = {
      lat,
      lng,
      streetNumber: find("street_number"),
      route: find("route"),
    };

    COMPONENTS_CACHE.set(key, result);

    // Persist to DB (include route for address normalization)
    try {
      await prisma.geocodeCacheEntry.upsert({
        where: { queryKey: key },
        update: { lat, lng, route: result.route ?? null, expiresAt: new Date(Date.now() + CACHE_TTL_MS) },
        create: { queryKey: key, lat, lng, route: result.route ?? null, expiresAt: new Date(Date.now() + CACHE_TTL_MS) },
      });
    } catch {
      // DB write failure is non-fatal
    }

    return result;
  } catch {
    COMPONENTS_CACHE.set(key, null);
    return null;
  }
}

/**
 * Normalizes a Shopify shipping address for delivery driver use:
 * 1. Parses the street number from address1 (leading digits, e.g. "123" from "123 Rua Abc")
 * 2. Geocodes the full address to obtain the canonical street name from Google Maps
 * 3. Returns "${streetNumber} ${canonicalStreet}, ${address2}, ${city}, ${province}, ${zip}, ${country}"
 *
 * Falls back to the original comma-joined address if geocoding fails or returns
 * no route component. Never throws.
 */
export async function normalizeShippingAddress(
  parts: {
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    province?: string | null;
    zip?: string | null;
    country?: string | null;
  },
  apiKey: string,
): Promise<string> {
  const fallback = [
    parts.address1,
    parts.address2,
    parts.city,
    parts.province,
    parts.zip,
    parts.country,
  ]
    .filter(Boolean)
    .join(", ");

  if (!apiKey?.trim() || !parts.address1?.trim() || !parts.zip?.trim()) return fallback;

  try {
    // Parse the street number from address1 (leading digit sequence)
    const numberMatch = parts.address1.trim().match(/^(\d[\d\-\/]*)/);
    const parsedStreetNumber = numberMatch?.[1] ?? null;

    // Geocode using full address for best accuracy (zip is the primary anchor)
    const query = [parts.address1, parts.zip, parts.city, parts.country]
      .filter(Boolean)
      .join(", ");

    const geocoded = await geocodeAddressComponents(query, apiKey);
    if (!geocoded?.route) return fallback;

    // Prefer Google's street_number if returned; fall back to parsed one
    const streetNumber = geocoded.streetNumber ?? parsedStreetNumber;
    const normalizedAddress1 = [streetNumber, geocoded.route].filter(Boolean).join(" ");

    return [
      normalizedAddress1,
      parts.address2,
      parts.city,
      parts.province,
      parts.zip,
      parts.country,
    ]
      .filter(Boolean)
      .join(", ");
  } catch {
    return fallback;
  }
}
