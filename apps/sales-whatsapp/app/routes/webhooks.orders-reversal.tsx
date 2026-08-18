import type { ActionFunctionArgs } from "react-router";
import { verifyWebhookRequest } from "../webhooks.server.js";
import prisma from "../db.server.js";
import { resolveReversalOrderGid } from "../lib/order-events.js";

// Un-flips Converted if the underlying order is later cancelled or
// refunded — added 2026-08-12 per the senior-eng review's finding that the
// original design had no reversal path for this exact bug class, the same
// one apps/connector already had to build refund-clawback.ts to fix once
// for its own (unrelated) Converted-equivalent state.
export const action = async ({ request }: ActionFunctionArgs) => {
  const verified = await verifyWebhookRequest(request);
  if (verified.response) return verified.response;

  const { shop, topic, payload } = verified.result;
  const orderGid = resolveReversalOrderGid(topic, payload as never);
  if (!orderGid) {
    console.info(`[worklist-webhook] orders-reversal SKIP shop=${shop} topic=${topic} reason=no-order-match`);
    return new Response();
  }

  // Conditional guard (convertedAt not null, unconvertedAt null) makes a
  // duplicate delivery of the same cancellation/refund event a safe no-op.
  const result = await prisma.worklistContactEvent.updateMany({
    where: { shop, convertedOrderGid: orderGid, convertedAt: { not: null }, unconvertedAt: null },
    data: { unconvertedAt: new Date() },
  });
  console.info(`[worklist-webhook] orders-reversal OK shop=${shop} order=${orderGid} rowsUnconverted=${result.count}`);

  return new Response();
};
