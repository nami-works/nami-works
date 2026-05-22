import { randomUUID } from "node:crypto";
import { type Prisma, type PrismaClient } from "@prisma/client-fulfillment";
import { prisma as defaultPrisma } from "../db/prisma.js";

export type FulfillmentEventType =
  | "order.received"
  | "order.picking"
  | "order.picked"
  | "order.pooled"
  | "order.routed"
  | "order.dispatched"
  | "order.delivered"
  | "order.failed_delivery"
  | "order.cancelled";

export type EnqueueArgs = {
  tenantId: string;
  targetUrl: string;
  eventType: FulfillmentEventType;
  data: Prisma.InputJsonValue;
  prisma?: Pick<PrismaClient, "webhookDelivery">;
};

// Inserts a pending WebhookDelivery row. The worker picks it up on the next
// tick. The event payload follows Stripe's envelope shape (id, type,
// createdAt, data) so merchants can reuse Stripe-style verifiers.
export async function enqueueWebhook(args: EnqueueArgs): Promise<string> {
  const db = args.prisma ?? defaultPrisma;
  const eventId = `evt_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const payload: Prisma.InputJsonObject = {
    id: eventId,
    type: args.eventType,
    createdAt: new Date().toISOString(),
    tenantId: args.tenantId,
    data: args.data,
  };
  const row = await db.webhookDelivery.create({
    data: {
      tenantId: args.tenantId,
      eventId,
      eventType: args.eventType,
      payload,
      targetUrl: args.targetUrl,
    },
    select: { id: true },
  });
  return row.id;
}
