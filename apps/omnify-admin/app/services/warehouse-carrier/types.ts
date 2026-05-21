/**
 * Warehouse-carrier adapter contract.
 *
 * Parallel to (but distinct from) `app/services/carrier/types.ts` — that one
 * models LD providers (Lalamove, Loggi, Uber, Rappi). This one models
 * warehouse-shipping providers (Intelipost in v1; Frenet, Melhor Envio in v2+).
 *
 * The two domains are kept separate on purpose:
 *  - LD providers quote per-route (multi-stop), often optimize, and dispatch.
 *  - Warehouse providers quote per-order (single-stop) and ship via partners.
 *
 * See docs/plans/local-delivery-analytics.md §4.1.
 */

export type WarehouseProviderId = "intelipost" | "frenet" | "melhor_envio";

export type WarehouseQuoteRequest = {
  origin: {
    postalCode: string;
    address1?: string;
    city: string;
    province: string;
    country: string;
  };
  destination: {
    postalCode: string;
    address1?: string;
    city: string;
    province: string;
    country: string;
  };
  items: Array<{ weightGrams: number; quantity: number; valueSubunits?: number }>;
  currency: string;
  /** True when quoting an order that wasn't originally shipped via this provider. */
  isSpeculative?: boolean;
};

export type WarehouseQuoteResult = {
  provider: WarehouseProviderId;
  /** Carrier rate (what the merchant would pay), in currency minor units. */
  priceSubunits: number;
  currency: string;
  minDeliveryDate?: string;
  maxDeliveryDate?: string;
  /** Provider-specific raw response, stored for diagnostics. Never logged. */
  raw?: unknown;
};

export type WarehouseQuoteErrorCode =
  | "auth_failed"
  | "out_of_zone"
  | "invalid_address"
  | "rate_limit"
  | "speculative_not_supported"
  | "network"
  | "unknown";

export type WarehouseQuoteError = {
  provider: WarehouseProviderId;
  errorCode: WarehouseQuoteErrorCode;
  message: string;
  retryable: boolean;
};

export type WarehouseCarrierCredentials = {
  apiKey: string;
  /** Optional — providers that use single-key auth pass nothing here. */
  apiSecret?: string;
  /** Optional override (e.g. sandbox vs prod). */
  endpoint?: string;
};

export type WarehouseValidateResult =
  | { ok: true }
  | { ok: false; reason: string };

export interface WarehouseCarrierAdapter {
  readonly id: WarehouseProviderId;
  /**
   * True if this provider permits speculative quoting — i.e. quoting an
   * arbitrary origin/destination/items without an active shipment in their
   * system. Drives whether the analytics page can show the "you could be
   * saving X" provocation teaser to merchants who haven't connected yet.
   */
  readonly supportsSpeculativeQuoting: boolean;
  /** Validate credentials by calling a cheap endpoint (e.g. /me, /shop). */
  validateCredentials(creds: WarehouseCarrierCredentials): Promise<WarehouseValidateResult>;
  /** Get a single quote for one order. Errors surface as values, not throws. */
  quote(
    creds: WarehouseCarrierCredentials,
    req: WarehouseQuoteRequest,
  ): Promise<WarehouseQuoteResult | WarehouseQuoteError>;
}

/** Helper — narrow a quote response to the success branch. */
export function isQuoteResult(
  v: WarehouseQuoteResult | WarehouseQuoteError,
): v is WarehouseQuoteResult {
  return (v as WarehouseQuoteResult).priceSubunits !== undefined;
}
