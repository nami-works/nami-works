/**
 * Daily rollup. Per-shop, per-day. Idempotent (upsert keyed on
 * (shop, cityNorm, date)).
 *
 * 1. Fetch LalamoveDispatchJob rows where the job was requested within
 *    [date, date+1day) for `shop`.
 * 2. For each dispatched order:
 *    a. Read ShopOrder (shipping address, line items, prices).
 *    b. getOrFetchQuote() for the warehouse counterfactual.
 * 3. Aggregate into per-city × per-day buckets and upsert LdAnalyticsDaily.
 * 4. Compute coverage % (orders successfully quoted / total orders).
 *
 * See docs/plans/local-delivery-analytics.md §5.2.
 */

import prisma from "../../db.server";
import { getOrFetchQuote } from "../warehouse-carrier/quote-cache.server";
import { getActiveCredentialForShop } from "../warehouse-carrier/aggregator.server";
import type { WarehouseQuoteRequest } from "../warehouse-carrier/types";

export type RollupResult = {
  shop: string;
  date: Date;
  cities: number;
  orders: number;
  coveragePercent: number;
  durationMs: number;
};

type ShippingAddress = {
  address1?: string | null;
  city?: string | null;
  province?: string | null;
  province_code?: string | null;
  provinceCode?: string | null;
  country?: string | null;
  country_code?: string | null;
  countryCode?: string | null;
  zip?: string | null;
  postalCode?: string | null;
};

type LineItem = {
  quantity?: number;
  grams?: number;
  weight_grams?: number;
  weightGrams?: number;
  variant?: { weight?: number; weight_unit?: string };
  price?: string | number;
};

type RollupConfig = {
  perCityTaxSavings: Record<string, number>; // cityNorm → percent (0-100)
  perLocationWarehouseCost: Record<string, { perOrderSubunits: number; currency: string }>;
};

export function startOfDayUtc(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

export function normalizeCity(raw: string | null | undefined): string {
  if (!raw) return "unknown";
  return raw
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "unknown";
}

function totalShippingItems(lineItems: LineItem[] | null | undefined): {
  weightGrams: number;
  quantity: number;
  valueSubunits: number;
} {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    return { weightGrams: 500, quantity: 1, valueSubunits: 0 };
  }
  let totalWeight = 0;
  let totalQty = 0;
  let totalValue = 0;
  for (const li of lineItems) {
    const qty = typeof li.quantity === "number" ? li.quantity : 1;
    const grams = li.weight_grams ?? li.weightGrams ?? li.grams ?? li.variant?.weight ?? 0;
    totalWeight += Number(grams) * qty;
    totalQty += qty;
    const priceMajor = typeof li.price === "string" ? parseFloat(li.price) : li.price ?? 0;
    if (Number.isFinite(priceMajor)) totalValue += Math.round(priceMajor * 100) * qty;
  }
  return {
    weightGrams: totalWeight > 0 ? totalWeight : 500,
    quantity: totalQty > 0 ? totalQty : 1,
    valueSubunits: totalValue,
  };
}

function buildQuoteRequest(
  shippingAddress: ShippingAddress,
  origin: { postalCode: string; city: string; province: string; country: string },
  lineItems: LineItem[] | null,
  currency: string,
  isSpeculative: boolean,
): WarehouseQuoteRequest | null {
  const destPostal = (shippingAddress.zip ?? shippingAddress.postalCode ?? "").trim();
  const destCity = (shippingAddress.city ?? "").trim();
  if (!destPostal || !destCity) return null;
  const destCountry =
    shippingAddress.country_code ??
    shippingAddress.countryCode ??
    shippingAddress.country ??
    "BR";
  const destProvince =
    shippingAddress.province_code ??
    shippingAddress.provinceCode ??
    shippingAddress.province ??
    "";
  const items = totalShippingItems(lineItems);
  return {
    origin,
    destination: {
      postalCode: destPostal,
      address1: shippingAddress.address1 ?? undefined,
      city: destCity,
      province: destProvince,
      country: destCountry,
    },
    items: [items],
    currency,
    isSpeculative,
  };
}

export async function getOrCreateConfig(shop: string) {
  return prisma.ldAnalyticsConfig.upsert({
    where: { shop },
    create: { shop },
    update: {},
  });
}

function readConfigJson(cfg: {
  perCityTaxSavingsJson: unknown;
  perLocationWarehouseCostJson: unknown;
}): RollupConfig {
  const perCityRaw = (cfg.perCityTaxSavingsJson ?? {}) as Record<string, number>;
  const perLocationRaw = (cfg.perLocationWarehouseCostJson ?? {}) as Record<
    string,
    { perOrderSubunits?: number; currency?: string }
  >;
  const perCity: Record<string, number> = {};
  for (const [k, v] of Object.entries(perCityRaw)) {
    if (typeof v === "number" && Number.isFinite(v)) perCity[k] = v;
  }
  const perLocation: RollupConfig["perLocationWarehouseCost"] = {};
  for (const [k, v] of Object.entries(perLocationRaw)) {
    if (v && typeof v.perOrderSubunits === "number") {
      perLocation[k] = {
        perOrderSubunits: v.perOrderSubunits,
        currency: typeof v.currency === "string" ? v.currency : "BRL",
      };
    }
  }
  return { perCityTaxSavings: perCity, perLocationWarehouseCost: perLocation };
}

type PerCityBucket = {
  cityNorm: string;
  cityDisplay: string;
  ldOrderCount: number;
  ldRevenueSubunits: number;
  ldCarrierCostSubunits: number;
  warehouseCounterfactualSubunits: number;
  warehouseCustomerRateSubunits: number;
  taxSavingsSubunits: number;
  currencyCode: string;
  quotedOrders: number; // for coverage %
};

/**
 * Daily rollup for a single shop+date. Returns summary stats.
 *
 * `originPostalForLocation` keys the LD pickup origin; if missing for a given
 * location we still log and skip warehouse quoting for those orders (they will
 * count toward the total but not toward coverage).
 */
export async function rollupShop(shop: string, date: Date): Promise<RollupResult> {
  const startedAt = Date.now();
  const dayStart = startOfDayUtc(date);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  console.info(
    `[ld-analytics:rollup] rollupShop START shop=${shop} date=${dayStart.toISOString()}`,
  );

  const cfgRow = await getOrCreateConfig(shop);
  const cfg = readConfigJson(cfgRow);

  // Pull all dispatch jobs requested on the target day.
  const jobs = await prisma.lalamoveDispatchJob.findMany({
    where: {
      shop,
      requestedAt: { gte: dayStart, lt: dayEnd },
    },
  });

  if (jobs.length === 0) {
    const durationMs = Date.now() - startedAt;
    console.info(
      `[ld-analytics:rollup] rollupShop OK shop=${shop} cities=0 orders=0 coverage=100% durationMs=${durationMs}`,
    );
    return { shop, date: dayStart, cities: 0, orders: 0, coveragePercent: 100, durationMs };
  }

  // Look up location pickup origins (Lalamove location config carries pickup details).
  const locationIds = Array.from(new Set(jobs.map((j) => j.locationId)));
  const lalamoveConfigs = await prisma.lalamoveLocationConfig.findMany({
    where: { shop, locationId: { in: locationIds } },
  });
  const originByLocation = new Map<
    string,
    { postalCode: string; city: string; province: string; country: string }
  >();
  for (const row of lalamoveConfigs) {
    const data = row.data as {
      locationAddress?: string;
      city?: string;
      market?: string;
      pickupPostalCode?: string;
    };
    // Fallback country from market: BR_SAO → BR
    const country = data?.market?.split("_")[0] ?? "BR";
    if (data?.pickupPostalCode && data?.city) {
      originByLocation.set(row.locationId, {
        postalCode: data.pickupPostalCode,
        city: data.city,
        province: country === "BR" ? "SP" : "",
        country,
      });
    }
  }

  const credential = await getActiveCredentialForShop(shop);
  const buckets = new Map<string, PerCityBucket>();
  let totalOrders = 0;
  let quotedOrders = 0;

  for (const job of jobs) {
    const orderRefs = (job.ordersData as Array<{ shopifyOrderId: string }> | null) ?? [];
    if (orderRefs.length === 0) continue;
    const orderIds = orderRefs.map((r) => r.shopifyOrderId).filter(Boolean);
    if (orderIds.length === 0) continue;

    const orders = await prisma.shopOrder.findMany({
      where: { shop, id: { in: orderIds } },
    });

    const ldCostSubunitsTotal = parseFloat(job.quotationTotal ?? "0");
    const perOrderLdCostSubunits =
      orders.length > 0 ? Math.round((ldCostSubunitsTotal * 100) / orders.length) : 0;
    const currency = job.quotationCurrency ?? "BRL";

    for (const order of orders) {
      totalOrders += 1;

      const shipping = (order.shippingAddressJson as ShippingAddress | null) ?? null;
      if (!shipping) continue;
      const cityRaw = shipping.city ?? "Unknown";
      const cityNorm = normalizeCity(cityRaw);
      const cityDisplay = cityRaw || "Unknown";

      // LD revenue: stored on Shopify order's shippingLines; we approximate via
      // currentTotalPrice less line-item totals. For v1 we read a conservative
      // 0 if we can't find a shipping line entry — operator can override per
      // city via tax savings %.
      // ASSUMPTION: shippingLines is not on ShopOrder; defer to 0 and log.
      // Phase-3 follow-up §13.4 covers free-ship counterfactual logic.
      const ldRevenueSubunits = 0;

      const lineItems = order.lineItemsJson as LineItem[] | null;

      // Warehouse counterfactual — try the carrier; fall back to per-location override.
      let whCarrierCostSubunits = 0;
      let whCustomerRateSubunits = 0;
      let quoted = false;

      const origin = originByLocation.get(job.locationId);
      if (credential && origin) {
        const req = buildQuoteRequest(shipping, origin, lineItems, currency, false);
        if (req) {
          const quote = await getOrFetchQuote(shop, order.id, credential.provider, req);
          if ("result" in quote) {
            whCarrierCostSubunits = quote.result.priceSubunits;
            whCustomerRateSubunits = quote.result.priceSubunits; // v1: use carrier rate as proxy
            quoted = true;
          } else {
            console.warn(
              `[ld-analytics:rollup] quote skipped shop=${shop} orderIdHash=${order.id.slice(-6)} errorCode=${quote.error.errorCode}`,
            );
          }
        }
      }

      // Per-location override fallback.
      if (!quoted) {
        const override = cfg.perLocationWarehouseCost[job.locationId];
        if (override) {
          whCarrierCostSubunits = override.perOrderSubunits;
          whCustomerRateSubunits = override.perOrderSubunits;
          quoted = true;
        }
      }

      if (quoted) quotedOrders += 1;

      const taxPercent = cfg.perCityTaxSavings[cityNorm] ?? 0;
      const taxSavingsSubunits = Math.round(
        ((order.currentTotalPrice ?? 0) * 100 * taxPercent) / 100,
      );

      const bucketKey = cityNorm;
      const bucket = buckets.get(bucketKey) ?? {
        cityNorm,
        cityDisplay,
        ldOrderCount: 0,
        ldRevenueSubunits: 0,
        ldCarrierCostSubunits: 0,
        warehouseCounterfactualSubunits: 0,
        warehouseCustomerRateSubunits: 0,
        taxSavingsSubunits: 0,
        currencyCode: currency,
        quotedOrders: 0,
      };
      bucket.ldOrderCount += 1;
      bucket.ldRevenueSubunits += ldRevenueSubunits;
      bucket.ldCarrierCostSubunits += perOrderLdCostSubunits;
      bucket.warehouseCounterfactualSubunits += whCarrierCostSubunits;
      bucket.warehouseCustomerRateSubunits += whCustomerRateSubunits;
      bucket.taxSavingsSubunits += taxSavingsSubunits;
      if (quoted) bucket.quotedOrders += 1;
      buckets.set(bucketKey, bucket);
    }
  }

  const overallCoverage = totalOrders > 0 ? Math.round((quotedOrders / totalOrders) * 100) : 100;

  for (const bucket of buckets.values()) {
    const cov =
      bucket.ldOrderCount > 0
        ? Math.round((bucket.quotedOrders / bucket.ldOrderCount) * 100)
        : 100;
    await prisma.ldAnalyticsDaily.upsert({
      where: {
        shop_cityNorm_date: { shop, cityNorm: bucket.cityNorm, date: dayStart },
      },
      create: {
        shop,
        cityNorm: bucket.cityNorm,
        cityDisplay: bucket.cityDisplay,
        date: dayStart,
        ldOrderCount: bucket.ldOrderCount,
        ldRevenueSubunits: bucket.ldRevenueSubunits,
        ldCarrierCostSubunits: bucket.ldCarrierCostSubunits,
        warehouseCounterfactualSubunits: bucket.warehouseCounterfactualSubunits,
        warehouseCustomerRateSubunits: bucket.warehouseCustomerRateSubunits,
        taxSavingsSubunits: bucket.taxSavingsSubunits,
        currencyCode: bucket.currencyCode,
        coveragePercent: cov,
      },
      update: {
        cityDisplay: bucket.cityDisplay,
        ldOrderCount: bucket.ldOrderCount,
        ldRevenueSubunits: bucket.ldRevenueSubunits,
        ldCarrierCostSubunits: bucket.ldCarrierCostSubunits,
        warehouseCounterfactualSubunits: bucket.warehouseCounterfactualSubunits,
        warehouseCustomerRateSubunits: bucket.warehouseCustomerRateSubunits,
        taxSavingsSubunits: bucket.taxSavingsSubunits,
        currencyCode: bucket.currencyCode,
        coveragePercent: cov,
        computedAt: new Date(),
      },
    });
  }

  const durationMs = Date.now() - startedAt;
  console.info(
    `[ld-analytics:rollup] rollupShop OK shop=${shop} cities=${buckets.size} orders=${totalOrders} coverage=${overallCoverage}% durationMs=${durationMs}`,
  );
  return {
    shop,
    date: dayStart,
    cities: buckets.size,
    orders: totalOrders,
    coveragePercent: overallCoverage,
    durationMs,
  };
}
