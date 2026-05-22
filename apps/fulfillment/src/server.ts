import "dotenv/config";
import { randomUUID } from "node:crypto";
import sensible from "@fastify/sensible";
import Fastify, { type FastifyBaseLogger } from "fastify";
import { rootLogger } from "./lib/logger.js";
import { mountWebhookRoutes } from "./routes/webhooks.js";
import { startWebhookWorker } from "./webhooks/worker.js";

const isDev = process.env.NODE_ENV === "development";

const app = Fastify({
  // Pino's Logger satisfies Fastify's logger contract at runtime; the type
  // mismatch is a strict-optional quirk between pino v9 and fastify v5.
  loggerInstance: rootLogger as unknown as FastifyBaseLogger,
  genReqId: () => randomUUID(),
  disableRequestLogging: !isDev,
});

await app.register(sensible);
await mountWebhookRoutes(app);

app.get("/health", async () => ({ ok: true }));

// Start the in-process outbox worker. The handle's timer.unref() means it
// won't keep the event loop alive on its own — app.listen() holds the loop.
if (process.env.FULFILLMENT_DISABLE_WORKER !== "1") {
  startWebhookWorker();
}

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
  app.log.info(`[rota-local] listening on http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
