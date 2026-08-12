import type { ActionFunctionArgs } from "react-router";
import { verifyWebhookRequest } from "../webhooks.server.js";
import prisma from "../db.server.js";
import { resolveConversion, type OrdersCreatePayload } from "../lib/order-events.js";

// Flips a rep's open contact to Converted the instant a matching customer
// orders — per the locked architecture (ge-sales-whatsapp-app.md,
// 2026-08-07): orders/create, not orders/paid, is the trigger for this
// specific "don't message someone who already ordered" purpose. (Contrast
// with apps/connector's just-bought-credit.ts, which correctly listens for
// orders/paid instead — that's a different concern, issuing real money,
// and needs payment confirmation. This webhook just needs to know intent-to-
// purchase happened, to stop a rep messaging a converted customer.)
export const action = async ({ request }: ActionFunctionArgs) => {
  const verified = await verifyWebhookRequest(request);
  if (verified.response) return verified.response;

  const { shop, payload } = verified.result;
  const match = resolveConversion(payload as OrdersCreatePayload);
  if (!match) {
    console.info(`[worklist-webhook] orders-create SKIP shop=${shop} reason=no-match-or-dead-order`);
    return new Response();
  }

  // Conditional update, not a blind overwrite — Shopify webhook delivery is
  // at-least-once, and this must be a safe no-op on a duplicate delivery for
  // an already-converted row. Same idempotency shape as apps/connector's
  // refund-clawback.ts.
  const result = await prisma.worklistContactEvent.updateMany({
    where: { shop, customerGid: match.customerGid, convertedAt: null, skippedAt: null },
    data: { convertedAt: new Date(), convertedOrderGid: match.orderGid },
  });
  console.info(`[worklist-webhook] orders-create OK shop=${shop} order=${match.orderGid} rowsUpdated=${result.count}`);

  return new Response();
};
