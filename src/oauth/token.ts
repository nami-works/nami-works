import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { consumeCode } from "./codes.js";
import { signAccessToken, verifyClientId } from "./jwt.js";

/**
 * POST /oauth/token — exchange an authorization code (and PKCE verifier)
 * for a JWT access token.
 *
 * Request body (application/x-www-form-urlencoded per RFC 6749):
 *   grant_type=authorization_code
 *   code=<from /oauth/authorize redirect>
 *   redirect_uri=<must match the original>
 *   client_id=<the registered client_id JWT>
 *   code_verifier=<PKCE verifier>
 *
 * Response:
 *   {
 *     "access_token": "<JWT>",
 *     "token_type": "Bearer",
 *     "expires_in": 86400,
 *     "scope": ""
 *   }
 */

function pkceMatches(verifier: string, challenge: string): boolean {
  // S256: BASE64URL(SHA256(verifier)) === challenge
  const computed = createHash("sha256").update(verifier).digest("base64url");
  // Plain string compare is fine here — both sides are already short hashes
  // and not user-controlled in a timing-sensitive way (the code itself is
  // one-time-use and gone after this call).
  return computed === challenge;
}

const TOKEN_TTL_SECONDS = 60 * 60 * 24; // 24h

function tokenError(reply: import("fastify").FastifyReply, status: number, error: string, description: string) {
  return reply.code(status).send({ error, error_description: description });
}

export function mountOAuthToken(app: FastifyInstance): void {
  app.post("/oauth/token", async (request, reply) => {
    const body = request.body as Record<string, string | undefined>;

    const grantType = body.grant_type;
    if (grantType !== "authorization_code") {
      return tokenError(
        reply,
        400,
        "unsupported_grant_type",
        `grant_type "${grantType ?? ""}" not supported. Only authorization_code.`,
      );
    }

    const code = body.code;
    const redirectUri = body.redirect_uri;
    const clientId = body.client_id;
    const codeVerifier = body.code_verifier;

    if (!code || !redirectUri || !clientId || !codeVerifier) {
      return tokenError(
        reply,
        400,
        "invalid_request",
        "Missing required fields: code, redirect_uri, client_id, code_verifier.",
      );
    }

    const client = await verifyClientId(clientId);
    if (!client) {
      return tokenError(reply, 401, "invalid_client", "Unknown client_id.");
    }
    if (!client.redirect_uris.includes(redirectUri)) {
      return tokenError(
        reply,
        400,
        "invalid_grant",
        "redirect_uri does not match the registered URIs.",
      );
    }

    const record = consumeCode(code);
    if (!record) {
      return tokenError(
        reply,
        400,
        "invalid_grant",
        "Authorization code is invalid, expired, or already used.",
      );
    }
    if (record.clientId !== clientId) {
      return tokenError(
        reply,
        400,
        "invalid_grant",
        "Authorization code was issued to a different client.",
      );
    }
    if (record.redirectUri !== redirectUri) {
      return tokenError(
        reply,
        400,
        "invalid_grant",
        "redirect_uri does not match the value used at /oauth/authorize.",
      );
    }
    if (!pkceMatches(codeVerifier, record.codeChallenge)) {
      return tokenError(
        reply,
        400,
        "invalid_grant",
        "PKCE code_verifier does not match the original code_challenge.",
      );
    }

    const accessToken = await signAccessToken({
      tenantSlug: record.tenantSlug,
      ttlSeconds: TOKEN_TTL_SECONDS,
    });

    return reply.send({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: TOKEN_TTL_SECONDS,
      scope: "",
    });
  });
}
