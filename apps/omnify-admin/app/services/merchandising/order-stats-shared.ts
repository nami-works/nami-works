// ---------------------------------------------------------------------------
// Types & pure functions shared between server and client
// ---------------------------------------------------------------------------

export interface OrderStatsRaw {
  totalOrders: number;
  ordersWithDiscount: number;
  totalDiscountAmount: number;
  totalSubtotal: number;
  totalShipping: number;
  sumSubtotalDiscounted: number;
  sumSubtotalNonDiscounted: number;
}

export interface ComputedStats {
  avgDiscountRate: number;
  ordersWithDiscount: number;
  discountPercent: number;
  totalOrders: number;
  totalDiscounts: number;
  aovWithDiscount: number;
  aovWithoutDiscount: number;
}

// ---------------------------------------------------------------------------
// Compute display stats (pure function, no API calls)
// ---------------------------------------------------------------------------

export function computeStats(raw: OrderStatsRaw, includeShipping: boolean): ComputedStats {
  const totalOrders = raw.totalOrders;
  const ordersWithDiscount = raw.ordersWithDiscount;
  const ordersWithoutDiscount = totalOrders - ordersWithDiscount;

  const grossSales = raw.totalSubtotal + raw.totalDiscountAmount;
  const denominator = includeShipping ? grossSales + raw.totalShipping : grossSales;
  const numerator = raw.totalDiscountAmount;

  const avgDiscountRate = denominator > 0 ? (numerator / denominator) * 100 : 0;
  const discountPercent = totalOrders > 0 ? (ordersWithDiscount / totalOrders) * 100 : 0;

  const aovWithDiscount = ordersWithDiscount > 0
    ? raw.sumSubtotalDiscounted / ordersWithDiscount
    : 0;
  const aovWithoutDiscount = ordersWithoutDiscount > 0
    ? raw.sumSubtotalNonDiscounted / ordersWithoutDiscount
    : 0;

  return {
    avgDiscountRate: Math.round(avgDiscountRate * 10) / 10,
    ordersWithDiscount,
    discountPercent: Math.round(discountPercent * 10) / 10,
    totalOrders,
    totalDiscounts: Math.round(numerator * 100) / 100,
    aovWithDiscount: Math.round(aovWithDiscount * 100) / 100,
    aovWithoutDiscount: Math.round(aovWithoutDiscount * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Date range helpers
// ---------------------------------------------------------------------------

export function getDateRange(periodDays: number): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - periodDays);
  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
  };
}
