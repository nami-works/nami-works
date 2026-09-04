// The other half of the 72h hold (Lucas, 2026-09-01): orders/paid only
// decides the arm and writes a pending_hold row; this sweep is what
// actually calls Shopify once holdUntil has elapsed. Run on an interval
// from server.ts — connector has no separate cron/worker process, and a
// single long-lived Fastify instance polling its own DB is the lowest-new-
// surface-area way to add a delayed job here (no new HTTP route, no
// crontab/SSH change).
import { getShopifyClient } from "../clients/shopify.js";
import { prisma } from "../db/prisma.js";
import { issuePendingCredit, type WebhookLog } from "./just-bought-credit.js";

export async function processPendingCreditIssuances(log: WebhookLog): Promise<void> {
  const due = await prisma.justBoughtCreditIssuance.findMany({
    where: { status: "pending_hold", holdUntil: { lte: new Date() } },
  });
  if (due.length === 0) return;

  log.info({ count: due.length }, "process-pending-credit: sweep found due rows");

  // Group by tenant so each tenant's Shopify client is fetched once, not
  // once per row — matches the per-tenant credential model everywhere else
  // in this app (single-tenant gebeauty today, but not hardcoded to it).
  const byTenant = new Map<string, typeof due>();
  for (const row of due) {
    const list = byTenant.get(row.tenantId) ?? [];
    list.push(row);
    byTenant.set(row.tenantId, list);
  }

  for (const [tenantId, rows] of byTenant) {
    const tenant = await prisma.integrationTenant.findUnique({ where: { id: tenantId } });
    if (!tenant || tenant.status !== "active" || !tenant.shopifyShop) {
      log.error({ tenantId }, "process-pending-credit: tenant inactive/missing, skipping its due rows");
      continue;
    }
    const client = await getShopifyClient({ ssmPrefix: tenant.ssmPrefix, shopifyShop: tenant.shopifyShop });

    for (const row of rows) {
      try {
        await issuePendingCredit(row, client, log);
      } catch (err) {
        // One bad row must not block the rest of the sweep — it stays
        // pending_hold and gets retried on the next interval tick.
        log.error({ orderGid: row.shopifyOrderId, err }, "process-pending-credit: issuance failed, will retry next sweep");
      }
    }
  }
}
