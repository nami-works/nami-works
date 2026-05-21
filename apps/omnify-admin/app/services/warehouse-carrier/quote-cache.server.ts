/**
 * Read-through cache layer over WarehouseCarrierQuoteCache.
 *
 *   getOrFetchQuote(shop, orderId, provider, req) →
 *     1. Look up cache entry where expiresAt > now()
 *     2. If hit → return result with cached: true
 *     3. If miss → call quoteForShop()
 *     4. On success → upsert cache with expiresAt = now() + ttlDays
 *     5. On error → return error (do NOT cache errors)
 *
 * TTL comes from LdAnalyticsConfig.quoteCacheTtlDays (default 90).
 *
 * See docs/plans/local-delivery-analytics.md §4.4.
 */

import { Prisma } from "@prisma/client";
import prisma from "../../db.server";
import { quoteForShop } from "./aggregator.server";
import type {
  WarehouseProviderId,
  WarehouseQuoteError,
  WarehouseQuoteRequest,
  WarehouseQuoteResult,
} from "./types";

const DEFAULT_TTL_DAYS = 90;

export type CachedQuote = {
  result: WarehouseQuoteResult;
  cached: boolean;
};

export type CachedQuoteFailure = {
  error: WarehouseQuoteError | { errorCode: "no_carrier"; message: string; retryable: false };
};

export async function getCacheTtlDays(shop: string): Promise<number> {
  const cfg = await prisma.ldAnalyticsConfig.findUnique({
    where: { shop },
    select: { quoteCacheTtlDays: true },
  });
  return cfg?.quoteCacheTtlDays ?? DEFAULT_TTL_DAYS;
}

/** Look up a cached quote that hasn't expired. */
export async function readCache(
  shop: string,
  orderId: string,
  provider: WarehouseProviderId,
): Promise<WarehouseQuoteResult | null> {
  const row = await prisma.warehouseCarrierQuoteCache.findUnique({
    where: { shop_orderId_provider: { shop, orderId, provider } },
  });
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    return null;
  }
  return {
    provider: row.provider as WarehouseProviderId,
    priceSubunits: row.priceSubunits,
    currency: row.currency,
    minDeliveryDate: row.minDeliveryDate ?? undefined,
    maxDeliveryDate: row.maxDeliveryDate ?? undefined,
    raw: row.rawResponseJson ?? undefined,
  };
}

/** Persist a successful quote into the cache. */
export async function writeCache(
  shop: string,
  orderId: string,
  result: WarehouseQuoteResult,
  ttlDays: number,
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  await prisma.warehouseCarrierQuoteCache.upsert({
    where: {
      shop_orderId_provider: { shop, orderId, provider: result.provider },
    },
    create: {
      shop,
      orderId,
      provider: result.provider,
      priceSubunits: result.priceSubunits,
      currency: result.currency,
      minDeliveryDate: result.minDeliveryDate ?? null,
      maxDeliveryDate: result.maxDeliveryDate ?? null,
      rawResponseJson: (result.raw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      expiresAt,
    },
    update: {
      priceSubunits: result.priceSubunits,
      currency: result.currency,
      minDeliveryDate: result.minDeliveryDate ?? null,
      maxDeliveryDate: result.maxDeliveryDate ?? null,
      rawResponseJson: (result.raw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      quotedAt: new Date(),
      expiresAt,
    },
  });
}

/**
 * Read-through fetch. Errors are surfaced; never cached.
 */
export async function getOrFetchQuote(
  shop: string,
  orderId: string,
  provider: WarehouseProviderId,
  req: WarehouseQuoteRequest,
): Promise<CachedQuote | CachedQuoteFailure> {
  const cached = await readCache(shop, orderId, provider);
  if (cached) {
    return { result: cached, cached: true };
  }

  const result = await quoteForShop(shop, req);
  if (result === null) {
    return {
      error: {
        errorCode: "no_carrier",
        message: "no warehouse carrier configured for shop",
        retryable: false,
      },
    };
  }
  if ("errorCode" in result) {
    return { error: result };
  }

  const ttlDays = await getCacheTtlDays(shop);
  try {
    await writeCache(shop, orderId, result, ttlDays);
  } catch (error) {
    // Logging cache-write failures is fine; we still return the live result.
    console.warn(
      `[ld-analytics:warehouse-carrier] cache write FAILED shop=${shop} orderId=${orderId} provider=${provider}`,
      error,
    );
  }
  return { result, cached: false };
}

/** Purge expired cache entries for a shop (housekeeping). */
export async function purgeExpired(shop: string): Promise<number> {
  const res = await prisma.warehouseCarrierQuoteCache.deleteMany({
    where: { shop, expiresAt: { lte: new Date() } },
  });
  if (res.count > 0) {
    console.info(
      `[ld-analytics:warehouse-carrier] cache purged shop=${shop} expiredCount=${res.count}`,
    );
  }
  return res.count;
}
