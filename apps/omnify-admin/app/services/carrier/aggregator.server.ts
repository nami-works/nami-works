import type {
  CarrierQuoteRequest,
  CarrierQuoteResult,
  CarrierServiceConfigData,
  CarrierProviderId,
  DistanceZone,
} from "./types";
import type { PersonalizationContext } from "./personalization.server";
import { getLalamoveConfigForOrigin, quoteLalamove } from "./lalamove-adapter.server";
import { getRuntimeCredentialsForShop } from "../lalamove-credentials.server";
import { quoteLoggi } from "./loggi-adapter.server";
import { quoteUber } from "./uber-adapter.server";
import { quoteRappi } from "./rappi-adapter.server";
import { applyPersonalization } from "./personalization.server";

const PROVIDER_TIMEOUT_MS = 5000;
const TOTAL_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Timeout")), ms);
    promise
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(t);
        reject(e);
      });
  });
}

async function quoteProvider(
  provider: CarrierProviderId,
  request: CarrierQuoteRequest,
  shop: string,
  googleMapsApiKey?: string,
): Promise<CarrierQuoteResult | null> {
  try {
    if (provider === "lalamove") {
      const credentials = await getRuntimeCredentialsForShop(shop);
      if (!credentials) return null;
      const config = await getLalamoveConfigForOrigin(shop, {
        address: request.origin.address,
        city: request.origin.city,
        province: request.origin.province,
        country: request.origin.country,
        postalCode: request.origin.postalCode,
      });
      if (!config) return null;
      const result = await withTimeout(
        quoteLalamove(request, config, { googleMapsApiKey, credentials }),
        PROVIDER_TIMEOUT_MS,
      );
      return result.error ? null : result;
    }
    if (provider === "loggi") {
      return withTimeout(quoteLoggi(request), PROVIDER_TIMEOUT_MS);
    }
    if (provider === "uber") {
      return withTimeout(quoteUber(request), PROVIDER_TIMEOUT_MS);
    }
    if (provider === "rappi") {
      return withTimeout(quoteRappi(request), PROVIDER_TIMEOUT_MS);
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Resolve which zone the destination falls into by distance (km).
 * Caller should pass distanceKm from geocoding + haversine (or similar).
 */
export function matchZone(
  distanceKm: number,
  zones: DistanceZone[] | undefined,
  unit: "km" | "mi" = "km",
): DistanceZone | undefined {
  if (!zones?.length) return undefined;
  const dist = unit === "mi" ? distanceKm * 1.60934 : distanceKm;
  const sorted = [...zones].sort(
    (a, b) => (a.radiusKm ?? 0) - (b.radiusKm ?? 0),
  );
  for (const zone of sorted) {
    const max = zone.radiusKm ?? zone.radiusMiles
      ? (zone.radiusMiles ?? 0) * 1.60934
      : Infinity;
    if (dist <= max) return zone;
  }
  return undefined;
}

/**
 * Fetch quotes from all enabled providers in parallel, apply personalization, return cheapest.
 */
export async function getCheapestRate(
  request: CarrierQuoteRequest,
  config: CarrierServiceConfigData | null,
  shop: string,
  context: PersonalizationContext,
  options?: { googleMapsApiKey?: string },
): Promise<{
  priceSubunits: number;
  currency: string;
  minDeliveryDate?: string;
  maxDeliveryDate?: string;
  provider: string;
  description?: string;
} | null> {
  const providers: CarrierProviderId[] =
    config?.enabledProviders?.length ? config.enabledProviders : ["lalamove"];
  const start = Date.now();

  const results = await Promise.allSettled(
    providers.map((p) =>
      withTimeout(
        quoteProvider(
          p,
          request,
          shop,
          options?.googleMapsApiKey,
        ),
        TOTAL_TIMEOUT_MS - (Date.now() - start) || 2000,
      ),
    ),
  );

  const quotes: CarrierQuoteResult[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value && !r.value.error) {
      quotes.push(r.value);
    }
  }

  if (quotes.length === 0) return null;

  const cheapest = quotes.reduce((a, b) =>
    a.priceSubunits <= b.priceSubunits ? a : b,
  );

  const personalized = applyPersonalization(cheapest, config ?? undefined, context);

  return {
    priceSubunits: personalized.priceSubunits,
    currency: cheapest.currency,
    minDeliveryDate: cheapest.minDeliveryDate,
    maxDeliveryDate: cheapest.maxDeliveryDate,
    provider: cheapest.provider,
  };
}
