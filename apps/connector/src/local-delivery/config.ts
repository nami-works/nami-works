import type { LalamoveConfig } from "./vendored/lalamove-adapter.js";

/**
 * In-memory replacement for cpg-labs's `LalamoveLocationConfig` Prisma table.
 * Keyed by Shopify Location GID. Single tenant (gebeauty) for v1 — when
 * nami-works onboards a second LD customer this should move to a per-tenant
 * structure (or back into Prisma).
 *
 * RioMar Recife (GID 97397047616) does NOT do local delivery
 * (`fulfillsOnlineOrders: false` in the live store). Excluded by design.
 *
 * Pickup coordinates are best-effort approximations; the simulator's
 * `history/fetch.ts` overrides per batch using `dispatch.stops[0].coordinates`
 * (the actual paid pickup point of that day's route, the source of truth).
 */

export type LocationConfigEntry = {
  locationId: string;
  locationName: string;
  data: LalamoveConfig;
};

export const GEBEAUTY_LOCATION_CONFIGS: LocationConfigEntry[] = [
  {
    locationId: "gid://shopify/Location/97784398144",
    locationName: "Shops Jardins",
    data: {
      market: "BR",
      language: "pt_BR",
      preferredServiceType: "LALAGO",
      city: "São Paulo",
      locationName: "GE Beauty Shops Jardins",
      locationAddress: "Rua Haddock Lobo, 1626, São Paulo, SP, Brasil",
      locationDetails: null,
      pickupLat: -23.5688,
      pickupLng: -46.6705,
      timezone: "America/Sao_Paulo",
    },
  },
  {
    locationId: "gid://shopify/Location/97397014848",
    locationName: "Shopping Recife",
    data: {
      market: "BR",
      language: "pt_BR",
      preferredServiceType: "LALAGO",
      city: "Recife",
      locationName: "Quiosque GE Beauty no Shopping Recife",
      locationAddress: "R. Padre Carapuceiro, 777, Recife, PE, Brasil",
      locationDetails: "Piso L2, quiosque 12",
      pickupLat: -8.1166,
      pickupLng: -34.9009,
      timezone: "America/Recife",
    },
  },
  {
    locationId: "gid://shopify/Location/101298569536",
    locationName: "RioSul",
    data: {
      market: "BR",
      language: "pt_BR",
      preferredServiceType: "LALAGO",
      city: "Rio de Janeiro",
      locationName: "GE Beauty RioSul",
      locationAddress: "Rua Lauro Muller, 116, Rio de Janeiro, RJ, Brasil",
      locationDetails: null,
      pickupLat: -22.9521,
      pickupLng: -43.1764,
      timezone: "America/Sao_Paulo",
    },
  },
];

export function getLocationConfig(
  locationId: string,
): LocationConfigEntry | null {
  return (
    GEBEAUTY_LOCATION_CONFIGS.find((c) => c.locationId === locationId) ?? null
  );
}

export function listLocationConfigs(): LocationConfigEntry[] {
  return GEBEAUTY_LOCATION_CONFIGS;
}
