import type { PrismaClient } from "@prisma/client";

export type CompliancePayload = {
  customer?: { id?: string | number };
  orders_to_redact?: Array<string | number>;
};

export type ComplianceTopic =
  | "CUSTOMERS_DATA_REQUEST"
  | "CUSTOMERS_REDACT"
  | "SHOP_REDACT";

/**
 * Model deletion strategy per topic.
 * Apps provide a list of model names to delete from Prisma on SHOP_REDACT.
 */
export type ShopRedactHandler = (
  prisma: PrismaClient,
  shop: string,
) => Promise<void>;

export type ComplianceConfig = {
  prisma: PrismaClient;
  /** Custom handler for SHOP_REDACT — deletes app-specific models. */
  onShopRedact: ShopRedactHandler;
  /** Optional handler for CUSTOMERS_REDACT — redact customer-specific data. */
  onCustomerRedact?: (
    prisma: PrismaClient,
    shop: string,
    customerId: string | null,
    orderIds: string[],
  ) => Promise<void>;
};

/**
 * Generic GDPR compliance webhook handler.
 * Each app configures which models to clean up.
 */
export async function handleComplianceWebhook(
  topic: ComplianceTopic,
  shop: string,
  payload: CompliancePayload,
  config: ComplianceConfig,
): Promise<boolean> {
  if (topic === "CUSTOMERS_DATA_REQUEST") {
    console.log(`Compliance request received for ${shop}`);
    return true;
  }

  if (topic === "CUSTOMERS_REDACT") {
    const customerId = payload?.customer?.id
      ? String(payload.customer.id)
      : null;
    const ordersToRedact = Array.isArray(payload?.orders_to_redact)
      ? payload.orders_to_redact.map((id) => String(id))
      : [];

    if (config.onCustomerRedact) {
      await config.onCustomerRedact(config.prisma, shop, customerId, ordersToRedact);
    }
    return true;
  }

  if (topic === "SHOP_REDACT") {
    // Always delete sessions
    await config.prisma.session.deleteMany({ where: { shop } });
    // App-specific cleanup
    await config.onShopRedact(config.prisma, shop);
    return true;
  }

  return false;
}
