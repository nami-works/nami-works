/**
 * Daily Local Delivery Analytics rollup cron.
 *
 * For each shop where `LdAnalyticsConfig.enabled = true`:
 *   1. Build LdAnalyticsDaily rows for yesterday (UTC midnight day-bucket).
 *   2. Idempotent (upsert keyed on (shop, cityNorm, date)) — safe to retry.
 *
 * Auth: `X-Cron-Secret` header or `?secret=` query, matched against
 * CRON_SECRET env. Same pattern as the other cron routes in this app.
 *
 * Schedule: EventBridge `cron(0 4 * * ? *)` — daily 04:00 UTC (01:00 BRT).
 *
 * See docs/plans/local-delivery-analytics.md §7.
 */

import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { rollupShop, startOfDayUtc } from "../services/ld-analytics/rollup.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const secret =
    request.headers.get("X-Cron-Secret") ?? url.searchParams.get("secret");
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected || secret !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const startedAt = Date.now();
  const shops = await prisma.ldAnalyticsConfig.findMany({
    where: { enabled: true },
    select: { shop: true },
  });
  console.info(`[ld-analytics:cron] rollup START shops=${shops.length}`);

  const today = startOfDayUtc(new Date());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  const results: Array<{
    shop: string;
    cities: number;
    orders: number;
    coveragePercent: number;
    durationMs: number;
    error?: string;
  }> = [];

  for (const { shop } of shops) {
    try {
      const r = await rollupShop(shop, yesterday);
      results.push({
        shop: r.shop,
        cities: r.cities,
        orders: r.orders,
        coveragePercent: r.coveragePercent,
        durationMs: r.durationMs,
      });
      console.info(
        `[ld-analytics:cron] rollup OK shop=${shop} cities=${r.cities} orders=${r.orders} coverage=${r.coveragePercent}% durationMs=${r.durationMs}`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      results.push({ shop, cities: 0, orders: 0, coveragePercent: 0, durationMs: 0, error: msg });
      console.error(`[ld-analytics:cron] rollup FAILED shop=${shop}`, error);
    }
  }

  const elapsed = Date.now() - startedAt;
  console.info(
    `[ld-analytics:cron] rollup OK shops=${shops.length} elapsed=${elapsed}ms`,
  );
  return new Response(JSON.stringify({ ok: true, results, elapsed }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

// POST is also accepted (some scheduled job runners only POST). Same handler.
export const action = loader;
