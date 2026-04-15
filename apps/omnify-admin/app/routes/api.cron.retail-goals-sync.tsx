import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

/**
 * Cron endpoint placeholder for sales-goals gap-repair.
 *
 * Auth: `X-Cron-Secret` header or `?secret=` query must match `CRON_SECRET`.
 *
 * Webhooks keep `SalesOrder` fresh in real time; this cron exists so a
 * future worker can re-run the backfill per shop (session-aware) and catch
 * any gaps from webhook misses. Today it just reports known shops.
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

  const rows = await prisma.salesGoalsSyncMeta.findMany({
    select: { shop: true, status: true, lastSyncedAt: true, totalOrders: true },
  });

  console.info(`[sales-goals-cron] triggered shops=${rows.length}`);

  return new Response(
    JSON.stringify({
      ok: true,
      shops: rows.length,
      meta: rows,
      message:
        "Sales-goals gap-repair cron. Backfill runs when merchants click 'Sync now' in the Sales Goals UI (session-aware). For full auto-refresh, implement a session-loading worker like retail-analytics.",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
};
