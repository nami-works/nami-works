import {
  createAdminApiClient,
  type AdminApiClient,
} from "@shopify/admin-api-client";
import { getSecret } from "../secrets/ssm.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2025-01";
const DEFAULT_TTL_MS = 5 * 60 * 1000;

type CacheEntry = { client: AdminApiClient; expiresAt: number };
const cache = new Map<string, CacheEntry>();

export type ShopifyClientArgs = {
  ssmPrefix: string;
  shopifyShop: string;
};

export async function getShopifyClient(
  args: ShopifyClientArgs,
): Promise<AdminApiClient> {
  if (!args.shopifyShop) {
    throw new Error(
      "Tenant has no shopifyShop configured. Cannot build Shopify client.",
    );
  }

  const key = args.shopifyShop;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.client;

  const accessToken = await getSecret(
    `${args.ssmPrefix}/shopify/access_token`,
  );

  const client = createAdminApiClient({
    storeDomain: args.shopifyShop,
    accessToken,
    apiVersion: API_VERSION,
  });
  cache.set(key, { client, expiresAt: now + DEFAULT_TTL_MS });
  return client;
}

export function __clearShopifyClientCacheForTesting(): void {
  cache.clear();
}
