import type { CarrierQuoteRequest, CarrierQuoteResult } from "./types";

/** Stub: returns a fixed price. Replace with real Rappi Cargo API when available. */
export async function quoteRappi(
  request: CarrierQuoteRequest,
): Promise<CarrierQuoteResult> {
  await Promise.resolve();
  const stubPriceSubunits = 1490; // e.g. R$14.90
  return {
    provider: "rappi",
    priceSubunits: stubPriceSubunits,
    currency: request.currency,
    minDeliveryDate: new Date(Date.now() + 3600 * 1000).toISOString(),
    maxDeliveryDate: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
  };
}
