import {
  createAdminApiClient,
  type AdminApiClient,
} from "@shopify/admin-api-client";
import { getSecret } from "../secrets/ssm.js";

// Pinned to Shopify's current stable quarterly release. The
// @shopify/admin-api-client library validates apiVersion client-side against
// a baked-in list, so the Shopify URL alias "latest" is rejected here.
// Bump this string each quarter when a new stable lands (Jan/Apr/Jul/Oct).
// See https://shopify.dev/docs/api/usage/versioning for the release schedule.
const API_VERSION = "2026-04";
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
