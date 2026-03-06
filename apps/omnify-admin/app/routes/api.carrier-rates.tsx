import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { matchZone } from "../services/carrier/aggregator.server";
import { geocodeAddress, formatAddressForGeocode, haversineKm } from "../services/carrier/geocode.server";
import { getLocationIdForOrigin } from "../services/carrier/lalamove-adapter.server";
import { lookupSampleRateByQuadrant } from "../services/carrier/sample-rate-db.server";
import type {
  CarrierServiceConfigData,
  ShopifyCarrierRatePayload,
} from "../services/carrier/types";

/**
 * Shopify carrier service callback.
 * ALWAYS uses the sample rate database for quotes (no live carrier API).
 * POST: body is { rate: { origin, destination, items, currency, order_totals?, ... } }.
 * Query: shop=<store>.myshopify.com (required to resolve config).
 * Response: { rates: [ { service_name, service_code, description, total_price, currency, ... } ] }.
 * All prices in subunits (cents). Return empty rates and 200 if we cannot fulfill.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ rates: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop || typeof shop !== "string" || !shop.includes(".")) {
    return new Response(JSON.stringify({ rates: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: ShopifyCarrierRatePayload;
  try {
    body = (await request.json()) as ShopifyCarrierRatePayload;
  } catch {
    return new Response(JSON.stringify({ rates: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const registration = await prisma.carrierServiceRegistration.findUnique({
    where: { shop },
  });
  if (!registration?.active) {
    return new Response(JSON.stringify({ rates: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const configRow = await prisma.carrierServiceConfig.findUnique({
    where: { shop },
  });
  const config = configRow?.data as CarrierServiceConfigData | undefined;

  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!googleMapsApiKey) {
    return new Response(JSON.stringify({ rates: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!config?.distanceZones?.length || !config?.enabledProviders?.includes("lalamove")) {
    return new Response(JSON.stringify({ rates: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const originAddr = formatAddressForGeocode({
    address1: body.rate?.origin?.address1,
    city: body.rate?.origin?.city,
    province: body.rate?.origin?.province,
    country: body.rate?.origin?.country,
    postalCode: body.rate?.origin?.postal_code,
  });
  const destAddr = formatAddressForGeocode({
    address1: body.rate?.destination?.address1,
    city: body.rate?.destination?.city,
    province: body.rate?.destination?.province,
    country: body.rate?.destination?.country,
    postalCode: body.rate?.destination?.postal_code,
  });

  const [originCoords, destCoords] = await Promise.all([
    geocodeAddress(originAddr, googleMapsApiKey),
    geocodeAddress(destAddr, googleMapsApiKey),
  ]);

  if (!originCoords || !destCoords) {
    return new Response(JSON.stringify({ rates: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const distanceKm = haversineKm(
    originCoords.lat,
    originCoords.lng,
    destCoords.lat,
    destCoords.lng,
  );
  const matchedZone = matchZone(
    distanceKm,
    config.distanceZones,
    config.distanceUnit ?? "km",
  );

  if (!matchedZone) {
    return new Response(JSON.stringify({ rates: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const locationId = await getLocationIdForOrigin(shop, {
    address: body.rate?.origin?.address1,
    city: body.rate?.origin?.city,
    province: body.rate?.origin?.province,
    country: body.rate?.origin?.country,
    postalCode: body.rate?.origin?.postal_code,
  });

  if (!locationId) {
    return new Response(JSON.stringify({ rates: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sample = await lookupSampleRateByQuadrant(
    shop,
    locationId,
    "lalamove",
    originCoords.lat,
    originCoords.lng,
    destCoords.lat,
    destCoords.lng,
  );

  if (!sample) {
    return new Response(JSON.stringify({ rates: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rates = [
    {
      service_name: "Local delivery",
      service_code: "omnify_local_best",
      description: sample.isEstimate
        ? "Estimated rate from sample database."
        : "Delivery from local partners.",
      total_price: String(sample.priceSubunits),
      currency: sample.currency,
    },
  ];

  return new Response(JSON.stringify({ rates }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const loader = async (_: LoaderFunctionArgs) => {
  return new Response(JSON.stringify({ rates: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
