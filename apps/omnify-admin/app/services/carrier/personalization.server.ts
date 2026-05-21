import type {
  CarrierQuoteResult,
  CarrierServiceConfigData,
  TimeRule,
  DistanceZone,
  CartValueRule,
} from "./types";

export type PersonalizationContext = {
  requestTimestamp: number;
  distanceKm?: number;
  subtotalSubunits?: number;
  matchedZone?: DistanceZone;
};

/**
 * Apply time rule: if request is after timeLimit, we may add a day to ETA (handled by caller for copy).
 * Price modifier by time is optional (e.g. rush surcharge); not in plan's first version for time rule.
 */
export function applyTimeRule(
  _quote: CarrierQuoteResult,
  timeRule: TimeRule | undefined,
  ctx: PersonalizationContext,
): { priceSubunits: number; deliveryDateOffsetDays?: number } {
  if (!timeRule) return { priceSubunits: _quote.priceSubunits };
  const now = new Date(ctx.requestTimestamp);
  const [hours, minutes] = timeRule.timeLimit.split(":").map(Number);
  const limitToday = new Date(now);
  limitToday.setHours(hours, minutes ?? 0, 0, 0);
  const isBeforeLimit = now.getTime() <= limitToday.getTime();
  if (isBeforeLimit) return { priceSubunits: _quote.priceSubunits };
  // After cutoff: delivery shifts by one day (same_day -> next_day, etc.)
  return { priceSubunits: _quote.priceSubunits, deliveryDateOffsetDays: 1 };
}

/**
 * Apply distance zone: use custom price if set, else keep carrier quote. Apply dilate to ETA if set.
 */
export function applyDistanceZone(
  quote: CarrierQuoteResult,
  zone: DistanceZone | undefined,
): { priceSubunits: number; dilateMinutes?: number } {
  if (!zone) return { priceSubunits: quote.priceSubunits };
  let priceSubunits = quote.priceSubunits;
  if (!zone.useCarrierQuote && zone.customPriceSubunits != null) {
    priceSubunits = zone.customPriceSubunits;
  }
  let dilateMinutes: number | undefined;
  if (
    zone.dilateTimeValue != null &&
    zone.dilateTimeValue > 0 &&
    zone.dilateTimeDimension
  ) {
    switch (zone.dilateTimeDimension) {
      case "minutes":
        dilateMinutes = zone.dilateTimeValue;
        break;
      case "hours":
        dilateMinutes = zone.dilateTimeValue * 60;
        break;
      case "days":
        dilateMinutes = zone.dilateTimeValue * 24 * 60;
        break;
      default:
        break;
    }
  }
  return { priceSubunits, dilateMinutes };
}

/**
 * Apply cart value rules: free shipping over X, or surcharge/discount.
 */
export function applyCartValueRules(
  priceSubunits: number,
  rules: CartValueRule[] | undefined,
  subtotalSubunits: number | undefined,
): number {
  if (!rules?.length || subtotalSubunits == null) return priceSubunits;
  for (const r of rules) {
    if (r.minSubtotalSubunits != null && subtotalSubunits < r.minSubtotalSubunits)
      continue;
    if (
      r.maxSubtotalSubunits != null &&
      subtotalSubunits > r.maxSubtotalSubunits
    )
      continue;
    if (r.freeShipping) return 0;
    if (r.discountPercent != null && r.discountPercent > 0) {
      priceSubunits = Math.round(
        priceSubunits * (1 - r.discountPercent / 100),
      );
    }
    if (r.surchargeSubunits != null && r.surchargeSubunits > 0) {
      priceSubunits += r.surchargeSubunits;
    }
  }
  return priceSubunits;
}

/**
 * Apply full personalization: time (optional offset), distance zone (price + dilate), cart value.
 */
export function applyPersonalization(
  quote: CarrierQuoteResult,
  config: CarrierServiceConfigData | undefined,
  ctx: PersonalizationContext,
): {
  priceSubunits: number;
  deliveryDateOffsetDays?: number;
  dilateMinutes?: number;
} {
  const timeResult = applyTimeRule(quote, config?.timeRule, ctx);
  const zoneResult = applyDistanceZone(
    { ...quote, priceSubunits: timeResult.priceSubunits },
    ctx.matchedZone,
  );
  const afterCart = applyCartValueRules(
    zoneResult.priceSubunits,
    config?.cartValueRules,
    ctx.subtotalSubunits,
  );
  return {
    priceSubunits: afterCart,
    deliveryDateOffsetDays: timeResult.deliveryDateOffsetDays,
    dilateMinutes: zoneResult.dilateMinutes,
  };
}
