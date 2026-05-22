import "dotenv/config";
import { randomUUID } from "node:crypto";
import sensible from "@fastify/sensible";
import Fastify, { type FastifyBaseLogger } from "fastify";
import { mountIconRoutes } from "./lib/icon-routes.js";
import { rootLogger } from "./lib/logger.js";
import { mountLocalDeliveryRoutes } from "./local-delivery/index.js";
import { mountTenantRoute } from "./mcp/transport.js";
import { mountOAuthRoutes } from "./oauth/index.js";
import { assertEncryptionConfigured } from "./services/security/encryption.js";
import { mountToneRoutes } from "./services/tone-sources/routes.js";
// Side-effect import: registers every tool in the catalog at boot.
import "./tools/index.js";

const isDev = process.env.NODE_ENV === "development";

// Fail fast in production if encrypted-credential storage isn't configured —
// catches missing APP_ENCRYPTION_KEY at boot instead of when a meta/monday
// adapter first tries to decrypt and surprises someone hours later.
if (process.env.NODE_ENV === "production") {
  assertEncryptionConfigured();
}

const app = Fastify({
  // Pino's Logger satisfies Fastify's logger contract at runtime; the type
  // mismatch is a strict-optional quirk between pino v9 and fastify v5.
  loggerInstance: rootLogger as unknown as FastifyBaseLogger,
  genReqId: () => randomUUID(),
  disableRequestLogging: !isDev,
});

await app.register(sensible);
await mountOAuthRoutes(app);
mountIconRoutes(app);

app.get("/health", async () => ({ ok: true }));

mountTenantRoute(app);
mountToneRoutes(app);

if (process.env.LOCAL_DELIVERY_SIMULATOR_ENABLED === "1") {
  await mountLocalDeliveryRoutes(app);
}

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
  app.log.info(`[nami-works] listening on http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
