import "dotenv/config";
import { randomUUID } from "node:crypto";
import sensible from "@fastify/sensible";
import Fastify, { type FastifyBaseLogger } from "fastify";
import { rootLogger } from "./lib/logger.js";
import { mountTenantRoute } from "./mcp/transport.js";
// Side-effect import: registers every tool in the catalog at boot.
import "./tools/index.js";

const isDev = process.env.NODE_ENV === "development";

const app = Fastify({
  // Pino's Logger satisfies Fastify's logger contract at runtime; the type
  // mismatch is a strict-optional quirk between pino v9 and fastify v5.
  loggerInstance: rootLogger as unknown as FastifyBaseLogger,
  genReqId: () => randomUUID(),
  disableRequestLogging: !isDev,
});

await app.register(sensible);

app.get("/health", async () => ({ ok: true }));

mountTenantRoute(app);

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
  app.log.info(`[nami-works] listening on http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
