import { getSecret } from "../secrets/ssm.js";

/**
 * Loox reviews client (per-tenant). Loox is the Shopify reviews/UGC app — its
 * Merchant API returns customer reviews with ratings, text, photos/videos, and
 * the merchant's replies. Great source for PDP social proof + ad creatives.
 *
 * - GET https://api.loox.io/api/v1/store/<publicStoreId>/product-reviews
 * - Header: X-Api-Secret-Key: <apiKey>
 * - Read-only. Rate limited to 120 req/min per key (we pace lightly).
 * - Response: { reviews: LooxReview[], pagination: { total, page, limit, hasMore } }
 */

const LOOX_BASE_URL = process.env.LOOX_BASE_URL ?? "https://api.loox.io/api/v1";
const CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;

export type LooxMedia = { type: string; url: string };
export type LooxReview = {
  id: string;
  rating: number;
  body: string | null;
  date?: string;
  createdAt?: string;
  verified?: boolean;
  status?: string;
  reviewer?: { name?: string; nickname?: string } | null;
  product?: { id?: string; name?: string; url?: string; imageUrl?: string } | null;
  reply?: { body?: string; repliedAt?: string } | null;
  media?: LooxMedia[];
  location?: { country?: string; countryCode?: string } | null;
};
export type LooxReviewsPage = {
  reviews: LooxReview[];
  pagination?: {
    total?: number;
    page?: number;
    limit?: number;
    hasMore?: boolean;
  };
};

export type LooxClient = {
  listReviews(args: { page?: number; limit?: number }): Promise<LooxReviewsPage>;
};

export type BuildLooxClientOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Min ms between calls (Loox allows 120/min). 0 in tests. */
  minGapMs?: number;
};

const LOOX_MIN_GAP_MS = process.env.NODE_ENV === "test" ? 0 : 400;
let lastCallAt = 0;

export function buildLooxClient(
  publicStoreId: string,
  apiKey: string,
  opts: BuildLooxClientOptions = {},
): LooxClient {
  const baseUrl = opts.baseUrl ?? LOOX_BASE_URL;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const minGap = opts.minGapMs ?? LOOX_MIN_GAP_MS;

  return {
    async listReviews({ page = 1, limit = 50 }): Promise<LooxReviewsPage> {
      const wait = minGap - (Date.now() - lastCallAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const url = `${baseUrl}/store/${encodeURIComponent(publicStoreId)}/product-reviews?page=${page}&limit=${limit}`;
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: "GET",
          headers: { "X-Api-Secret-Key": apiKey },
        });
      } finally {
        lastCallAt = Date.now();
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Loox API ${res.status}: ${text.slice(0, 160)}`);
      }
      return (await res.json()) as LooxReviewsPage;
    },
  };
}

type CacheEntry = { client: LooxClient; expiresAt: number };
const cache = new Map<string, CacheEntry>();

export async function getLooxClient(args: {
  ssmPrefix: string;
}): Promise<LooxClient> {
  const now = Date.now();
  const hit = cache.get(args.ssmPrefix);
  if (hit && hit.expiresAt > now) return hit.client;

  const [storeId, apiKey] = await Promise.all([
    getSecret(`${args.ssmPrefix}/loox/public_store_id`),
    getSecret(`${args.ssmPrefix}/loox/api_key`),
  ]);
  if (storeId === "REPLACE_ME" || apiKey === "REPLACE_ME") {
    throw new Error(
      `Loox credentials for ${args.ssmPrefix} are placeholder values. Set ${args.ssmPrefix}/loox/public_store_id and ${args.ssmPrefix}/loox/api_key with the tenant's Loox store id + API key.`,
    );
  }
  const client = buildLooxClient(storeId, apiKey);
  cache.set(args.ssmPrefix, { client, expiresAt: now + CLIENT_CACHE_TTL_MS });
  return client;
}

export function __clearLooxClientCacheForTesting(): void {
  cache.clear();
}
