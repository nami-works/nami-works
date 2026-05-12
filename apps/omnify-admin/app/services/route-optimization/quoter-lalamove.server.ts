/**
 * Production Quoter for the route-optimization pipeline.
 *
 * Wraps `createLalamoveQuotation` from `lalamove.server.ts` into the
 * pure-function `Quoter` shape expected by `quote-engine.server.ts`. This
 * file is the ONLY route-optimization module that touches Lalamove —
 * everything else takes a Quoter via dependency injection.
 *
 * Tests use the mock Quoter exported by the test fixtures; they never
 * import this file.
 */

import {
  createLalamoveQuotation,
  type LalamoveCredentials,
  type LalamoveStop,
} from "../lalamove.server";
import type { Quoter, QuoterInput, QuoterOutput } from "./quote-engine.server";

/**
 * Create a Quoter bound to the given credentials. The returned function is
 * what gets passed to `quoteCandidates({ ..., quoter })`.
 *
 * `addressForOrder` is consulted per stop to populate the Lalamove address
 * field. If it returns null/undefined the coordinate is used as a fallback
 * "Lat,Lng" address — Lalamove tolerates this for quoting (not for
 * dispatch).
 */
export function buildLalamoveQuoter(opts: {
  credentials: LalamoveCredentials;
  /** Look up the postal address for an order by Shopify name. */
  addressForOrder?: (orderName: string) => string | null | undefined;
  /** Language hint (e.g. "pt_BR"); defaults to "en". */
  language?: string;
  /** Optional special-request codes passed through verbatim. */
  specialRequests?: string[];
}): Quoter {
  const { credentials, addressForOrder, language = "en", specialRequests } = opts;

  return async (input: QuoterInput): Promise<QuoterOutput> => {
    const pickup: LalamoveStop = {
      coordinates: {
        lat: input.pickupCoordinates.latitude.toFixed(7),
        lng: input.pickupCoordinates.longitude.toFixed(7),
      },
      address: addressForOrder?.("__pickup__") ?? "Pickup",
    };
    const stops: LalamoveStop[] = [
      pickup,
      ...input.stops.map((s) => ({
        coordinates: {
          lat: s.coordinates.latitude.toFixed(7),
          lng: s.coordinates.longitude.toFixed(7),
        },
        address:
          addressForOrder?.(s.orderName) ??
          `${s.coordinates.latitude.toFixed(5)},${s.coordinates.longitude.toFixed(5)}`,
      })),
    ];

    try {
      const quotation = await createLalamoveQuotation(
        {
          market: input.market,
          language,
          serviceType: input.serviceType,
          stops,
          isRouteOptimized: true,
          ...(specialRequests ? { specialRequests } : {}),
        },
        credentials,
      );

      const priceBreakdown = quotation.priceBreakdown ?? {};
      const totalString: string = priceBreakdown.total ?? "0.00";
      const currency: string = priceBreakdown.currency ?? "BRL";
      const totalSubunits = Math.round(parseFloat(totalString) * 100);
      const distanceMeters =
        typeof quotation.distance?.value === "string"
          ? parseInt(quotation.distance.value, 10)
          : undefined;

      return {
        ok: true,
        costSubunits: totalSubunits,
        costTotal: (totalSubunits / 100).toFixed(2),
        costCurrency: currency,
        serviceType: input.serviceType,
        distanceMeters,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
}
