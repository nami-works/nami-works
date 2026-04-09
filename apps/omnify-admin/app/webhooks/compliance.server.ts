import prisma from "../db.server";
import { normalizeWebhookTopic } from "../webhooks.server";
import {
  writeLocations,
  writeLocationSets,
} from "../retail-footprint/storage.server";
import { getAppIdentity } from "../utils/app-identity.server";

type CompliancePayload = {
  customer?: { id?: string | number };
  orders_to_redact?: Array<string | number>;
};

export const handleComplianceWebhook = async (
  topic: string,
  shop: string,
  payload: CompliancePayload,
): Promise<boolean> => {
  const normalizedTopic = normalizeWebhookTopic(topic);
  const identity = getAppIdentity();

  if (normalizedTopic === "CUSTOMERS_DATA_REQUEST") {
    console.info(`[compliance] customers_data_request received shop=${shop}`);
    return true;
  }

  if (normalizedTopic === "CUSTOMERS_REDACT") {
    console.info(`[compliance] customers_redact START shop=${shop} identity=${identity}`);
    if (identity === "cpg-labs" || identity === "omnify") {
      const customerId = payload?.customer?.id
        ? String(payload.customer.id)
        : null;
      const ordersToRedact = Array.isArray(payload?.orders_to_redact)
        ? payload.orders_to_redact.map((id) => String(id))
        : [];

      if (customerId) {
        await prisma.retailCustomer.deleteMany({ where: { id: customerId, shop } });
        await prisma.retailOrder.deleteMany({ where: { customerId, shop } });
        console.info(`[compliance] customers_redact removed customer+order records shop=${shop} customerId=${customerId}`);
      }
      if (ordersToRedact.length > 0) {
        await prisma.retailOrder.deleteMany({ where: { id: { in: ordersToRedact }, shop } });
        console.info(`[compliance] customers_redact removed order records shop=${shop} orderCount=${ordersToRedact.length}`);
      }
      console.info(`[compliance] customers_redact OK shop=${shop}`);
    } else {
      console.warn(`[compliance] customers_redact SKIP shop=${shop} reason=identity=${identity} not in scope`);
    }
    return true;
  }

  if (normalizedTopic === "SHOP_REDACT") {
    console.info(`[compliance] shop_redact START shop=${shop} identity=${identity}`);

    // Sessions are always deleted
    await prisma.session.deleteMany({ where: { shop } });
    console.info(`[compliance] shop_redact deleted sessions shop=${shop}`);

    // Delivery models (omnify + cpg-labs)
    if (identity === "cpg-labs" || identity === "omnify") {
      await prisma.lalamoveLocationConfig.deleteMany({ where: { shop } });
      await prisma.carrierServiceRegistration.deleteMany({ where: { shop } });
      await prisma.carrierServiceConfig.deleteMany({ where: { shop } });
      console.info(`[compliance] shop_redact deleted delivery models shop=${shop}`);
    }

    // Retail/analytics models (omnify + cpg-labs)
    if (identity === "cpg-labs" || identity === "omnify") {
      await prisma.goalsConfig.deleteMany({ where: { shop } });
      await prisma.goalsRun.deleteMany({ where: { shop } });
      // New normalized tables
      await prisma.retailOrder.deleteMany({ where: { shop } });
      await prisma.retailCustomer.deleteMany({ where: { shop } });
      await prisma.retailCityMonthly.deleteMany({ where: { shop } });
      await prisma.retailHeatmapBucket.deleteMany({ where: { shop } });
      await prisma.retailSyncMeta.deleteMany({ where: { shop } });
      // Legacy tables (will be dropped in a future migration)
      await prisma.retailAnalyticsCache.deleteMany({ where: { shop } }).catch(() => {});
      await prisma.retailAnalyticsSyncStatus.deleteMany({ where: { shop } }).catch(() => {});
      // Location data
      await writeLocations([], shop);
      await writeLocationSets([], shop);
      console.info(`[compliance] shop_redact deleted analytics/retail models shop=${shop}`);
    }

    console.info(`[compliance] shop_redact OK shop=${shop}`);
    return true;
  }

  console.warn(`[compliance] unhandled topic SKIP shop=${shop} topic=${normalizedTopic}`);
  return false;
};
