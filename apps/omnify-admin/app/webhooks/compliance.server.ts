import prisma from "../db.server";
import { normalizeWebhookTopic } from "../webhooks.server";
import {
  clearAnalyticsCache,
  readAnalyticsCache,
  writeAnalyticsCache,
  writeLocations,
  writeLocationSets,
} from "../retail-expansion/storage.server";

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

  if (normalizedTopic === "CUSTOMERS_DATA_REQUEST") {
    console.log(`Compliance request received for ${shop}`);
    return true;
  }

  if (normalizedTopic === "CUSTOMERS_REDACT") {
    const customerId = payload?.customer?.id
      ? String(payload.customer.id)
      : null;
    const ordersToRedact = Array.isArray(payload?.orders_to_redact)
      ? payload.orders_to_redact.map((id) => String(id))
      : [];

    const cache = await readAnalyticsCache(shop);
    if (customerId) {
      cache.customers = cache.customers.filter(
        (customer) => customer.id !== customerId,
      );
      cache.orders = cache.orders.filter(
        (order) => order.customerId !== customerId,
      );
    }
    if (ordersToRedact.length > 0) {
      cache.orders = cache.orders.filter(
        (order) => !ordersToRedact.includes(order.id),
      );
    }
    cache.updatedAt = new Date().toISOString();
    await writeAnalyticsCache(cache, shop);
    return true;
  }

  if (normalizedTopic === "SHOP_REDACT") {
    await prisma.session.deleteMany({ where: { shop } });
    await prisma.goalsConfig.deleteMany({ where: { shop } });
    await prisma.goalsRun.deleteMany({ where: { shop } });
    await prisma.lalamoveLocationConfig.deleteMany({ where: { shop } });
    await prisma.carrierServiceRegistration.deleteMany({ where: { shop } });
    await prisma.carrierServiceConfig.deleteMany({ where: { shop } });

    await clearAnalyticsCache(shop);
    await writeLocations([], shop);
    await writeLocationSets([], shop);

    // Clear legacy shared cache to avoid retaining redacted data.
    await clearAnalyticsCache();
    await writeLocations([]);
    await writeLocationSets([]);
    return true;
  }

  return false;
};
