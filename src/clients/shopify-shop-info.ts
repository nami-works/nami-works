import type { AdminApiClient } from "@shopify/admin-api-client";

const SHOP_QUERY = /* GraphQL */ `
  query ShopInfo {
    shop {
      ianaTimezone
    }
  }
`;

type ShopInfoResponse = { shop: { ianaTimezone: string } };

type CacheEntry = { ianaTimezone: string; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour — shop timezone changes ~never

export type ShopTimezoneArgs = {
  shopifyShop: string;
  client: AdminApiClient;
  ttlMs?: number;
  now?: () => number;
};

export async function getShopTimezone(
  args: ShopTimezoneArgs,
): Promise<string> {
  const now = args.now ? args.now() : Date.now();
  const hit = cache.get(args.shopifyShop);
  if (hit && hit.expiresAt > now) return hit.ianaTimezone;

  const res = await args.client.request<ShopInfoResponse>(SHOP_QUERY);
  if (res.errors || !res.data?.shop.ianaTimezone) {
    throw new Error(
      `Failed to fetch shop timezone for ${args.shopifyShop}: ${res.errors?.message ?? "no data"}`,
    );
  }

  const ianaTimezone = res.data.shop.ianaTimezone;
  cache.set(args.shopifyShop, {
    ianaTimezone,
    expiresAt: now + (args.ttlMs ?? DEFAULT_TTL_MS),
  });
  return ianaTimezone;
}

export function __clearShopInfoCacheForTesting(): void {
  cache.clear();
}
