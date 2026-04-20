import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import sensible from "@fastify/sensible";

const isDev = process.env.NODE_ENV === "development";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    ...(isDev
      ? {
          transport: {
            target: "pino-pretty",
            options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" },
          },
        }
      : {}),
  },
  genReqId: () => randomUUID(),
  disableRequestLogging: !isDev,
});

await app.register(sensible);

app.get("/health", async () => ({ ok: true }));

app.post("/:tenant", async (request, reply) => {
  const { tenant } = request.params as { tenant: string };
  return reply.code(501).send({
    ok: false,
    error: "not_implemented",
    message: `MCP transport for tenant "${tenant}" is not yet wired up.`,
  });
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
  app.log.info(`[nami-works] listening on http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
