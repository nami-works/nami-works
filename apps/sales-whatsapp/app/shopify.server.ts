import "@shopify/shopify-app-react-router/adapters/node";
import { ApiVersion, AppDistribution, shopifyApp } from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server.js";

// Standalone config, deliberately NOT reusing @cpg-labs/shared-auth (that
// package hardcodes AppDistribution.AppStore for the public Omnify family;
// this is a private, single-merchant, GE-Beauty-only app — a different
// distribution model, not just a different Prisma client). Zero coupling to
// omnify-admin either way: own Prisma client, own Session table.
const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET ?? "",
  apiVersion: ApiVersion.January26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL ?? "",
  authPathPrefix: "/auth",
  // Cast needed: PrismaSessionStorage's types resolve @shopify/shopify-api
  // against whatever the *hoisted* @prisma/client is in this monorepo
  // (omnify's), not this app's custom @prisma/client-sales-whatsapp output
  // — a structural-typing collision, not a real runtime mismatch. Same cast
  // already used in packages/shared-auth/src/index.ts for the identical
  // reason; not a new pattern.
  sessionStorage: new PrismaSessionStorage(prisma as never) as unknown as Parameters<typeof shopifyApp>[0]["sessionStorage"],
  distribution: AppDistribution.SingleMerchant,
  // Online tokens are load-bearing, not a nice-to-have: the whole per-rep
  // access-control model (locations.ts, auth.ts) depends on the session
  // token's `sub` claim carrying the real logged-in staff user, which only
  // happens with online (per-user) tokens — offline tokens are shop-level
  // only. Verified against Shopify's own docs 2026-08-12, not assumed.
  useOnlineTokens: true,
  future: {
    expiringOfflineAccessTokens: true,
  },
});

export default shopify;
export const apiVersion = ApiVersion.January26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
