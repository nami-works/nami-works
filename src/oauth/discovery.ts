import type { FastifyInstance } from "fastify";

/**
 * RFC 8414 OAuth 2.0 Authorization Server Metadata.
 *
 * Claude.ai (and any MCP client) discovers our OAuth endpoints by GETting
 * `/.well-known/oauth-authorization-server`. The response advertises the
 * issuer, the auth/token/registration endpoints, supported flows, etc.
 *
 * The issuer is the origin of the gateway. By default `https://mcp.nami.works`,
 * overridable via OAUTH_ISSUER for local testing.
 */

const ISSUER = process.env.OAUTH_ISSUER ?? "https://mcp.nami.works";

export function mountOAuthDiscovery(app: FastifyInstance): void {
  app.get("/.well-known/oauth-authorization-server", async () => {
    return {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/oauth/authorize`,
      token_endpoint: `${ISSUER}/oauth/token`,
      registration_endpoint: `${ISSUER}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [],
    };
  });

  // Some MCP clients (claude.ai included) probe `/.well-known/oauth-protected-resource`
  // per the draft MCP authorization spec. Point them back at the same authorization server.
  app.get("/.well-known/oauth-protected-resource", async () => {
    return {
      resource: ISSUER,
      authorization_servers: [ISSUER],
      bearer_methods_supported: ["header"],
    };
  });
}
