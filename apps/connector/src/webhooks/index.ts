import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { IntegrationTenant } from "@prisma/client-connector";
import { prisma } from "../db/prisma.js";
import { getSecret } from "../secrets/ssm.js";
import { handleOrdersPaidWebhook, type ShopifyOrderPaidPayload } from "./just-bought-credit.js";
import { handleRefundsCreateWebhook, type ShopifyRefundCreatePayload } from "./refund-clawback.js";
import { verifyShopifyHmac } from "./verify.js";

// Shared by every route in this scope: resolves the tenant, verifies HMAC
// against the raw body, and checks the shop-domain header. Returns the
// tenant on success, or sends the appropriate error response and returns
// null (caller should return immediately when null).
async function authenticateWebhook(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<IntegrationTenant | null> {
  const { tenant: slug } = req.params as { tenant: string };
  const rawBody = req.body as Buffer;

  const tenant = await prisma.integrationTenant.findUnique({ where: { slug } });
  if (!tenant || tenant.status !== "active" || !tenant.shopifyShop) {
    await reply.code(404).send();
    return null;
  }

  const hmacHeader = req.headers["x-shopify-hmac-sha256"] as string | undefined;
  const webhookSecret = await getSecret(`${tenant.ssmPrefix}/shopify/webhook_secret`);
  if (!verifyShopifyHmac(rawBody, hmacHeader, webhookSecret)) {
    req.log.warn({ tenant: slug }, "shopify webhook: HMAC verification failed");
    await reply.code(401).send();
    return null;
  }

  const shopHeader = req.headers["x-shopify-shop-domain"];
  if (shopHeader !== tenant.shopifyShop) {
    req.log.warn({ tenant: slug, shopHeader }, "shopify webhook: shop-domain mismatch");
    await reply.code(401).send();
    return null;
  }

  return tenant;
}

// Mounted as its own encapsulated Fastify scope so the raw-buffer body
// parser below applies ONLY to routes registered inside it — sibling routes
// (MCP transport, OAuth) keep Fastify's default parsed-JSON body. HMAC
// verification needs the exact raw bytes Shopify signed, not a re-serialized
// JSON.stringify of a parsed object.
export async function mountWebhookRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (scope) => {
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_req, body, done) => done(null, body),
    );

    scope.post("/:tenant/webhooks/shopify/orders-paid", async (req, reply) => {
      const tenant = await authenticateWebhook(req, reply);
      if (!tenant) return;

      let order: ShopifyOrderPaidPayload;
      try {
        order = JSON.parse((req.body as Buffer).toString("utf8"));
      } catch {
        return reply.code(400).send();
      }

      // Ack fast — Shopify retries on timeout, and a retry of an already-
      // processed order is exactly the duplicate-delivery case the unique
      // constraint exists to absorb. Process after responding; failures are
      // logged, not surfaced back to Shopify as a reason to retry.
      reply.code(200).send({ ok: true });

      try {
        await handleOrdersPaidWebhook(order, {
          tenantId: tenant.id,
          ssmPrefix: tenant.ssmPrefix,
          shopifyShop: tenant.shopifyShop as string,
          log: req.log,
        });
      } catch (err) {
        req.log.error(
          { err, tenant: tenant.slug, orderId: order.id },
          "orders/paid webhook: processing failed",
        );
      }
    });

    // Claws back just-bought credit when the underlying order is refunded
    // after credit was already issued — the automated counterpart to
    // orders-paid above, same idempotency shape, same hood. See
    // refund-clawback.ts for the manual precedent this replaces.
    scope.post("/:tenant/webhooks/shopify/refunds-create", async (req, reply) => {
      const tenant = await authenticateWebhook(req, reply);
      if (!tenant) return;

      let refund: ShopifyRefundCreatePayload;
      try {
        refund = JSON.parse((req.body as Buffer).toString("utf8"));
      } catch {
        return reply.code(400).send();
      }

      reply.code(200).send({ ok: true });

      try {
        await handleRefundsCreateWebhook(refund, {
          tenantId: tenant.id,
          ssmPrefix: tenant.ssmPrefix,
          shopifyShop: tenant.shopifyShop as string,
          log: req.log,
        });
      } catch (err) {
        req.log.error(
          { err, tenant: tenant.slug, orderId: refund.order_id },
          "refunds/create webhook: processing failed",
        );
      }
    });
  });
}
