import type { CarrierQuoteRequest, CarrierQuoteResult } from "./types";

/** Stub: returns a fixed price. Replace with real Uber Direct API when available. */
export async function quoteUber(
  request: CarrierQuoteRequest,
): Promise<CarrierQuoteResult> {
  await Promise.resolve();
  const stubPriceSubunits = 1290; // e.g. R$12.90
  return {
    provider: "uber",
    priceSubunits: stubPriceSubunits,
    currency: request.currency,
    minDeliveryDate: new Date(Date.now() + 3600 * 1000).toISOString(),
    maxDeliveryDate: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
  };
}
