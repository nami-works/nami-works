/**
 * Retail Footprint — Server-side analytics queries
 *
 * Consumes the normalized RetailOrder / RetailCustomer / RetailCityMonthly /
 * RetailHeatmapBucket tables and returns pre-computed data for the UI.
 */
import prisma from "../db.server";
import {
  getMonthsIncluded,
  monthlyAverageFromBuckets,
} from "../utils/kpi-monthly-average";

// ─── Shared helpers ──────────────────────────────────────────────────────────

const CITY_ALIASES: Record<string, string> = {
  "sao paulo sp": "sao paulo",
  "sao paulo - sp": "sao paulo",
  "sp - capital": "sao paulo",
  "sp capital": "sao paulo",
  sp: "sao paulo",
  sampa: "sao paulo",
  "s. paulo": "sao paulo",
  "s paulo": "sao paulo",
  "rio de janeiro rj": "rio de janeiro",
  "rio de janeiro - rj": "rio de janeiro",
  rj: "rio de janeiro",
  bh: "belo horizonte",
  "belo horizonte mg": "belo horizonte",
  cwb: "curitiba",
  "curitiba pr": "curitiba",
  poa: "porto alegre",
  "porto alegre rs": "porto alegre",
  ssa: "salvador",
  "salvador ba": "salvador",
  bsb: "brasilia",
  "brasilia df": "brasilia",
  brazilia: "brasilia",
  rec: "recife",
  "recife pe": "recife",
  floripa: "florianopolis",
  "florianopolis sc": "florianopolis",
  "fortaleza ce": "fortaleza",
  "goiania go": "goiania",
  "manaus am": "manaus",
  "campinas sp": "campinas",
  "guarulhos sp": "guarulhos",
  "sao bernardo do campo sp": "sao bernardo do campo",
  "santo andre sp": "santo andre",
  "osasco sp": "osasco",
  "sorocaba sp": "sorocaba",
  "santos sp": "santos",
  "niteroi rj": "niteroi",
  "barueri sp": "barueri",
};

export function normalizeCityKey(city: string | null | undefined): string {
  if (!city) return "unknown city";
  const normalized = city
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "unknown city";
  return CITY_ALIASES[normalized] ?? normalized;
}

const toRadians = (value: number) => (value * Math.PI) / 180;

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const earthRadius = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

/** Round to N decimal places. */
function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// ─── Heatmap buckets ─────────────────────────────────────────────────────────

export type HeatmapBucket = {
  lat3: number;
  lng3: number;
  orderCount: number;
  revenueSum: number;
  customerCount: number;
};

export async function getHeatmapBuckets(shop: string): Promise<HeatmapBucket[]> {
  return prisma.retailHeatmapBucket.findMany({
    where: { shop },
    select: { lat3: true, lng3: true, orderCount: true, revenueSum: true, customerCount: true },
  });
}

// ─── City rankings ───────────────────────────────────────────────────────────

export type CityRanking = {
  city: string;
  cityNorm: string;
  revenueMonthlyAverage: number;
  ordersMonthlyAverage: number;
  customersMonthlyAverage: number;
  latitude: number | null;
  longitude: number | null;
  currencyCode: string | null;
};

export async function getCityRankings(
  shop: string,
  startMonth?: string,
  endMonth?: string,
  limit = 15,
): Promise<CityRanking[]> {
  const where: Record<string, unknown> = { shop };
  if (startMonth || endMonth) {
    where.month = {};
    if (startMonth) (where.month as Record<string, string>).gte = startMonth;
    if (endMonth) (where.month as Record<string, string>).lte = endMonth;
  }

  const rows = await prisma.retailCityMonthly.findMany({
    where: where as any,
  });

  // Group by cityNorm, compute averages
  const grouped = new Map<
    string,
    {
      cityDisplay: string;
      months: Set<string>;
      totalRevenue: number;
      totalOrders: number;
      totalCustomers: number;
      latitudeSum: number;
      longitudeSum: number;
      geocodedCount: number;
      currencyCode: string | null;
    }
  >();

  for (const row of rows) {
    let group = grouped.get(row.cityNorm);
    if (!group) {
      group = {
        cityDisplay: row.cityDisplay,
        months: new Set(),
        totalRevenue: 0,
        totalOrders: 0,
        totalCustomers: 0,
        latitudeSum: 0,
        longitudeSum: 0,
        geocodedCount: 0,
        currencyCode: row.currencyCode,
      };
      grouped.set(row.cityNorm, group);
    }
    group.months.add(row.month);
    group.totalRevenue += row.revenue;
    group.totalOrders += row.orderCount;
    group.totalCustomers += row.uniqueCustomers;
    group.latitudeSum += row.latitudeSum;
    group.longitudeSum += row.longitudeSum;
    group.geocodedCount += row.geocodedCount;
    if (!group.currencyCode && row.currencyCode) {
      group.currencyCode = row.currencyCode;
    }
  }

  const rankings: CityRanking[] = [];
  for (const [cityNorm, group] of grouped) {
    const monthCount = group.months.size || 1;
    rankings.push({
      city: group.cityDisplay,
      cityNorm,
      revenueMonthlyAverage: group.totalRevenue / monthCount,
      ordersMonthlyAverage: group.totalOrders / monthCount,
      customersMonthlyAverage: group.totalCustomers / monthCount,
      latitude: group.geocodedCount > 0 ? group.latitudeSum / group.geocodedCount : null,
      longitude: group.geocodedCount > 0 ? group.longitudeSum / group.geocodedCount : null,
      currencyCode: group.currencyCode,
    });
  }

  // Sort by revenue descending, return top N
  rankings.sort((a, b) => b.revenueMonthlyAverage - a.revenueMonthlyAverage);
  return rankings.slice(0, limit);
}

// ─── Project radius stats ────────────────────────────────────────────────────

export type LocationRadiusStat = {
  radius: number;
  revenue: number;
  orders: number;
  customers: number;
  currencyCode: string | null;
};

export type LocationWithStats = {
  locationId: string;
  locationName: string;
  stats: LocationRadiusStat[];
};

export async function getProjectRadiusStats(
  shop: string,
  locations: Array<{ id: string; name: string; latitude: number; longitude: number }>,
  radii: number[],
  dateRange?: { start: Date; end: Date },
): Promise<LocationWithStats[]> {
  const maxRadius = Math.max(...radii);
  const results: LocationWithStats[] = [];

  for (const loc of locations) {
    // Bounding box pre-filter for the largest radius
    const latDelta = maxRadius / 111.0;
    const lngDelta = maxRadius / (111.0 * Math.cos(toRadians(loc.latitude)));

    const candidates = await prisma.retailOrder.findMany({
      where: {
        shop,
        latitude: { gte: loc.latitude - latDelta, lte: loc.latitude + latDelta },
        longitude: { gte: loc.longitude - lngDelta, lte: loc.longitude + lngDelta },
        ...(dateRange ? { orderDate: { gte: dateRange.start, lte: dateRange.end } } : {}),
      },
      select: {
        id: true,
        customerId: true,
        latitude: true,
        longitude: true,
        totalAmount: true,
        currencyCode: true,
      },
    });

    // Compute haversine once per candidate, bucket into radii
    const candidatesWithDistance = candidates
      .filter((o) => o.latitude != null && o.longitude != null)
      .map((o) => ({
        ...o,
        distance: haversineKm(loc.latitude, loc.longitude, o.latitude!, o.longitude!),
      }));

    const stats: LocationRadiusStat[] = radii.map((r) => {
      const within = candidatesWithDistance.filter((o) => o.distance <= r);
      const customerIds = new Set<string>();
      within.forEach((o) => { if (o.customerId) customerIds.add(o.customerId); });
      const revenue = within.reduce((sum, o) => sum + (o.totalAmount ?? 0), 0);
      const currencyCode = within.find((o) => o.currencyCode)?.currencyCode ?? null;
      return { radius: r, revenue, orders: within.length, customers: customerIds.size, currencyCode };
    });

    results.push({ locationId: loc.id, locationName: loc.name, stats });
  }

  return results;
}

// ─── Aggregate rebuild functions ─────────────────────────────────────────────

export async function rebuildCityAggregates(shop: string): Promise<void> {
  console.info(`[retail-footprint:aggregates] rebuildCityAggregates START shop=${shop}`);

  // Fetch all orders with city data
  const orders = await prisma.retailOrder.findMany({
    where: { shop, cityNorm: { not: null } },
    select: {
      cityNorm: true,
      city: true,
      latitude: true,
      longitude: true,
      totalAmount: true,
      currencyCode: true,
      customerId: true,
      orderDate: true,
    },
  });

  // Group by cityNorm + month
  const buckets = new Map<
    string,
    {
      cityNorm: string;
      cityDisplay: string;
      month: string;
      orderCount: number;
      revenue: number;
      customerIds: Set<string>;
      currencyCode: string | null;
      latitudeSum: number;
      longitudeSum: number;
      geocodedCount: number;
    }
  >();

  for (const order of orders) {
    if (!order.cityNorm || !order.orderDate) continue;
    const month = `${order.orderDate.getUTCFullYear()}-${String(order.orderDate.getUTCMonth() + 1).padStart(2, "0")}`;
    const key = `${order.cityNorm}::${month}`;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        cityNorm: order.cityNorm,
        cityDisplay: order.city ?? order.cityNorm,
        month,
        orderCount: 0,
        revenue: 0,
        customerIds: new Set(),
        currencyCode: order.currencyCode,
        latitudeSum: 0,
        longitudeSum: 0,
        geocodedCount: 0,
      };
      buckets.set(key, bucket);
    }

    bucket.orderCount += 1;
    bucket.revenue += order.totalAmount ?? 0;
    if (order.customerId) bucket.customerIds.add(order.customerId);
    if (!bucket.currencyCode && order.currencyCode) bucket.currencyCode = order.currencyCode;
    if (order.latitude != null && order.longitude != null) {
      bucket.latitudeSum += order.latitude;
      bucket.longitudeSum += order.longitude;
      bucket.geocodedCount += 1;
    }
  }

  // Collect current bucket keys to delete stale rows afterward
  const bucketKeys = new Set<string>();

  // Bulk upsert — INSERT ... ON CONFLICT DO UPDATE (idempotent, safe under concurrency)
  const data = [...buckets.values()];
  if (data.length > 0) {
    const BATCH_SIZE = 500;
    for (let i = 0; i < data.length; i += BATCH_SIZE) {
      const batch = data.slice(i, i + BATCH_SIZE);
      const values = batch.map((b) => {
        bucketKeys.add(`${b.cityNorm}::${b.month}`);
        const cn = b.cityNorm.replace(/'/g, "''");
        const cd = b.cityDisplay.replace(/'/g, "''");
        const mo = b.month.replace(/'/g, "''");
        const sh = shop.replace(/'/g, "''");
        const cc = b.currencyCode ? `'${b.currencyCode.replace(/'/g, "''")}'` : "NULL";
        return `(gen_random_uuid(), '${sh}', '${cn}', '${cd}', '${mo}', ${b.orderCount}, ${b.revenue}, ${b.customerIds.size}, ${cc}, ${b.latitudeSum}, ${b.longitudeSum}, ${b.geocodedCount})`;
      });
      await prisma.$executeRawUnsafe(`
        INSERT INTO "RetailCityMonthly" ("id", "shop", "cityNorm", "cityDisplay", "month", "orderCount", "revenue", "uniqueCustomers", "currencyCode", "latitudeSum", "longitudeSum", "geocodedCount")
        VALUES ${values.join(",\n")}
        ON CONFLICT ("shop", "cityNorm", "month") DO UPDATE SET
          "cityDisplay" = EXCLUDED."cityDisplay",
          "orderCount" = EXCLUDED."orderCount",
          "revenue" = EXCLUDED."revenue",
          "uniqueCustomers" = EXCLUDED."uniqueCustomers",
          "currencyCode" = EXCLUDED."currencyCode",
          "latitudeSum" = EXCLUDED."latitudeSum",
          "longitudeSum" = EXCLUDED."longitudeSum",
          "geocodedCount" = EXCLUDED."geocodedCount"
      `);
    }
  }

  // Remove stale rows that no longer have matching orders
  await prisma.retailCityMonthly.deleteMany({
    where: { shop, NOT: { cityNorm: { in: [...new Set(data.map((b) => b.cityNorm))] } } },
  });

  console.info(`[retail-footprint:aggregates] rebuildCityAggregates OK shop=${shop} buckets=${data.length}`);
}

export async function rebuildHeatmapBuckets(shop: string): Promise<void> {
  console.info(`[retail-footprint:aggregates] rebuildHeatmapBuckets START shop=${shop}`);

  const orders = await prisma.retailOrder.findMany({
    where: { shop, latitude: { not: null }, longitude: { not: null } },
    select: { latitude: true, longitude: true, totalAmount: true, customerId: true },
  });

  // Group by rounded lat/lng (3 decimals = ~111m cells)
  const cells = new Map<
    string,
    { lat3: number; lng3: number; orderCount: number; revenueSum: number; customerIds: Set<string> }
  >();

  for (const order of orders) {
    const lat3 = roundTo(order.latitude!, 3);
    const lng3 = roundTo(order.longitude!, 3);
    const key = `${lat3}::${lng3}`;

    let cell = cells.get(key);
    if (!cell) {
      cell = { lat3, lng3, orderCount: 0, revenueSum: 0, customerIds: new Set() };
      cells.set(key, cell);
    }

    cell.orderCount += 1;
    cell.revenueSum += order.totalAmount ?? 0;
    if (order.customerId) cell.customerIds.add(order.customerId);
  }

  const data = [...cells.values()];

  // Bulk upsert — INSERT ... ON CONFLICT DO UPDATE (idempotent, safe under concurrency)
  if (data.length > 0) {
    const BATCH_SIZE = 500;
    const sh = shop.replace(/'/g, "''");
    for (let i = 0; i < data.length; i += BATCH_SIZE) {
      const batch = data.slice(i, i + BATCH_SIZE);
      const values = batch.map((c) =>
        `(gen_random_uuid(), '${sh}', ${c.lat3}, ${c.lng3}, ${c.orderCount}, ${c.revenueSum}, ${c.customerIds.size})`
      );
      await prisma.$executeRawUnsafe(`
        INSERT INTO "RetailHeatmapBucket" ("id", "shop", "lat3", "lng3", "orderCount", "revenueSum", "customerCount")
        VALUES ${values.join(",\n")}
        ON CONFLICT ("shop", "lat3", "lng3") DO UPDATE SET
          "orderCount" = EXCLUDED."orderCount",
          "revenueSum" = EXCLUDED."revenueSum",
          "customerCount" = EXCLUDED."customerCount"
      `);
    }
  }

  // Remove stale cells that no longer have matching orders
  if (data.length > 0) {
    const keepKeys = data.map((c) => `(${c.lat3}, ${c.lng3})`).join(",");
    await prisma.$executeRawUnsafe(`
      DELETE FROM "RetailHeatmapBucket"
      WHERE "shop" = '${shop.replace(/'/g, "''")}'
      AND ("lat3", "lng3") NOT IN (${keepKeys})
    `);
  } else {
    await prisma.retailHeatmapBucket.deleteMany({ where: { shop } });
  }

  console.info(`[retail-footprint:aggregates] rebuildHeatmapBuckets OK shop=${shop} cells=${data.length}`);
}

// ─── Sync meta helpers ───────────────────────────────────────────────────────

export type SyncMeta = {
  status: "idle" | "running" | "failed";
  errorMessage: string | null;
  phase: string | null;
  progressCount: number | null;
  startedAt: string | null;
  lastSyncedAt: string | null;
  totalOrders: number | null;
  totalCustomers: number | null;
};

export async function readSyncMeta(shop: string): Promise<SyncMeta> {
  const row = await prisma.retailSyncMeta.findUnique({ where: { shop } });
  if (!row) {
    return {
      status: "idle",
      errorMessage: null,
      phase: null,
      progressCount: null,
      startedAt: null,
      lastSyncedAt: null,
      totalOrders: null,
      totalCustomers: null,
    };
  }
  return {
    status: row.status as SyncMeta["status"],
    errorMessage: row.errorMessage ?? null,
    phase: row.phase ?? null,
    progressCount: row.progressCount ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    totalOrders: row.totalOrders ?? null,
    totalCustomers: row.totalCustomers ?? null,
  };
}

export async function writeSyncMeta(
  shop: string,
  status: "idle" | "running" | "failed",
  opts?: {
    errorMessage?: string | null;
    phase?: string | null;
    progressCount?: number | null;
    totalOrders?: number;
    totalCustomers?: number;
  },
): Promise<void> {
  const data: Record<string, unknown> = {
    status,
    errorMessage: opts?.errorMessage ?? null,
  };
  if (status === "running") {
    data.startedAt = new Date();
    data.phase = opts?.phase ?? null;
    data.progressCount = opts?.progressCount ?? null;
  }
  if (status === "idle") {
    data.phase = null;
    data.progressCount = null;
    data.lastSyncedAt = new Date();
    if (opts?.totalOrders != null) data.totalOrders = opts.totalOrders;
    if (opts?.totalCustomers != null) data.totalCustomers = opts.totalCustomers;
  }
  if (status === "failed") {
    data.phase = null;
    data.progressCount = null;
  }

  await prisma.retailSyncMeta.upsert({
    where: { shop },
    create: { shop, ...data } as any,
    update: data,
  });
}

export async function writeSyncProgress(
  shop: string,
  phase: string,
  count: number,
): Promise<void> {
  await prisma.retailSyncMeta.upsert({
    where: { shop },
    create: { shop, status: "running", phase, progressCount: count } as any,
    update: { phase, progressCount: count },
  });
}

// ─── Batch upsert helpers for sync ───────────────────────────────────────────

export async function upsertRetailOrders(
  shop: string,
  orders: Array<{
    id: string;
    customerId: string | null;
    city: string | null;
    latitude: number | null;
    longitude: number | null;
    totalAmount: number | null;
    currencyCode: string | null;
    createdAt: string | null;
    fulfillmentLocationId?: string | null;
  }>,
): Promise<void> {
  if (orders.length === 0) return;
  // Single bulk INSERT ... ON CONFLICT — much faster than 250 individual upserts
  const values = orders.map((o) => {
    const lat = o.latitude != null ? roundTo(o.latitude, 4) : null;
    const lng = o.longitude != null ? roundTo(o.longitude, 4) : null;
    const cityN = normalizeCityKey(o.city);
    const orderDate = o.createdAt ? new Date(o.createdAt).toISOString() : null;
    const flId = o.fulfillmentLocationId ? `'${o.fulfillmentLocationId.replace(/'/g, "''")}'` : "NULL";
    return `('${o.id.replace(/'/g, "''")}', '${shop.replace(/'/g, "''")}', ${o.customerId ? `'${o.customerId.replace(/'/g, "''")}'` : "NULL"}, ${o.city ? `'${o.city.replace(/'/g, "''")}'` : "NULL"}, '${cityN.replace(/'/g, "''")}', ${lat}, ${lng}, ${o.totalAmount ?? "NULL"}, ${o.currencyCode ? `'${o.currencyCode}'` : "NULL"}, ${flId}, ${orderDate ? `'${orderDate}'::timestamp` : "NULL"}, NOW())`;
  });
  await prisma.$executeRawUnsafe(`
    INSERT INTO "RetailOrder" ("id", "shop", "customerId", "city", "cityNorm", "latitude", "longitude", "totalAmount", "currencyCode", "fulfillmentLocationId", "orderDate", "syncedAt")
    VALUES ${values.join(",\n")}
    ON CONFLICT ("id") DO UPDATE SET
      "customerId" = EXCLUDED."customerId",
      "city" = EXCLUDED."city",
      "cityNorm" = EXCLUDED."cityNorm",
      "latitude" = EXCLUDED."latitude",
      "longitude" = EXCLUDED."longitude",
      "totalAmount" = EXCLUDED."totalAmount",
      "currencyCode" = EXCLUDED."currencyCode",
      "fulfillmentLocationId" = EXCLUDED."fulfillmentLocationId",
      "orderDate" = EXCLUDED."orderDate",
      "syncedAt" = NOW()
  `);
}

export async function upsertRetailCustomers(
  shop: string,
  customers: Array<{
    id: string;
    city: string | null;
    latitude: number | null;
    longitude: number | null;
    createdAt: string | null;
  }>,
): Promise<void> {
  if (customers.length === 0) return;
  const values = customers.map((c) => {
    const lat = c.latitude != null ? roundTo(c.latitude, 4) : null;
    const lng = c.longitude != null ? roundTo(c.longitude, 4) : null;
    const cityN = normalizeCityKey(c.city);
    const custDate = c.createdAt ? new Date(c.createdAt).toISOString() : null;
    return `('${c.id.replace(/'/g, "''")}', '${shop.replace(/'/g, "''")}', ${c.city ? `'${c.city.replace(/'/g, "''")}'` : "NULL"}, '${cityN.replace(/'/g, "''")}', ${lat}, ${lng}, ${custDate ? `'${custDate}'::timestamp` : "NULL"}, NOW())`;
  });
  await prisma.$executeRawUnsafe(`
    INSERT INTO "RetailCustomer" ("id", "shop", "city", "cityNorm", "latitude", "longitude", "customerDate", "syncedAt")
    VALUES ${values.join(",\n")}
    ON CONFLICT ("id") DO UPDATE SET
      "city" = EXCLUDED."city",
      "cityNorm" = EXCLUDED."cityNorm",
      "latitude" = EXCLUDED."latitude",
      "longitude" = EXCLUDED."longitude",
      "customerDate" = EXCLUDED."customerDate",
      "syncedAt" = NOW()
  `);
}
