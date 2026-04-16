// Server-side Prisma queries for sales goals analytics.
// Pattern mirrors app/retail-footprint/analytics-queries.server.ts
// (bulk raw-SQL upsert, pre-computed monthly aggregates).

import prisma from "../db.server";
import type { SalesOrderSource } from "./classification";
import { monthKey } from "./classification";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SalesOrderRow = {
  id: string;
  source: SalesOrderSource;
  locationId: string;
  locationName: string;
  orderDate: Date;
  totalAmount: number;
  discountAmount: number;
  currencyCode: string | null;
};

export type MonthlyAggregateRow = {
  locationId: string;
  locationName: string;
  month: string;
  orderCount: number;
  revenue: number;
  totalDiscounts: number;
  currencyCode: string | null;
};

export type SyncStatus = "idle" | "syncing" | "error";

export type SyncMetaRecord = {
  status: SyncStatus;
  phase: string | null;
  progressCount: number | null;
  totalOrders: number | null;
  lastSyncedAt: string | null;
  lastOrderDate: string | null;
  errorMessage: string | null;
  startedAt: string | null;
};

const sqlEscape = (value: string): string => value.replace(/'/g, "''");

// ─── SalesOrder bulk upsert ──────────────────────────────────────────────────

/**
 * Bulk INSERT ... ON CONFLICT DO UPDATE for SalesOrder rows.
 * Single statement per batch to avoid N individual prisma.upsert calls.
 */
export async function upsertSalesOrders(
  shop: string,
  orders: SalesOrderRow[],
): Promise<void> {
  if (orders.length === 0) return;
  const shopEsc = sqlEscape(shop);
  const rows = orders.map((o) => {
    const id = sqlEscape(o.id);
    const locationId = sqlEscape(o.locationId);
    const locationName = sqlEscape(o.locationName);
    const currency = o.currencyCode ? `'${sqlEscape(o.currencyCode)}'` : "NULL";
    const orderDate = o.orderDate.toISOString();
    return `('${id}', '${shopEsc}', '${o.source}', '${locationId}', '${locationName}', '${orderDate}'::timestamp, ${o.totalAmount}, ${o.discountAmount}, ${currency}, NOW())`;
  });

  await prisma.$executeRawUnsafe(`
    INSERT INTO "SalesOrder" ("id", "shop", "source", "locationId", "locationName", "orderDate", "totalAmount", "discountAmount", "currencyCode", "syncedAt")
    VALUES ${rows.join(",\n")}
    ON CONFLICT ("id") DO UPDATE SET
      "source" = EXCLUDED."source",
      "locationId" = EXCLUDED."locationId",
      "locationName" = EXCLUDED."locationName",
      "orderDate" = EXCLUDED."orderDate",
      "totalAmount" = EXCLUDED."totalAmount",
      "discountAmount" = EXCLUDED."discountAmount",
      "currencyCode" = EXCLUDED."currencyCode",
      "syncedAt" = NOW()
  `);
}

export async function deleteSalesOrder(
  shop: string,
  orderId: string,
): Promise<void> {
  await prisma.salesOrder.deleteMany({ where: { id: orderId, shop } });
}

// ─── SalesOrderMonthly recompute ─────────────────────────────────────────────

/**
 * Recomputes the monthly aggregate for a single (shop, locationId, month)
 * bucket. Called after each upsert so the dashboard stays fresh without
 * a full re-aggregation.
 */
export async function recomputeMonthly(
  shop: string,
  locationId: string,
  month: string,
): Promise<void> {
  // month = "YYYY-MM" — compute the [start, nextMonthStart) range for a SQL scan.
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const m = Number(monthStr);
  const start = new Date(Date.UTC(year, m - 1, 1));
  const end = new Date(Date.UTC(m === 12 ? year + 1 : year, m === 12 ? 0 : m, 1));

  const rows = await prisma.salesOrder.findMany({
    where: {
      shop,
      locationId,
      orderDate: { gte: start, lt: end },
    },
    select: {
      locationName: true,
      totalAmount: true,
      discountAmount: true,
      currencyCode: true,
    },
  });

  if (rows.length === 0) {
    await prisma.salesOrderMonthly.deleteMany({
      where: { shop, locationId, month },
    });
    return;
  }

  const orderCount = rows.length;
  const revenue = rows.reduce((sum, r) => sum + r.totalAmount, 0);
  const totalDiscounts = rows.reduce((sum, r) => sum + r.discountAmount, 0);
  const locationName = rows[0].locationName;
  const currencyCode = rows[0].currencyCode;

  await prisma.salesOrderMonthly.upsert({
    where: { shop_locationId_month: { shop, locationId, month } },
    create: {
      shop,
      locationId,
      locationName,
      month,
      orderCount,
      revenue,
      totalDiscounts,
      currencyCode,
    },
    update: {
      locationName,
      orderCount,
      revenue,
      totalDiscounts,
      currencyCode,
    },
  });
}

/**
 * Recomputes every (locationId, month) pair for a shop from scratch.
 * Used after a full backfill.
 */
export async function recomputeAllMonthly(shop: string): Promise<number> {
  // Aggregate in one SQL query, then upsert results.
  const buckets = await prisma.$queryRaw<
    {
      locationId: string;
      locationName: string;
      month: string;
      orderCount: bigint;
      revenue: number;
      totalDiscounts: number;
      currencyCode: string | null;
    }[]
  >`
    SELECT
      "locationId",
      MAX("locationName") AS "locationName",
      TO_CHAR("orderDate", 'YYYY-MM') AS "month",
      COUNT(*)::bigint AS "orderCount",
      SUM("totalAmount")::float AS "revenue",
      SUM("discountAmount")::float AS "totalDiscounts",
      MAX("currencyCode") AS "currencyCode"
    FROM "SalesOrder"
    WHERE "shop" = ${shop}
    GROUP BY "locationId", TO_CHAR("orderDate", 'YYYY-MM')
  `;

  // Wipe and reinsert: safer than diffing — the aggregate is derived data.
  await prisma.salesOrderMonthly.deleteMany({ where: { shop } });

  if (buckets.length === 0) return 0;

  await prisma.$transaction(
    buckets.map((b) =>
      prisma.salesOrderMonthly.create({
        data: {
          shop,
          locationId: b.locationId,
          locationName: b.locationName,
          month: b.month,
          orderCount: Number(b.orderCount),
          revenue: b.revenue,
          totalDiscounts: b.totalDiscounts ?? 0,
          currencyCode: b.currencyCode,
        },
      }),
    ),
  );

  return buckets.length;
}

// ─── Dashboard queries ───────────────────────────────────────────────────────

/**
 * Returns all monthly aggregate rows for a shop in the given month range,
 * optionally filtered to a set of location IDs. Ordered by location, month.
 */
export async function queryMonthlyAggregates(
  shop: string,
  months: string[],
  locationIds?: string[],
): Promise<MonthlyAggregateRow[]> {
  const where: Record<string, unknown> = {
    shop,
    month: { in: months },
  };
  if (locationIds && locationIds.length > 0) {
    where.locationId = { in: locationIds };
  }

  const rows = await prisma.salesOrderMonthly.findMany({
    where,
    orderBy: [{ locationId: "asc" }, { month: "asc" }],
    select: {
      locationId: true,
      locationName: true,
      month: true,
      orderCount: true,
      revenue: true,
      totalDiscounts: true,
      currencyCode: true,
    },
  });
  return rows;
}

// ─── SalesGoalsSyncMeta ──────────────────────────────────────────────────────

export async function readSyncMeta(shop: string): Promise<SyncMetaRecord> {
  const row = await prisma.salesGoalsSyncMeta.findUnique({ where: { shop } });
  if (!row) {
    return {
      status: "idle",
      phase: null,
      progressCount: null,
      totalOrders: null,
      lastSyncedAt: null,
      lastOrderDate: null,
      errorMessage: null,
      startedAt: null,
    };
  }
  return {
    status: row.status as SyncStatus,
    phase: row.phase,
    progressCount: row.progressCount,
    totalOrders: row.totalOrders,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastOrderDate: row.lastOrderDate?.toISOString() ?? null,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt?.toISOString() ?? null,
  };
}

export async function writeSyncStarted(shop: string): Promise<void> {
  const now = new Date();
  await prisma.salesGoalsSyncMeta.upsert({
    where: { shop },
    create: {
      shop,
      status: "syncing",
      phase: "fetching",
      progressCount: 0,
      startedAt: now,
      errorMessage: null,
    },
    update: {
      status: "syncing",
      phase: "fetching",
      progressCount: 0,
      startedAt: now,
      errorMessage: null,
    },
  });
}

export async function writeSyncProgress(
  shop: string,
  phase: string,
  progressCount: number,
): Promise<void> {
  await prisma.salesGoalsSyncMeta.upsert({
    where: { shop },
    create: {
      shop,
      status: "syncing",
      phase,
      progressCount,
    },
    update: { phase, progressCount },
  });
}

export async function writeSyncFinished(
  shop: string,
  totalOrders: number,
  lastOrderDate: Date | null,
): Promise<void> {
  const now = new Date();
  await prisma.salesGoalsSyncMeta.upsert({
    where: { shop },
    create: {
      shop,
      status: "idle",
      phase: null,
      progressCount: null,
      totalOrders,
      lastSyncedAt: now,
      lastOrderDate,
      errorMessage: null,
    },
    update: {
      status: "idle",
      phase: null,
      progressCount: null,
      totalOrders,
      lastSyncedAt: now,
      lastOrderDate,
      errorMessage: null,
    },
  });
}

export async function writeSyncError(
  shop: string,
  errorMessage: string,
): Promise<void> {
  await prisma.salesGoalsSyncMeta.upsert({
    where: { shop },
    create: {
      shop,
      status: "error",
      errorMessage,
    },
    update: {
      status: "error",
      errorMessage,
    },
  });
}

// ─── Utilities ───────────────────────────────────────────────────────────────

/** Builds the month list (YYYY-MM strings) from `monthsBack` ago to now. */
export function buildMonthRange(monthsBack: number): string[] {
  const result: string[] = [];
  const now = new Date();
  for (let i = monthsBack; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push(monthKey(d));
  }
  return result;
}

// ─── Month projections ───────────────────────────────────────────────────────

export type MonthProjection = {
  linear: number | null;
  yoy: number | null;
  isProjection: boolean; // true when elapsed < total (current or future month)
};

const addMonthsKey = (month: string, delta: number): string => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKey(d);
};

const daysInMonth = (year: number, month1Based: number): number =>
  new Date(year, month1Based, 0).getDate();

/** Compute linear + DOW-aware YoY projection for a single (location, month) pair. */
const computeOne = (
  current: Map<number, number>,
  y1: Map<number, number>,
  monthStr: string,
  today: Date,
): MonthProjection => {
  const [year, month] = monthStr.split("-").map(Number);
  const totalDays = daysInMonth(year, month);
  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonthExclusive = new Date(year, month, 1);

  // Past month: elapsed == total, linear == yoy == actual sum
  // Current month: elapsed == today.day
  // Future month: nothing yet — return nulls
  let elapsedDays: number;
  let isProjection: boolean;
  if (today >= endOfMonthExclusive) {
    elapsedDays = totalDays;
    isProjection = false;
  } else if (today < startOfMonth) {
    return { linear: null, yoy: null, isProjection: true };
  } else {
    elapsedDays = today.getDate();
    isProjection = elapsedDays < totalDays;
  }

  let salesSoFar = 0;
  for (let d = 1; d <= elapsedDays; d++) salesSoFar += current.get(d) ?? 0;

  if (elapsedDays === 0) {
    return { linear: 0, yoy: 0, isProjection };
  }
  if (!isProjection) {
    return { linear: salesSoFar, yoy: salesSoFar, isProjection: false };
  }

  const linear = (salesSoFar * totalDays) / elapsedDays;

  // DOW-aware YoY (day-of-week pattern from same-month-last-year)
  const y1Year = year - 1;
  const y1TotalDays = daysInMonth(y1Year, month);
  const dowRev = [0, 0, 0, 0, 0, 0, 0];
  const dowCount = [0, 0, 0, 0, 0, 0, 0];
  for (let d = 1; d <= y1TotalDays; d++) {
    const dow = new Date(y1Year, month - 1, d).getDay();
    dowRev[dow] += y1.get(d) ?? 0;
    dowCount[dow] += 1;
  }
  const dowAvg = dowRev.map((r, i) => (dowCount[i] > 0 ? r / dowCount[i] : 0));
  const anyY1 = dowAvg.some((v) => v > 0);

  if (!anyY1) return { linear, yoy: null, isProjection };

  let expectedElapsed = 0;
  let expectedTotal = 0;
  for (let d = 1; d <= totalDays; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    const v = dowAvg[dow];
    expectedTotal += v;
    if (d <= elapsedDays) expectedElapsed += v;
  }
  if (expectedElapsed === 0) return { linear, yoy: null, isProjection };

  const yoy = salesSoFar * (expectedTotal / expectedElapsed);
  return { linear, yoy, isProjection };
};

/**
 * Compute linear + DOW-aware YoY projections for every (location, month) pair.
 * Returns `Record<locationId, Record<month, MonthProjection>>`.
 */
export async function computeMonthProjections(
  shop: string,
  locationIds: string[],
  months: string[],
  today: Date = new Date(),
): Promise<Record<string, Record<string, MonthProjection>>> {
  const result: Record<string, Record<string, MonthProjection>> = {};
  if (locationIds.length === 0 || months.length === 0) return result;

  // Compute date window covering both current months and their y-1 counterparts
  const y1Months = months.map((m) => addMonthsKey(m, -12));
  const allMonths = Array.from(new Set([...months, ...y1Months])).sort();
  const minMonth = allMonths[0];
  const maxMonth = allMonths[allMonths.length - 1];
  const [minY, minM] = minMonth.split("-").map(Number);
  const [maxY, maxM] = maxMonth.split("-").map(Number);
  const startDate = new Date(minY, minM - 1, 1);
  const endDate = new Date(maxY, maxM, 1); // first of next month

  const rows = await prisma.$queryRawUnsafe<
    Array<{ locationId: string; day: Date; revenue: number }>
  >(
    `SELECT "locationId", DATE("orderDate") AS day, SUM("totalAmount")::float AS revenue
     FROM "SalesOrder"
     WHERE "shop" = $1 AND "locationId" = ANY($2::text[])
       AND "orderDate" >= $3 AND "orderDate" < $4
     GROUP BY "locationId", DATE("orderDate")`,
    shop,
    locationIds,
    startDate,
    endDate,
  );

  // Bucket by (locationId, YYYY-MM, dayOfMonth)
  const dailyByLocMonth = new Map<string, Map<string, Map<number, number>>>();
  for (const r of rows) {
    const d = new Date(r.day);
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const day = d.getDate();
    if (!dailyByLocMonth.has(r.locationId))
      dailyByLocMonth.set(r.locationId, new Map());
    const locMap = dailyByLocMonth.get(r.locationId)!;
    if (!locMap.has(mk)) locMap.set(mk, new Map());
    locMap.get(mk)!.set(day, r.revenue);
  }

  for (const locId of locationIds) {
    result[locId] = {};
    const locMap = dailyByLocMonth.get(locId) ?? new Map();
    for (const month of months) {
      const current = (locMap.get(month) ?? new Map()) as Map<number, number>;
      const y1 = (locMap.get(addMonthsKey(month, -12)) ?? new Map()) as Map<
        number,
        number
      >;
      result[locId][month] = computeOne(current, y1, month, today);
    }
  }
  return result;
}

// Dashboard pure helpers live in `analytics-pure.ts` so client components can
// import them without pulling Prisma into the browser bundle.
export {
  buildLocationSnapshots,
  aggregateSnapshots,
  sameStoreYoY,
  bestVsWorst,
  discountRate,
  SAME_STORE_ZERO_DAYS_THRESHOLD,
  type LocationSnapshot,
  type AggregateKpi,
  type BuildSnapshotInput,
} from "./analytics-pure";

// ─── Zero-day counting (for Same-Store YoY exclusion) ───────────────────────

/**
 * Counts zero-revenue days per (locationId, month) across the given months.
 * For the current month, counts zero days only within the elapsed window
 * (days 1..today). For past months, counts across the full month.
 *
 * Used by the Same-Store YoY KPI to exclude locations that were closed
 * (≥ SAME_STORE_ZERO_DAYS_THRESHOLD zero days) in either period.
 */
export async function countZeroRevenueDays(
  shop: string,
  locationIds: string[],
  months: string[],
  today: Date = new Date(),
): Promise<Record<string, Record<string, number>>> {
  const result: Record<string, Record<string, number>> = {};
  if (locationIds.length === 0 || months.length === 0) return result;

  // Date window covering all requested months.
  const sorted = [...months].sort();
  const [minY, minM] = sorted[0].split("-").map(Number);
  const [maxY, maxM] = sorted[sorted.length - 1].split("-").map(Number);
  const startDate = new Date(minY, minM - 1, 1);
  const endDate = new Date(maxY, maxM, 1); // first of next month

  const rows = await prisma.$queryRawUnsafe<
    Array<{ locationId: string; day: Date }>
  >(
    `SELECT DISTINCT "locationId", DATE("orderDate") AS day
     FROM "SalesOrder"
     WHERE "shop" = $1 AND "locationId" = ANY($2::text[])
       AND "orderDate" >= $3 AND "orderDate" < $4
       AND "totalAmount" > 0`,
    shop,
    locationIds,
    startDate,
    endDate,
  );

  // Bucket non-zero days per (locationId, YYYY-MM).
  const nonZeroDaysByLocMonth = new Map<string, Set<string>>();
  for (const r of rows) {
    const d = new Date(r.day);
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const key = `${r.locationId}__${mk}`;
    if (!nonZeroDaysByLocMonth.has(key))
      nonZeroDaysByLocMonth.set(key, new Set());
    nonZeroDaysByLocMonth.get(key)!.add(String(d.getDate()));
  }

  const todayY = today.getFullYear();
  const todayM = today.getMonth() + 1;
  const todayD = today.getDate();

  for (const locId of locationIds) {
    result[locId] = {};
    for (const month of months) {
      const [year, m] = month.split("-").map(Number);
      const totalDaysInMonth = new Date(year, m, 0).getDate();
      const isCurrent = year === todayY && m === todayM;
      const isFuture =
        year > todayY || (year === todayY && m > todayM);
      if (isFuture) {
        result[locId][month] = 0;
        continue;
      }
      const elapsedDays = isCurrent ? todayD : totalDaysInMonth;
      const nonZeroSet =
        nonZeroDaysByLocMonth.get(`${locId}__${month}`) ?? new Set<string>();
      // Count elapsed days that are NOT in the non-zero set.
      let zeroDays = 0;
      for (let d = 1; d <= elapsedDays; d += 1) {
        if (!nonZeroSet.has(String(d))) zeroDays += 1;
      }
      result[locId][month] = zeroDays;
    }
  }

  return result;
}
