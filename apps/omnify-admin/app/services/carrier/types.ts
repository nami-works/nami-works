/**
 * Normalized request for a carrier quote (origin + destination + context).
 */
export type CarrierQuoteRequest = {
  origin: {
    address?: string;
    city?: string;
    province?: string;
    country?: string;
    postalCode?: string;
    latitude?: number;
    longitude?: number;
  };
  destination: {
    address?: string;
    address1?: string;
    city?: string;
    province?: string;
    country?: string;
    postalCode?: string;
    latitude?: number;
    longitude?: number;
  };
  currency: string;
  items?: Array<{ weight?: number; quantity?: number }>;
};

/**
 * Normalized quote result from a carrier adapter.
 */
export type CarrierQuoteResult = {
  provider: string;
  priceSubunits: number;
  currency: string;
  minDeliveryDate?: string;
  maxDeliveryDate?: string;
  error?: string;
};

/** Provider identifier for carrier adapters. */
export type CarrierProviderId = "lalamove" | "loggi" | "uber" | "rappi";

/** Time rule: cutoff time (24h) and promised transit. */
export type TimeRule = {
  timeLimit: string; // "16:00"
  transitTime: "same_day" | "next_day" | "2_days" | "3_days" | "custom";
  customDays?: number;
};

/** Distance zone: radius/range and price rule. */
export type DistanceZone = {
  name: string;
  radiusKm?: number;
  radiusMiles?: number;
  minOrderPriceSubunits?: number;
  useCarrierQuote: boolean;
  customPriceSubunits?: number;
  dilateTimeValue?: number;
  dilateTimeDimension?: "minutes" | "hours" | "days";
};

/** Cart value rule (optional). */
export type CartValueRule = {
  minSubtotalSubunits?: number;
  maxSubtotalSubunits?: number;
  freeShipping?: boolean;
  discountPercent?: number;
  surchargeSubunits?: number;
};

/** Omnify personalization for a Shopify local delivery zone (keyed by method definition GID). */
export type ZonePersonalization = {
  useCarrierQuote: boolean;
  customPriceSubunits?: number;
  dilateTimeValue?: number;
  dilateTimeDimension?: "minutes" | "hours" | "days";
};

/** Full carrier service config per shop. */
export type CarrierServiceConfigData = {
  enabledProviders: CarrierProviderId[];
  defaultOriginLocationId?: string;
  /** Default Lalamove vehicle type (e.g. LALAGO). Used when location config has none. */
  lalamovePreferredServiceType?: string;
  /** Default Lalamove market code (e.g. BR). Persisted from the provider preferences modal. */
  lalamoveDefaultMarket?: string;
  timeRule?: TimeRule;
  distanceZones?: DistanceZone[];
  distanceMethod?: "postal_codes" | "radius";
  distanceUnit?: "km" | "mi";
  cartValueRules?: CartValueRule[];
  /** Per-method-definition personalization for Shopify native local delivery zones. */
  personalizationByMethodId?: Record<string, ZonePersonalization>;
  /** Second-choice Lalamove vehicle (e.g. CAR). Quoted alongside primary for cost comparison. */
  lalamoveSecondaryServiceType?: string;
  /** Max orders per route for primary vehicle. 1-15, default 10. */
  lalamoveMaxOrdersPerRoute?: number;
  /** Max orders per route for secondary vehicle. 1-15, default 10. */
  lalamoveSecondaryMaxOrdersPerRoute?: number;
};

/**
 * Shopify sends this shape in the carrier callback POST body.
 */
export type ShopifyCarrierRatePayload = {
  rate?: {
    origin?: {
      address1?: string;
      address2?: string;
      city?: string;
      province?: string;
      country?: string;
      postal_code?: string;
    };
    destination?: {
      address1?: string;
      address2?: string;
      city?: string;
      province?: string;
      country?: string;
      postal_code?: string;
    };
    items?: Array<{ grams?: number; quantity?: number }>;
    currency?: string;
    order_totals?: { subtotal_price?: string };
  };
};
