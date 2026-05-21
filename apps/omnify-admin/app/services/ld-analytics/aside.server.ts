/**
 * LD Analytics aside block — server-side data compute.
 *
 * Surfaces the headline savings number on the operational LD page sidebar.
 * Mirrors the 7-state matrix from inputs/mockups/local-delivery-analytics-aside-v1.html.
 * See docs/plans/local-delivery-analytics-aside.md §5.
 *
 * Public surface:
 *   - computeAsideData(shop) → AsideData (the loader-side payload)
 *   - getSparklineWeekly(shop, weeks) → 12 weekly buckets, 1h in-process cache
 *   - computeMomPercent(rows, framing) → MoM % over last 30 vs prior 30 days
 *
 * Logging prefix: `[ld-analytics:aside:*]`.
 * No PII, no credential values.
 */

import prisma from "../../db.server";
import {
  computeSpeculativeTeaser,
  getHeadlineMetrics,
  periodToRange,
  type HeadlineMetrics,
} from "./queries.server";
import { frame, type Framing } from "./pl-math.server";
import { getActiveCredentialForShop } from "../warehouse-carrier/aggregator.server";
import { IntelipostAdapter } from "../warehouse-carrier/adapters/intelipost.server";

// ────────────────────────────────────────────────────────────
//  Types
// ────────────────────────────────────────────────────────────

export type WeeklyPoint = {
  /** ISO date string of the Sunday that starts the week (UTC). */
  week: string;
  /** Framed value for that week (subunits, can be negative). */
  valueSubunits: number;
};

type FullKindFields = {
  total: number;
  momPercent: number;
  sparkline: WeeklyPoint[];
  currency: string;
  framing: string;
  isNew: boolean;
};

export type AsideData =
  | { kind: "hidden" }
  | {
      kind: "provocation";
      estimatedMonthlySavings: number;
      currency: string;
    }
  | { kind: "conservative_empty" }
  | ({ kind: "stale"; staleAgeHours: number; coveragePercent: number } & FullKindFields)
  | ({ kind: "full" } & FullKindFields);

// ────────────────────────────────────────────────────────────
//  Sparkline cache (in-process, per-shop, 1h TTL)
// ────────────────────────────────────────────────────────────

type CacheEntry = { fetchedAt: number; data: WeeklyPoint[] };
const sparklineCache = new Map<string, CacheEntry>();
const SPARKLINE_TTL_MS = 60 * 60 * 1000; // 1h

/** Visible to tests: clear cache between cases. */
export function _clearSparklineCacheForTests(): void {
  sparklineCache.clear();
}

// ────────────────────────────────────────────────────────────
//  Date helpers (pure, exported for testing)
// ────────────────────────────────────────────────────────────

/** UTC start-of-day. */
export function startOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Returns the UTC date of the Sunday that begins the week containing `d`.
 * Sunday-based to match the mockup's "week start" convention.
 */
export function startOfWeekSunday(d: Date): Date {
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const sunday = new Date(d);
  sunday.setUTCDate(d.getUTCDate() - day);
  return startOfDayUtc(sunday);
}

/** Subtract `weeks` weeks (7d each) from a date, returning a new Date. */
export function subWeeks(d: Date, weeks: number): Date {
  return new Date(d.getTime() - weeks * 7 * 24 * 60 * 60 * 1000);
}

// ────────────────────────────────────────────────────────────
//  Sparkline grouping (pure, exported for testing)
// ────────────────────────────────────────────────────────────

type DailyRow = {
  date: Date;
  ldRevenueSubunits: number;
  ldCarrierCostSubunits: number;
  warehouseCounterfactualSubunits: number;
  warehouseCustomerRateSubunits: number;
  taxSavingsSubunits: number;
};

/**
 * Group daily rows into N weekly buckets (Sunday-to-Saturday), framed per
 * the merchant's headline framing. Empty buckets emit a zero-value point
 * so the polyline's x-axis stays time-uniform.
 */
export function groupDailyToWeekly(
  rows: ReadonlyArray<DailyRow>,
  framing: Framing,
  weekStarts: ReadonlyArray<Date>,
): WeeklyPoint[] {
  const buckets = new Map<string, DailyRow[]>();
  for (const ws of weekStarts) {
    buckets.set(ws.toISOString(), []);
  }
  for (const row of rows) {
    const wk = startOfWeekSunday(row.date).toISOString();
    const arr = buckets.get(wk);
    if (arr) arr.push(row);
    // Rows outside the requested window are silently dropped.
  }
  const out: WeeklyPoint[] = [];
  for (const ws of weekStarts) {
    const list = buckets.get(ws.toISOString()) ?? [];
    const summed = list.reduce(
      (acc, r) => ({
        ldRevenueSubunits: acc.ldRevenueSubunits + r.ldRevenueSubunits,
        ldCarrierCostSubunits: acc.ldCarrierCostSubunits + r.ldCarrierCostSubunits,
        warehouseCounterfactualSubunits:
          acc.warehouseCounterfactualSubunits + r.warehouseCounterfactualSubunits,
        warehouseCustomerRateSubunits:
          acc.warehouseCustomerRateSubunits + r.warehouseCustomerRateSubunits,
        taxSavingsSubunits: acc.taxSavingsSubunits + r.taxSavingsSubunits,
      }),
      {
        ldRevenueSubunits: 0,
        ldCarrierCostSubunits: 0,
        warehouseCounterfactualSubunits: 0,
        warehouseCustomerRateSubunits: 0,
        taxSavingsSubunits: 0,
      },
    );
    out.push({
      week: ws.toISOString(),
      valueSubunits: frame(framing, summed),
    });
  }
  return out;
}

/**
 * Returns the last `weeks` weekly buckets (oldest-first) of framed values.
 * Caches per-shop in-process for 1h.
 */
export async function getSparklineWeekly(
  shop: string,
  weeks: number,
  framing: Framing,
  now: Date = new Date(),
): Promise<WeeklyPoint[]> {
  const cacheKey = `${shop}|${framing}|${weeks}`;
  const hit = sparklineCache.get(cacheKey);
  if (hit && Date.now() - hit.fetchedAt < SPARKLINE_TTL_MS) {
    console.info(`[ld-analytics:aside:cache] sparkline cache hit shop=${shop}`);
    return hit.data;
  }

  const t0 = Date.now();
  const earliestWeekStart = startOfWeekSunday(subWeeks(now, weeks - 1));
  const rows = await prisma.ldAnalyticsDaily.findMany({
    where: { shop, date: { gte: earliestWeekStart } },
    select: {
      date: true,
      ldRevenueSubunits: true,
      ldCarrierCostSubunits: true,
      warehouseCounterfactualSubunits: true,
      warehouseCustomerRateSubunits: true,
      taxSavingsSubunits: true,
    },
  });

  const weekStarts: Date[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    weekStarts.push(startOfWeekSunday(subWeeks(now, i)));
  }
  const data = groupDailyToWeekly(rows, framing, weekStarts);

  sparklineCache.set(cacheKey, { fetchedAt: Date.now(), data });
  console.info(
    `[ld-analytics:aside:cache] sparkline cache miss shop=${shop} weeks=${weeks} durationMs=${Date.now() - t0}`,
  );
  return data;
}

// ────────────────────────────────────────────────────────────
//  MoM % (pure, exported for testing)
// ────────────────────────────────────────────────────────────

/**
 * Month-over-month percentage delta of the framed value.
 * Last-30-days total vs prior-30-days total, expressed as % of the prior window.
 *
 * Returns 0 if both windows are empty or the prior window is exactly zero.
 * Caller decides ▲ vs ▼ vs — via the ±2% threshold (CLAUDE.md status colors).
 */
export function computeMomPercent(
  rows: ReadonlyArray<DailyRow>,
  framing: Framing,
  now: Date = new Date(),
): number {
  const last30Start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const prior30Start = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  const sum = (subset: ReadonlyArray<DailyRow>) => {
    const totals = subset.reduce(
      (acc, r) => ({
        ldRevenueSubunits: acc.ldRevenueSubunits + r.ldRevenueSubunits,
        ldCarrierCostSubunits: acc.ldCarrierCostSubunits + r.ldCarrierCostSubunits,
        warehouseCounterfactualSubunits:
          acc.warehouseCounterfactualSubunits + r.warehouseCounterfactualSubunits,
        warehouseCustomerRateSubunits:
          acc.warehouseCustomerRateSubunits + r.warehouseCustomerRateSubunits,
        taxSavingsSubunits: acc.taxSavingsSubunits + r.taxSavingsSubunits,
      }),
      {
        ldRevenueSubunits: 0,
        ldCarrierCostSubunits: 0,
        warehouseCounterfactualSubunits: 0,
        warehouseCustomerRateSubunits: 0,
        taxSavingsSubunits: 0,
      },
    );
    return frame(framing, totals);
  };

  const last30 = sum(rows.filter((r) => r.date >= last30Start && r.date <= now));
  const prior30 = sum(rows.filter((r) => r.date >= prior30Start && r.date < last30Start));

  if (prior30 === 0) return 0;
  const pct = ((last30 - prior30) / Math.abs(prior30)) * 100;
  if (!Number.isFinite(pct)) return 0;
  return Math.round(pct);
}

// ────────────────────────────────────────────────────────────
//  Headline conversion — HeadlineMetrics → framed total
// ────────────────────────────────────────────────────────────

function framedHeadline(headline: HeadlineMetrics, framing: string): number {
  switch (framing) {
    case "revenue_retained":
      return headline.revenueRetained;
    case "net_cost_delta":
      // Convention on the aside: positive number = saving. net_cost_delta is
      // negative when LD saves money, so we flip the sign for display.
      // ASSUMPTION: per mockup state #2 the value reads "+R$ 8,290" (positive
      // = saving). Spec §6 says "show as positive savings number when delta
      // is negative". We invert here so all aside states share the same
      // sign convention. Full analytics panel keeps its own signed display.
      return -headline.netCostDelta;
    case "pl_impact":
    default:
      return headline.plImpact;
  }
}

// ────────────────────────────────────────────────────────────
//  Stale / rollup-age helpers
// ────────────────────────────────────────────────────────────

const STALE_WARNING_MS = 36 * 60 * 60 * 1000; // > 36h → stale
const STALE_DROP_MS = 72 * 60 * 60 * 1000; // > 72h → drop to conservative

async function getLastRollupAt(shop: string): Promise<Date | null> {
  const latest = await prisma.ldAnalyticsDaily.findFirst({
    where: { shop },
    orderBy: { computedAt: "desc" },
    select: { computedAt: true },
  });
  return latest?.computedAt ?? null;
}

async function hasAnyRollupRow(shop: string): Promise<boolean> {
  const count = await prisma.ldAnalyticsDaily.count({ where: { shop } });
  return count > 0;
}

// ────────────────────────────────────────────────────────────
//  Main compute fn
// ────────────────────────────────────────────────────────────

/**
 * Compute the aside payload for one shop.
 *
 * Decision tree (mirrors mockup state matrix):
 *   - config.enabled === false             → "hidden"
 *   - no rollup data + no carrier + speculative supported + teaser available
 *                                          → "provocation"
 *   - no rollup data                       → "conservative_empty"
 *   - rollup data, last computedAt > 72h   → "conservative_empty"
 *   - rollup data, last computedAt > 36h   → "stale"
 *   - rollup data, fresh                   → "full"
 */
export async function computeAsideData(
  shop: string,
  now: Date = new Date(),
): Promise<AsideData> {
  console.info(`[ld-analytics:aside:loader] aside load START shop=${shop}`);
  const t0 = Date.now();

  const config = await prisma.ldAnalyticsConfig.findUnique({ where: { shop } });
  if (!config?.enabled) {
    console.info(
      `[ld-analytics:aside:loader] aside load OK shop=${shop} kind=hidden elapsed=${Date.now() - t0}ms`,
    );
    return { kind: "hidden" };
  }

  const framing = (config.headlineFraming ?? "net_cost_delta") as Framing;
  const credential = await getActiveCredentialForShop(shop);
  const hasRollup = await hasAnyRollupRow(shop);

  if (!hasRollup) {
    // No rolled-up data yet. Try the speculative teaser path (state #3).
    if (!credential && IntelipostAdapter.supportsSpeculativeQuoting) {
      const teaser = await computeSpeculativeTeaser(shop, periodToRange("90d", now));
      if (teaser && teaser.amountSubunits > 0) {
        console.info(
          `[ld-analytics:aside:loader] aside load OK shop=${shop} kind=provocation elapsed=${Date.now() - t0}ms`,
        );
        return {
          kind: "provocation",
          estimatedMonthlySavings: teaser.amountSubunits,
          currency: teaser.currency,
        };
      }
    }
    console.info(
      `[ld-analytics:aside:loader] aside load OK shop=${shop} kind=conservative_empty elapsed=${Date.now() - t0}ms`,
    );
    return { kind: "conservative_empty" };
  }

  // Full data path.
  const range = periodToRange("90d", now);
  const headline = await getHeadlineMetrics(shop, range);
  const sparkline = await getSparklineWeekly(shop, 12, framing, now);

  // MoM % — pull a 60-day window of rows for the comparison.
  const momWindowStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const momRows = await prisma.ldAnalyticsDaily.findMany({
    where: { shop, date: { gte: momWindowStart } },
    select: {
      date: true,
      ldRevenueSubunits: true,
      ldCarrierCostSubunits: true,
      warehouseCounterfactualSubunits: true,
      warehouseCustomerRateSubunits: true,
      taxSavingsSubunits: true,
    },
  });
  // For net_cost_delta the aside flips the sign for display — flip the MoM
  // too so a falling cost reads as a positive trend.
  const rawMom = computeMomPercent(momRows, framing, now);
  const momPercent = framing === "net_cost_delta" ? -rawMom : rawMom;

  // First-seen pill timestamp — idempotent, swallow failures so a bad write
  // never breaks the render path.
  let asideFirstSeenAt = config.asideFirstSeenAt;
  if (!asideFirstSeenAt) {
    try {
      const updated = await prisma.ldAnalyticsConfig.update({
        where: { shop },
        data: { asideFirstSeenAt: now },
        select: { asideFirstSeenAt: true },
      });
      asideFirstSeenAt = updated.asideFirstSeenAt;
      console.info(`[ld-analytics:aside:newpill] firstSeen recorded shop=${shop}`);
    } catch (err) {
      console.warn(
        `[ld-analytics:aside:newpill] firstSeen write FAILED shop=${shop} reason=${(err as Error)?.message ?? "?"}`,
      );
    }
  }
  const isNew = asideFirstSeenAt
    ? now.getTime() - new Date(asideFirstSeenAt).getTime() < 14 * 24 * 60 * 60 * 1000
    : true;

  const total = framedHeadline(headline, framing);
  const currency = headline.currencyCode;

  // Stale check — based on the most recent computedAt across the rollup table.
  const lastRollupAt = await getLastRollupAt(shop);
  const lastRollupMs = lastRollupAt
    ? now.getTime() - lastRollupAt.getTime()
    : Number.POSITIVE_INFINITY;

  if (lastRollupMs > STALE_DROP_MS) {
    console.info(
      `[ld-analytics:aside:loader] aside load OK shop=${shop} kind=conservative_empty reason=stale_drop elapsed=${Date.now() - t0}ms`,
    );
    return { kind: "conservative_empty" };
  }
  if (lastRollupMs > STALE_WARNING_MS) {
    console.info(
      `[ld-analytics:aside:loader] aside load OK shop=${shop} kind=stale elapsed=${Date.now() - t0}ms`,
    );
    return {
      kind: "stale",
      total,
      momPercent,
      sparkline,
      currency,
      framing,
      isNew,
      staleAgeHours: Math.round(lastRollupMs / (60 * 60 * 1000)),
      coveragePercent: headline.coveragePercent,
    };
  }

  console.info(
    `[ld-analytics:aside:loader] aside load OK shop=${shop} kind=full elapsed=${Date.now() - t0}ms`,
  );
  return {
    kind: "full",
    total,
    momPercent,
    sparkline,
    currency,
    framing,
    isNew,
  };
}
