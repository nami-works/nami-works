import type { FastifyInstance } from "fastify";

/**
 * RFC 8414 OAuth 2.0 Authorization Server Metadata.
 *
 * Claude.ai (and any MCP client) discovers our OAuth endpoints by GETting
 * `/.well-known/oauth-authorization-server`. The response advertises the
 * issuer, the auth/token/registration endpoints, supported flows, etc.
 *
 * The issuer is the origin of the gateway. By default `https://mcp.gebeauty.com.br`,
 * overridable via OAUTH_ISSUER for local testing.
 */

const ISSUER = process.env.OAUTH_ISSUER ?? "https://mcp.gebeauty.com.br";

export function mountOAuthDiscovery(app: FastifyInstance): void {
  app.get("/.well-known/oauth-authorization-server", async () => {
    return {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/oauth/authorize`,
      token_endpoint: `${ISSUER}/oauth/token`,
      registration_endpoint: `${ISSUER}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [],
    };
  });

  // Per-RFC 9728 OAuth Protected Resource Metadata. The MCP authorization
  // spec requires us to advertise per-tenant resource metadata so the MCP
  // host (e.g. claude.ai) can pass `resource=<tenant URL>` through to the
  // authorize/token calls per RFC 8707. Without this, the host has no way
  // to know which tenant the OAuth flow is for.
  app.get(
    "/.well-known/oauth-protected-resource/:tenant",
    async (request, reply) => {
      const { tenant } = request.params as { tenant: string };
      if (!/^[a-z0-9-]+$/.test(tenant)) {
        return reply.code(400).send({ error: "invalid_tenant" });
      }
      return {
        resource: `${ISSUER}/${tenant}`,
        authorization_servers: [ISSUER],
        bearer_methods_supported: ["header"],
        scopes_supported: [],
      };
    },
  );

  // Backward-compat: the no-tenant variant returns the same shape but with
  // the bare origin as the resource. Some older clients fall back to this.
  app.get("/.well-known/oauth-protected-resource", async () => {
    return {
      resource: ISSUER,
      authorization_servers: [ISSUER],
      bearer_methods_supported: ["header"],
    };
  });
}
