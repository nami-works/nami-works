import { randomUUID } from "node:crypto";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import {
  authorizeTenantRequest,
  type TenantLookup,
} from "../auth/tenant-auth.js";
import { tenantLogger } from "../lib/logger.js";
import { createMcpServerForTenant } from "./registry.js";

export type TransportDeps = {
  prisma?: TenantLookup;
};

export function mountTenantRoute(
  app: FastifyInstance,
  deps: TransportDeps = {},
): void {
  app.post("/:tenant", async (request, reply) => {
    const { tenant: slug } = request.params as { tenant: string };
    const authResult = await authorizeTenantRequest({
      slug,
      authorizationHeader: request.headers.authorization,
      ...(deps.prisma ? { prisma: deps.prisma } : {}),
    });

    if (!authResult.ok) {
      return reply
        .code(authResult.status)
        .send({ ok: false, error: authResult.error });
    }

    const ctx = {
      tenant: authResult.tenant,
      logger: tenantLogger(authResult.tenant.slug),
      requestId: request.id ?? randomUUID(),
    };

    const server = createMcpServerForTenant(ctx);
    // Stateless mode: omit sessionIdGenerator entirely. Claude.ai's custom
    // connector sends independent JSON-RPC requests, so sessions would be
    // unused bookkeeping.
    const transport = new StreamableHTTPServerTransport({});

    reply.hijack();

    try {
      await server.connect(transport as unknown as Transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (err) {
      ctx.logger.error({ err }, "MCP transport error");
      if (!reply.raw.headersSent) {
        reply.raw.statusCode = 500;
        reply.raw.end();
      }
    } finally {
      await transport.close();
      await server.close();
    }
  });
}
