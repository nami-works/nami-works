import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { signClientId, type ClientMetadata } from "./jwt.js";

/**
 * RFC 7591 Dynamic Client Registration.
 *
 * Claude.ai POSTs its client metadata; we return a `client_id` (which is
 * itself a signed JWT containing the metadata — no DB row needed).
 *
 * Public clients (no client secret) only. Token endpoint auth method is
 * always "none"; PKCE is mandatory at the token exchange step.
 */

const RegistrationRequestSchema = z.object({
  redirect_uris: z.array(z.string().url()).min(1).max(10),
  client_name: z.string().max(200).optional(),
  token_endpoint_auth_method: z.literal("none").optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  scope: z.string().optional(),
});

export function mountOAuthRegister(app: FastifyInstance): void {
  app.post("/oauth/register", async (request, reply) => {
    const parsed = RegistrationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_client_metadata",
        error_description: parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
    }

    const metadata: ClientMetadata = {
      redirect_uris: parsed.data.redirect_uris,
      ...(parsed.data.client_name !== undefined
        ? { client_name: parsed.data.client_name }
        : {}),
      token_endpoint_auth_method: "none",
    };

    const clientId = await signClientId(metadata);

    return reply.code(201).send({
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: metadata.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  });
}
