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
    sessionStorage: new PrismaSessionStorage(config.prisma) as any,
    distribution: AppDistribution.AppStore,
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
