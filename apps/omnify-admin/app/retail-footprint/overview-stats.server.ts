/**
 * Retail Footprint — Overview Stats computation
 *
 * Computes the overview strip data with drill-down support:
 *   Row 1 "Online reach": total revenue, orders, customers, cities
 *   Row 2 drill-down: top 10 cities by selected metric
 *   Row 3 "Footprint breakdown": Pareto, channel mix, projection
 *   Row 4 drill-downs: stacked bars, donuts, gap table
 */
import prisma from "../db.server";
import { getDateRange } from "../services/merchandising/order-stats-shared";
import { normalizeCityKey } from "./analytics-queries.server";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ShopifyLocationClassified = {
  id: string;
  name: string;
  city: string | null;
  cityNorm: string;
  type: "store" | "warehouse";
};

export type OverviewStats = {
  // Row 1: Online Reach
  totalRevenue: number;
  totalOrders: number;
  totalCustomers: number;
  citiesReached: number;
  currencyCode: string | null;

  // Row 3: Footprint Breakdown cards
  pareto: {
    cityCount: number;
    revenuePercent: number;
    customerPercent: number;
  };
  channelMix: { storePercent: number; warehousePercent: number } | null;
  expansionGap: {
    citiesWithoutStore: number;
    customersWithoutAccess: number;
    cityNames: string[];
    topNCities: number;
  } | null;
  projection: { estimatedRevenue: number; citiesCount: number } | null;

  // ─── Drill-down data ───
  topCities: Array<{
    cityNorm: string;
    cityDisplay: string;
    revenue: number;
    orders: number;
    customers: number;
  }>;
  cityRevenueSplit: Array<{
    cityNorm: string;
    cityDisplay: string;
    onlineRevenue: number;
    storeRevenue: number;
    totalRevenue: number;
    storePct: number;
  }> | null;
  cityFulfillmentSplit: Array<{
    cityNorm: string;
    cityDisplay: string;
    storeOrders: number;
    warehouseOrders: number;
    totalOrders: number;
    storePct: number;
  }> | null;
  gapCityDetails: Array<{
    cityNorm: string;
    cityDisplay: string;
    revenue: number;
    customers: number;
    orders: number;
  }> | null;
};

// ─── Location classification ────────────────────────────────────────────────

export function classifyLocations(
  rawLocations: Array<{
    id: string;
    name: string;
    address: { city: string | null };
    localPickupSettingsV2: unknown | null;
  }>,
): ShopifyLocationClassified[] {
  return rawLocations.map((loc) => ({
    id: loc.id,
    name: loc.name,
    city: loc.address.city,
    cityNorm: normalizeCityKey(loc.address.city),
    type: loc.localPickupSettingsV2 != null ? "store" : "warehouse",
  }));
}

// ─── Main computation ───────────────────────────────────────────────────────

type CityAgg = {
  cityNorm: string;
  cityDisplay: string;
  revenue: number;
  orders: number;
  customers: number;
};

export async function computeOverviewStats(
  shop: string,
  periodDays: number,
  shopifyLocations: ShopifyLocationClassified[],
): Promise<OverviewStats> {
  const { startDate } = getDateRange(periodDays);

  // ── Row 1: aggregate KPIs ─────────────────────────────────────────────────
  const [row1] = await prisma.$queryRawUnsafe<
    Array<{
      totalOrders: bigint;
      totalRevenue: number;
      totalCustomers: bigint;
      citiesReached: bigint;
      currencyCode: string | null;
    }>
  >(
    `SELECT
      COUNT(*) as "totalOrders",
      COALESCE(SUM("totalAmount"), 0) as "totalRevenue",
      COUNT(DISTINCT "customerId") as "totalCustomers",
      COUNT(DISTINCT "cityNorm") as "citiesReached",
      MAX("currencyCode") as "currencyCode"
    FROM "RetailOrder"
    WHERE "shop" = $1 AND "orderDate" >= $2::timestamp`,
    shop,
    startDate,
  );

  const totalOrders = Number(row1.totalOrders);
  const totalRevenue = Number(row1.totalRevenue);
  const totalCustomers = Number(row1.totalCustomers);
  const citiesReached = Number(row1.citiesReached);
  const currencyCode = row1.currencyCode ?? null;

  // ── City aggregation (used for Pareto, topCities, gapCityDetails) ─────────
  const cityRows = await prisma.$queryRawUnsafe<
    Array<{ cityNorm: string; city: string; revenue: number; customers: bigint; orders: bigint }>
  >(
    `SELECT
      "cityNorm",
      MAX("city") as "city",
      COALESCE(SUM("totalAmount"), 0) as "revenue",
      COUNT(DISTINCT "customerId") as "customers",
      COUNT(*) as "orders"
    FROM "RetailOrder"
    WHERE "shop" = $1 AND "orderDate" >= $2::timestamp
    GROUP BY "cityNorm"
    ORDER BY "revenue" DESC`,
    shop,
    startDate,
  );

  const cityAggs: CityAgg[] = cityRows.map((r) => ({
    cityNorm: r.cityNorm,
    cityDisplay: r.city,
    revenue: Number(r.revenue),
    orders: Number(r.orders),
    customers: Number(r.customers),
  }));

  // ── Top 10 cities for drill-down ──────────────────────────────────────────
  const topCities = cityAggs.slice(0, 10).map((c) => ({
    cityNorm: c.cityNorm,
    cityDisplay: c.cityDisplay,
    revenue: c.revenue,
    orders: c.orders,
    customers: c.customers,
  }));

  // ── Pareto analysis (60% threshold) ───────────────────────────────────────
  const revenueThreshold = totalRevenue * 0.6;
  let cumulativeRevenue = 0;
  let cumulativeCustomers = 0;
  let paretoCount = 0;
  const paretoCities: CityAgg[] = [];

  for (const city of cityAggs) {
    cumulativeRevenue += city.revenue;
    cumulativeCustomers += city.customers;
    paretoCount++;
    paretoCities.push(city);
    if (cumulativeRevenue >= revenueThreshold && paretoCount >= 1) break;
  }

  const pareto = {
    cityCount: paretoCount,
    revenuePercent: totalRevenue > 0 ? Math.round((cumulativeRevenue / totalRevenue) * 100) : 0,
    customerPercent: totalCustomers > 0 ? Math.round((cumulativeCustomers / totalCustomers) * 100) : 0,
  };

  // ── Classify store cities (used by channel mix, expansion gap, projection) ─
  const storeCityNorms = new Set(
    shopifyLocations.filter((l) => l.type === "store").map((l) => l.cityNorm),
  );
  const storeLocations = shopifyLocations.filter((l) => l.type === "store");
  const storeIds = storeLocations.map((l) => l.id);

  // ── Channel mix (scoped to cities with physical stores) ───────────────────
  let channelMix: OverviewStats["channelMix"] = null;

  if (storeIds.length > 0 && storeCityNorms.size > 0) {
    const storeCityNormsArr = Array.from(storeCityNorms);
    const [mixRow] = await prisma.$queryRawUnsafe<
      Array<{ totalInStoreCities: bigint; storeOrders: bigint }>
    >(
      `SELECT
        COUNT(*) as "totalInStoreCities",
        COUNT(*) FILTER (WHERE "fulfillmentLocationId" = ANY($3::text[])) as "storeOrders"
      FROM "RetailOrder"
      WHERE "shop" = $1 AND "orderDate" >= $2::timestamp
        AND "cityNorm" = ANY($4::text[])
        AND "fulfillmentLocationId" IS NOT NULL`,
      shop,
      startDate,
      storeIds,
      storeCityNormsArr,
    );

    const totalInStoreCities = Number(mixRow.totalInStoreCities);
    if (totalInStoreCities > 0) {
      const storeOrdersCount = Number(mixRow.storeOrders);
      const storePct = Math.round((storeOrdersCount / totalInStoreCities) * 100);
      channelMix = {
        storePercent: storePct,
        warehousePercent: 100 - storePct,
      };
    }
  }

  // ── Expansion gap ─────────────────────────────────────────────────────────
  let expansionGap: OverviewStats["expansionGap"] = null;
  let gapCityDetails: OverviewStats["gapCityDetails"] = null;

  if (storeCityNorms.size > 0 && paretoCities.length > 0) {
    const gapCities = paretoCities.filter((c) => !storeCityNorms.has(c.cityNorm));

    if (gapCities.length > 0) {
      const gapCityNorms = gapCities.map((c) => c.cityNorm);

      const [gapRow] = await prisma.$queryRawUnsafe<
        Array<{ customers: bigint }>
      >(
        `SELECT COUNT(DISTINCT "customerId") as "customers"
        FROM "RetailOrder"
        WHERE "shop" = $1 AND "orderDate" >= $2::timestamp AND "cityNorm" = ANY($3::text[])`,
        shop,
        startDate,
        gapCityNorms,
      );

      expansionGap = {
        citiesWithoutStore: gapCities.length,
        customersWithoutAccess: Number(gapRow.customers),
        cityNames: gapCities.map((c) => c.cityDisplay),
        topNCities: paretoCount,
      };

      // Gap city details for Row 4.3 table
      gapCityDetails = gapCities.map((c) => ({
        cityNorm: c.cityNorm,
        cityDisplay: c.cityDisplay,
        revenue: c.revenue,
        customers: c.customers,
        orders: c.orders,
      }));
    }
  }

  // ── Projection (regra de três) ────────────────────────────────────────────
  let projection: OverviewStats["projection"] = null;

  if (
    expansionGap &&
    expansionGap.citiesWithoutStore > 0 &&
    channelMix &&
    channelMix.storePercent > 0 &&
    channelMix.storePercent < 100
  ) {
    const gapCityNormsForProjection = paretoCities
      .filter((c) => !storeCityNorms.has(c.cityNorm))
      .map((c) => c.cityNorm);

    if (gapCityNormsForProjection.length > 0) {
      const [gapRevenueRow] = await prisma.$queryRawUnsafe<
        Array<{ totalRev: number }>
      >(
        `SELECT COALESCE(SUM("totalAmount"), 0) as "totalRev"
        FROM "RetailOrder"
        WHERE "shop" = $1 AND "orderDate" >= $2::timestamp AND "cityNorm" = ANY($3::text[])`,
        shop,
        startDate,
        gapCityNormsForProjection,
      );

      const avgOnlineRevenuePerCity =
        Number(gapRevenueRow.totalRev) / gapCityNormsForProjection.length;
      const upliftFactor =
        channelMix.storePercent / (100 - channelMix.storePercent);
      const perCityUplift = Math.round(avgOnlineRevenuePerCity * upliftFactor);

      if (perCityUplift > 0) {
        projection = {
          estimatedRevenue: perCityUplift,
          citiesCount: expansionGap.citiesWithoutStore,
        };
      }
    }
  }

  // ── City revenue split for Row 4.1 (stacked bars) ────────────────────────
  let cityRevenueSplit: OverviewStats["cityRevenueSplit"] = null;

  if (storeIds.length > 0 && paretoCities.length > 0) {
    const paretoCityNorms = paretoCities.map((c) => c.cityNorm);
    const splitRows = await prisma.$queryRawUnsafe<
      Array<{ cityNorm: string; city: string; totalRevenue: number; storeRevenue: number }>
    >(
      `SELECT
        "cityNorm",
        MAX("city") as "city",
        COALESCE(SUM("totalAmount"), 0) as "totalRevenue",
        COALESCE(SUM("totalAmount") FILTER (WHERE "fulfillmentLocationId" = ANY($3::text[])), 0) as "storeRevenue"
      FROM "RetailOrder"
      WHERE "shop" = $1 AND "orderDate" >= $2::timestamp
        AND "cityNorm" = ANY($4::text[])
        AND "fulfillmentLocationId" IS NOT NULL
      GROUP BY "cityNorm"
      ORDER BY "totalRevenue" DESC`,
      shop,
      startDate,
      storeIds,
      paretoCityNorms,
    );

    if (splitRows.length > 0) {
      cityRevenueSplit = splitRows.map((r) => {
        const total = Number(r.totalRevenue);
        const store = Number(r.storeRevenue);
        return {
          cityNorm: r.cityNorm,
          cityDisplay: r.city,
          onlineRevenue: total - store,
          storeRevenue: store,
          totalRevenue: total,
          storePct: total > 0 ? Math.round((store / total) * 100) : 0,
        };
      });
    }
  }

  // ── City fulfillment split for Row 4.2 (donut charts) ─────────────────────
  let cityFulfillmentSplit: OverviewStats["cityFulfillmentSplit"] = null;

  if (storeIds.length > 0 && storeCityNorms.size > 0) {
    const storeCityNormsArr = Array.from(storeCityNorms);
    const fulfillmentRows = await prisma.$queryRawUnsafe<
      Array<{ cityNorm: string; city: string; totalOrders: bigint; storeOrders: bigint }>
    >(
      `SELECT
        "cityNorm",
        MAX("city") as "city",
        COUNT(*) as "totalOrders",
        COUNT(*) FILTER (WHERE "fulfillmentLocationId" = ANY($3::text[])) as "storeOrders"
      FROM "RetailOrder"
      WHERE "shop" = $1 AND "orderDate" >= $2::timestamp
        AND "cityNorm" = ANY($4::text[])
        AND "fulfillmentLocationId" IS NOT NULL
      GROUP BY "cityNorm"
      ORDER BY "totalOrders" DESC`,
      shop,
      startDate,
      storeIds,
      storeCityNormsArr,
    );

    if (fulfillmentRows.length > 0) {
      cityFulfillmentSplit = fulfillmentRows.map((r) => {
        const total = Number(r.totalOrders);
        const store = Number(r.storeOrders);
        return {
          cityNorm: r.cityNorm,
          cityDisplay: r.city,
          storeOrders: store,
          warehouseOrders: total - store,
          totalOrders: total,
          storePct: total > 0 ? Math.round((store / total) * 100) : 0,
        };
      });
    }
  }

  return {
    totalRevenue,
    totalOrders,
    totalCustomers,
    citiesReached,
    currencyCode,
    pareto,
    channelMix,
    expansionGap,
    projection,
    topCities,
    cityRevenueSplit,
    cityFulfillmentSplit,
    gapCityDetails,
  };
}
