import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import type { PrismaClient } from "@prisma/client";

export type ShopifyAppConfig = {
  prisma: PrismaClient;
  /** Override apiKey (defaults to SHOPIFY_API_KEY env) */
  apiKey?: string;
  /** Override apiSecretKey (defaults to SHOPIFY_API_SECRET env) */
  apiSecretKey?: string;
  /** Override appUrl (defaults to SHOPIFY_APP_URL env) */
  appUrl?: string;
  /** Auth path prefix relative to appUrl */
  authPathPrefix?: string;
  /** Custom shop domain */
  customShopDomain?: string;
};

export function createShopifyApp(config: ShopifyAppConfig) {
  const shopify = shopifyApp({
    apiKey: config.apiKey ?? process.env.SHOPIFY_API_KEY,
    apiSecretKey: config.apiSecretKey ?? process.env.SHOPIFY_API_SECRET ?? "",
    apiVersion: ApiVersion.October25,
    scopes: process.env.SCOPES?.split(","),
    appUrl: config.appUrl ?? process.env.SHOPIFY_APP_URL ?? "",
    authPathPrefix: config.authPathPrefix ?? "/auth",
    sessionStorage: new PrismaSessionStorage(config.prisma) as unknown as Parameters<typeof shopifyApp>[0]["sessionStorage"],
    distribution: AppDistribution.AppStore,
    // Online tokens give us per-user-per-request session refresh, which is
    // what carries the live `session.onlineAccessInfo.associated_user.locale`
    // for embedded loaders. Offline tokens are still created at OAuth install
    // (webhooks / cron use them via `unauthenticated.admin(shop)`); enabling
    // online tokens layers user-scoped sessions on top, refreshed via token
    // exchange on every `authenticate.admin` call.
    //
    // Without this, `session.locale` is the install-time shop-level value
    // and never updates when the merchant flips their Shopify admin
    // language. With it, locale resolves to the user's current preference
    // on every embedded page load. See get-current-locale.server.ts in
    // apps/omnify-admin for the read site.
    useOnlineTokens: true,
    future: {
      expiringOfflineAccessTokens: true,
    },
    ...(config.customShopDomain
      ? { customShopDomains: [config.customShopDomain] }
      : {}),
  });

  return shopify;
}

export { ApiVersion, AppDistribution } from "@shopify/shopify-app-react-router/server";
