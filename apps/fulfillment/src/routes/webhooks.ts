import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { rootLogger } from "../lib/logger.js";

const ParamsSchema = z.object({ deliveryId: z.string().min(1) });

// Replay endpoint — flips a `failed` (or `delivered`) WebhookDelivery row
// back to `pending` with attempts reset to 0, so the worker picks it up on
// the next tick. Authorization: internal-only; gate behind an admin bearer
// token (FULFILLMENT_ADMIN_TOKEN env). Wider auth model (per-staff RBAC) is
// a follow-up.
export async function mountWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post("/webhooks/:deliveryId/replay", async (request, reply) => {
    const adminToken = process.env.FULFILLMENT_ADMIN_TOKEN;
    if (!adminToken) {
      return reply.code(503).send({ error: "admin replay not configured" });
    }
    const header = request.headers.authorization ?? "";
    const presented = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1]?.trim();
    if (!presented || presented !== adminToken) {
      return reply.code(401).send({ error: "Unauthorized." });
    }

    const params = ParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid deliveryId" });
    }

    const existing = await prisma.webhookDelivery.findUnique({
      where: { id: params.data.deliveryId },
      select: { id: true, status: true, attempts: true },
    });
    if (!existing) {
      return reply.code(404).send({ error: "delivery not found" });
    }

    await prisma.webhookDelivery.update({
      where: { id: params.data.deliveryId },
      data: {
        status: "pending",
        attempts: 0,
        lastAttemptAt: null,
        lastError: null,
      },
    });

    rootLogger.info(
      {
        deliveryId: params.data.deliveryId,
        wasStatus: existing.status,
        priorAttempts: existing.attempts,
      },
      "webhook_replay_requested",
    );

    return reply.code(202).send({ id: existing.id, status: "pending" });
  });
}
