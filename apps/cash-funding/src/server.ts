import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifySensible from "@fastify/sensible";
import fastifyStatic from "@fastify/static";
import { mountGoogleAuth } from "./auth/google.js";
import { mountDevAuth } from "./auth/dev.js";
import { requireAuth, currentUser } from "./auth/session.js";
import { registerFunderRoutes } from "./routes/funders.js";
import { registerDeliveryRoutes } from "./routes/deliveries.js";
import { registerInstallmentRoutes } from "./routes/installments.js";
import { registerAllocationRoutes } from "./routes/allocation.js";
import { registerOperationRoutes } from "./routes/operations.js";
import { registerTimelineRoutes } from "./routes/timeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = Fastify({
  logger: {
    transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
  },
});

await app.register(fastifySensible);
await app.register(fastifyCookie);
await app.register(fastifyStatic, {
  root: path.join(__dirname, "..", "public"),
  prefix: "/",
});

app.get("/health", async () => ({ ok: true }));

mountGoogleAuth(app);
if (process.env.NODE_ENV !== "production") mountDevAuth(app);

app.get("/api/me", async (request) => {
  const user = await currentUser(request);
  return { user };
});

app.addHook("onRequest", async (request, reply) => {
  if (request.url.startsWith("/api/") && request.url !== "/api/me") {
    await requireAuth(request, reply);
  }
});

registerFunderRoutes(app);
registerDeliveryRoutes(app);
registerInstallmentRoutes(app);
registerAllocationRoutes(app);
registerOperationRoutes(app);
registerTimelineRoutes(app);

const port = Number(process.env.PORT ?? 3010);
const host = process.env.HOST ?? "0.0.0.0";

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
