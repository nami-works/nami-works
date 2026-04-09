import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

/**
 * Cron endpoint for weekly retail analytics refresh.
 * Schedule (e.g. every Sunday night) to call:
 *   GET /api/cron/retail-analytics
 *   Header: X-Cron-Secret: <CRON_SECRET>
 * Or: GET /api/cron/retail-analytics?secret=<CRON_SECRET>
 *
 * Set CRON_SECRET in env. If unset, endpoint returns 401.
 * Analytics backfill currently runs when merchants open the Retail expansion
 * page (first load). For a fully automated weekly refresh across all shops,
 * implement a worker that loads sessions from the DB and runs the same
 * backfill (fetchAllCustomers, fetchAllOrders, writeAnalyticsCache) per shop.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const secret =
    request.headers.get("X-Cron-Secret") ??
    new URL(request.url).searchParams.get("secret");
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected || secret !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const [locationSetShops, currentShops] = await Promise.all([
    prisma.retailLocationSet.findMany({ select: { shop: true }, distinct: ["shop"] }),
    prisma.retailCurrentLocations.findMany({ select: { shop: true } }),
  ]);
  const shops = new Set([
    ...locationSetShops.map((r) => r.shop),
    ...currentShops.map((r) => r.shop),
  ]);

  console.info(`[retail-analytics-cron] triggered shops=${shops.size}`);

  return new Response(
    JSON.stringify({
      ok: true,
      shops: shops.size,
      message:
        "Weekly retail analytics cron. Backfill runs when merchants open Retail expansion (first load). For full auto-refresh, implement a worker that uses session storage to run backfill per shop.",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
};
