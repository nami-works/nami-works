import { randomUUID } from "node:crypto";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
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
  const handle = async (
    slug: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<unknown> => {
    const authResult = await authorizeTenantRequest({
      slug,
      authorizationHeader: request.headers.authorization,
      ...(deps.prisma ? { prisma: deps.prisma } : {}),
    });

    if (!authResult.ok) {
      // RFC 6750 + MCP authorization spec: tell the client where to discover
      // OAuth endpoints. Claude.ai's MCP host uses this hint to start the
      // OAuth flow instead of giving up with "couldn't reach the server".
      if (authResult.status === 401) {
        const issuer = process.env.OAUTH_ISSUER ?? "https://mcp.nami.works";
        // Per-tenant protected-resource metadata URL. Claude.ai's MCP host
        // fetches this, reads `resource: "<issuer>/<tenant>"`, and then passes
        // that resource value in the OAuth authorize + token calls (RFC 8707).
        reply.header(
          "WWW-Authenticate",
          `Bearer realm="MCP", resource_metadata="${issuer}/.well-known/oauth-protected-resource/${slug}"`,
        );
      }
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
    return undefined;
  };

  app.post("/:tenant", (request, reply) =>
    handle((request.params as { tenant: string }).tenant, request, reply),
  );

  // Single-tenant convenience: when DEFAULT_TENANT is set, the bare connector
  // URL (POST /, no tenant path) resolves to that tenant — so the clean URL
  // works without a slug. Multi-tenant deployments leave DEFAULT_TENANT unset.
  const defaultTenant = process.env.DEFAULT_TENANT;
  if (defaultTenant) {
    app.post("/", (request, reply) => handle(defaultTenant, request, reply));
  }
}
