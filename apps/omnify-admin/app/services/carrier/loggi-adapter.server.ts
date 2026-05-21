import type { CarrierQuoteRequest, CarrierQuoteResult } from "./types";

/** Stub: returns a fixed price. Replace with real Loggi API when available. */
export async function quoteLoggi(
  request: CarrierQuoteRequest,
): Promise<CarrierQuoteResult> {
  await Promise.resolve();
  const stubPriceSubunits = 1590; // e.g. R$15.90
  return {
    provider: "loggi",
    priceSubunits: stubPriceSubunits,
    currency: request.currency,
    minDeliveryDate: new Date(Date.now() + 3600 * 1000).toISOString(),
    maxDeliveryDate: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
  };
}
