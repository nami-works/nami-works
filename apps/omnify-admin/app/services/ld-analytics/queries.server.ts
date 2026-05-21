/**
 * Read-only aggregations served to the analytics page loader.
 *
 * All queries hit the rolled-up `LdAnalyticsDaily` table — fast.
 * Drilldown queries hit the live join (LalamoveDispatchJob × ShopOrder)
 * for per-order detail. See docs/plans/local-delivery-analytics.md §5.3.
 */

import prisma from "../../db.server";
import {
  ldNet as computeLdNet,
  whNet as computeWhNet,
  plImpact as computePlImpact,
  revenueRetained as computeRevRetained,
  netCostDelta as computeNetCostDelta,
} from "./pl-math.server";

export type DateRange = { from: Date; to: Date };

export type HeadlineMetrics = {
  ldOrderCount: number;
  ldRevenueSubunits: number;
  ldCarrierCostSubunits: number;
  warehouseCustomerRateSubunits: number;
  warehouseCounterfactualSubunits: number;
  taxSavingsSubunits: number;
  ldNet: number;
  whCounterfactualNet: number;
  plImpact: number;
  revenueRetained: number;
  netCostDelta: number;
  coveragePercent: number;
  currencyCode: string;
};

export type CityRow = {
  cityNorm: string;
  cityDisplay: string;
  orderCount: number;
  ldRevenueSubunits: number;
  warehouseCustomerRateSubunits: number;
  ldCarrierCostSubunits: number;
  warehouseCounterfactualSubunits: number;
  ldNet: number;
  whCounterfactualNet: number;
  plDelta: number;
  coveragePercent: number;
};

export type DrilldownOrder = {
  orderId: string;
  orderName: string;
  orderDate: Date;
  cityDisplay: string;
  ldRevenueSubunits: number;
  warehouseCustomerRateSubunits: number;
  ldCarrierCostSubunits: number;
  warehouseCounterfactualSubunits: number;
  isFreeShipped: boolean;
};

export function periodToRange(period: string, now = new Date()): DateRange {
  const days =
    period === "7d"
      ? 7
      : period === "30d"
        ? 30
        : period === "365d"
          ? 365
          : 90; // default 90d
  const to = new Date(now);
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to };
}

export async function countLdOrders(shop: string, range: DateRange): Promise<number> {
  // Counts LD-dispatched orders by walking LalamoveDispatchJob in the range.
  const jobs = await prisma.lalamoveDispatchJob.findMany({
    where: { shop, requestedAt: { gte: range.from, lte: range.to } },
    select: { ordersData: true },
  });
  let count = 0;
  for (const j of jobs) {
    const arr = (j.ordersData as Array<{ shopifyOrderId: string }> | null) ?? [];
    count += arr.length;
  }
  return count;
}

export async function getHeadlineMetrics(
  shop: string,
  range: DateRange,
): Promise<HeadlineMetrics> {
  const rows = await prisma.ldAnalyticsDaily.findMany({
    where: { shop, date: { gte: range.from, lte: range.to } },
  });

  let ldOrderCount = 0;
  let ldRevenueSubunits = 0;
  let ldCarrierCostSubunits = 0;
  let warehouseCustomerRateSubunits = 0;
  let warehouseCounterfactualSubunits = 0;
  let taxSavingsSubunits = 0;
  let coverageWeightedNumer = 0;
  let coverageWeightedDenom = 0;
  let currencyCode = "BRL";

  for (const r of rows) {
    ldOrderCount += r.ldOrderCount;
    ldRevenueSubunits += r.ldRevenueSubunits;
    ldCarrierCostSubunits += r.ldCarrierCostSubunits;
    warehouseCustomerRateSubunits += r.warehouseCustomerRateSubunits;
    warehouseCounterfactualSubunits += r.warehouseCounterfactualSubunits;
    taxSavingsSubunits += r.taxSavingsSubunits;
    coverageWeightedNumer += r.coveragePercent * r.ldOrderCount;
    coverageWeightedDenom += r.ldOrderCount;
    if (r.currencyCode) currencyCode = r.currencyCode;
  }

  const inputs = {
    ldRevenueSubunits,
    ldCarrierCostSubunits,
    warehouseCounterfactualSubunits,
    warehouseCustomerRateSubunits,
    taxSavingsSubunits,
  };

  return {
    ldOrderCount,
    ldRevenueSubunits,
    ldCarrierCostSubunits,
    warehouseCustomerRateSubunits,
    warehouseCounterfactualSubunits,
    taxSavingsSubunits,
    ldNet: computeLdNet(inputs),
    whCounterfactualNet: computeWhNet(inputs),
    plImpact: computePlImpact(inputs),
    revenueRetained: computeRevRetained(inputs),
    netCostDelta: computeNetCostDelta(inputs),
    coveragePercent:
      coverageWeightedDenom > 0
        ? Math.round(coverageWeightedNumer / coverageWeightedDenom)
        : 100,
    currencyCode,
  };
}

export async function getPerCityBreakdown(
  shop: string,
  range: DateRange,
  cityFilter?: string,
): Promise<CityRow[]> {
  const rows = await prisma.ldAnalyticsDaily.findMany({
    where: {
      shop,
      date: { gte: range.from, lte: range.to },
      ...(cityFilter ? { cityNorm: cityFilter } : {}),
    },
  });

  const buckets = new Map<string, CityRow & { coverageWeightedNumer: number; coverageWeightedDenom: number }>();
  for (const r of rows) {
    const existing = buckets.get(r.cityNorm) ?? {
      cityNorm: r.cityNorm,
      cityDisplay: r.cityDisplay,
      orderCount: 0,
      ldRevenueSubunits: 0,
      warehouseCustomerRateSubunits: 0,
      ldCarrierCostSubunits: 0,
      warehouseCounterfactualSubunits: 0,
      ldNet: 0,
      whCounterfactualNet: 0,
      plDelta: 0,
      coveragePercent: 100,
      coverageWeightedNumer: 0,
      coverageWeightedDenom: 0,
    };
    existing.cityDisplay = r.cityDisplay;
    existing.orderCount += r.ldOrderCount;
    existing.ldRevenueSubunits += r.ldRevenueSubunits;
    existing.warehouseCustomerRateSubunits += r.warehouseCustomerRateSubunits;
    existing.ldCarrierCostSubunits += r.ldCarrierCostSubunits;
    existing.warehouseCounterfactualSubunits += r.warehouseCounterfactualSubunits;
    existing.coverageWeightedNumer += r.coveragePercent * r.ldOrderCount;
    existing.coverageWeightedDenom += r.ldOrderCount;
    buckets.set(r.cityNorm, existing);
  }

  const out: CityRow[] = [];
  for (const b of buckets.values()) {
    const inputs = {
      ldRevenueSubunits: b.ldRevenueSubunits,
      ldCarrierCostSubunits: b.ldCarrierCostSubunits,
      warehouseCounterfactualSubunits: b.warehouseCounterfactualSubunits,
      warehouseCustomerRateSubunits: b.warehouseCustomerRateSubunits,
      taxSavingsSubunits: 0, // tax already folded city-side; rerun framing on totals
    };
    const ldNet = computeLdNet(inputs);
    const whNet = computeWhNet(inputs);
    const plDelta = computePlImpact(inputs);
    const coverage =
      b.coverageWeightedDenom > 0
        ? Math.round(b.coverageWeightedNumer / b.coverageWeightedDenom)
        : 100;
    out.push({
      cityNorm: b.cityNorm,
      cityDisplay: b.cityDisplay,
      orderCount: b.orderCount,
      ldRevenueSubunits: b.ldRevenueSubunits,
      warehouseCustomerRateSubunits: b.warehouseCustomerRateSubunits,
      ldCarrierCostSubunits: b.ldCarrierCostSubunits,
      warehouseCounterfactualSubunits: b.warehouseCounterfactualSubunits,
      ldNet,
      whCounterfactualNet: whNet,
      plDelta,
      coveragePercent: coverage,
    });
  }

  out.sort((a, b) => b.orderCount - a.orderCount);
  return out;
}

export async function getOrdersForCity(
  shop: string,
  cityNorm: string,
  range: DateRange,
  limit = 50,
): Promise<DrilldownOrder[]> {
  // Walk LalamoveDispatchJob in range, expand orders, filter by normalized city.
  const jobs = await prisma.lalamoveDispatchJob.findMany({
    where: { shop, requestedAt: { gte: range.from, lte: range.to } },
    orderBy: { requestedAt: "desc" },
  });
  const orderIds = new Map<string, { jobLdSubunitsPerOrder: number; currency: string }>();
  for (const j of jobs) {
    const refs = (j.ordersData as Array<{ shopifyOrderId: string }> | null) ?? [];
    if (refs.length === 0) continue;
    const total = parseFloat(j.quotationTotal ?? "0");
    const perOrder = refs.length > 0 ? Math.round((total * 100) / refs.length) : 0;
    for (const r of refs) {
      if (!orderIds.has(r.shopifyOrderId)) {
        orderIds.set(r.shopifyOrderId, {
          jobLdSubunitsPerOrder: perOrder,
          currency: j.quotationCurrency ?? "BRL",
        });
      }
    }
  }
  if (orderIds.size === 0) return [];

  const ids = Array.from(orderIds.keys());
  const orders = await prisma.shopOrder.findMany({
    where: { shop, id: { in: ids } },
    take: Math.max(limit * 4, 200),
  });

  // Walk warehouse-quote cache for these orders to enrich rows.
  const cacheRows = await prisma.warehouseCarrierQuoteCache.findMany({
    where: { shop, orderId: { in: ids } },
  });
  const cacheByOrder = new Map<string, (typeof cacheRows)[number]>();
  for (const c of cacheRows) cacheByOrder.set(c.orderId, c);

  const out: DrilldownOrder[] = [];
  for (const o of orders) {
    const shipping = (o.shippingAddressJson as { city?: string } | null) ?? null;
    if (!shipping?.city) continue;
    const city = shipping.city;
    const norm = city
      .toString()
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-");
    if (norm !== cityNorm) continue;
    const ldInfo = orderIds.get(o.id);
    if (!ldInfo) continue;
    const cache = cacheByOrder.get(o.id);
    out.push({
      orderId: o.id,
      orderName: o.name ?? o.id.split("/").pop() ?? o.id,
      orderDate: o.orderDate,
      cityDisplay: city,
      ldRevenueSubunits: 0, // v1 — see rollup ASSUMPTION
      warehouseCustomerRateSubunits: cache?.priceSubunits ?? 0,
      ldCarrierCostSubunits: ldInfo.jobLdSubunitsPerOrder,
      warehouseCounterfactualSubunits: cache?.priceSubunits ?? 0,
      isFreeShipped: true, // v1 default — refined in v2 once shippingLines is captured
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Returns the latest successful headline metrics — used as a fallback when
 * the live carrier API is failing (state #4 — "auth_failed").
 */
export async function getLastSuccessfulHeadline(shop: string): Promise<{
  date: Date;
  metrics: HeadlineMetrics;
} | null> {
  const latest = await prisma.ldAnalyticsDaily.findFirst({
    where: { shop },
    orderBy: { date: "desc" },
  });
  if (!latest) return null;
  const range: DateRange = {
    from: new Date(latest.date.getTime() - 30 * 24 * 60 * 60 * 1000),
    to: latest.date,
  };
  const metrics = await getHeadlineMetrics(shop, range);
  return { date: latest.date, metrics };
}

/**
 * Used by the no-carrier provocation teaser (state #3, Variant B).
 * Returns a rough monthly-savings estimate based on the last 90 days of
 * rolled-up data — we can compute this even without the merchant having
 * connected a carrier IF the rollup has previously run with manual overrides.
 *
 * If there is no historical data at all, returns null and the page falls back
 * to Variant A copy.
 */
export async function computeSpeculativeTeaser(
  shop: string,
  range: DateRange,
): Promise<{ amountSubunits: number; topCity: string; currency: string } | null> {
  const rows = await prisma.ldAnalyticsDaily.findMany({
    where: { shop, date: { gte: range.from, lte: range.to } },
  });
  if (rows.length === 0) return null;
  const totalPlDelta = rows.reduce((acc, r) => {
    return (
      acc +
      computePlImpact({
        ldRevenueSubunits: r.ldRevenueSubunits,
        ldCarrierCostSubunits: r.ldCarrierCostSubunits,
        warehouseCounterfactualSubunits: r.warehouseCounterfactualSubunits,
        warehouseCustomerRateSubunits: r.warehouseCustomerRateSubunits,
        taxSavingsSubunits: r.taxSavingsSubunits,
      })
    );
  }, 0);
  const days = Math.max(
    1,
    Math.round((range.to.getTime() - range.from.getTime()) / (24 * 60 * 60 * 1000)),
  );
  const monthly = Math.round((totalPlDelta * 30) / days);

  // Pick the city with the largest order count for the teaser copy.
  const cityCounts = new Map<string, { display: string; count: number }>();
  for (const r of rows) {
    const e = cityCounts.get(r.cityNorm) ?? { display: r.cityDisplay, count: 0 };
    e.count += r.ldOrderCount;
    cityCounts.set(r.cityNorm, e);
  }
  const top = Array.from(cityCounts.values()).sort((a, b) => b.count - a.count)[0];

  return {
    amountSubunits: monthly,
    topCity: top?.display ?? "your top LD city",
    currency: rows[0]?.currencyCode ?? "BRL",
  };
}
