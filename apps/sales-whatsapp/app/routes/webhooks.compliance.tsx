import type { ActionFunctionArgs } from "react-router";
import { verifyWebhookRequest } from "../webhooks.server.js";
import prisma from "../db.server.js";

type RedactPayload = { customer?: { id?: number } };

// The three mandatory compliance topics. This app's only customer-linked
// data is WorklistContactEvent.customerGid + repEmail — no order/address/
// payment data is ever stored (that all stays in Shopify, read live).
export const action = async ({ request }: ActionFunctionArgs) => {
  const verified = await verifyWebhookRequest(request);
  if (verified.response) return verified.response;

  const { shop, topic, payload } = verified.result;

  if (topic === "CUSTOMERS_REDACT") {
    const p = payload as RedactPayload;
    if (p.customer?.id) {
      const customerGid = `gid://shopify/Customer/${p.customer.id}`;
      await prisma.worklistContactEvent.deleteMany({ where: { shop, customerGid } });
    }
    return new Response();
  }

  if (topic === "SHOP_REDACT") {
    await prisma.worklistContactEvent.deleteMany({ where: { shop } });
    return new Response();
  }

  if (topic === "CUSTOMERS_DATA_REQUEST") {
    // Nothing to export — no PII beyond the customer GID itself is stored.
    return new Response();
  }

  return new Response("Unsupported webhook topic.", { status: 400 });
};
