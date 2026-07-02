import type { FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import type { TenantLookup } from "../auth/tenant-auth.js";
import { mountOAuthAuthorize } from "./authorize.js";
import { mountOAuthDiscovery } from "./discovery.js";
import { mountGoogleOAuth } from "./google.js";
import { mountOAuthRegister } from "./register.js";
import { mountOAuthToken } from "./token.js";

export type OAuthDeps = {
  prisma?: TenantLookup;
};

/**
 * Mounts every OAuth route on the Fastify app. Call once at boot.
 *
 * Adds @fastify/formbody so /oauth/authorize POST and /oauth/token POST
 * can read application/x-www-form-urlencoded bodies (the OAuth standard).
 */
export async function mountOAuthRoutes(
  app: FastifyInstance,
  deps: OAuthDeps = {},
): Promise<void> {
  await app.register(formbody);
  mountOAuthDiscovery(app);
  mountOAuthRegister(app);
  mountOAuthAuthorize(app, deps);
  mountGoogleOAuth(app);
  mountOAuthToken(app);
}
