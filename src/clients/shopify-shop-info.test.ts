import type { AdminApiClient } from "@shopify/admin-api-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearShopInfoCacheForTesting,
  getShopTimezone,
} from "./shopify-shop-info.js";

function fakeClient(
  responses: Array<
    | { data: { shop: { ianaTimezone: string } } }
    | { errors: { message: string } }
    | { data: null }
  >,
): AdminApiClient {
  const request = vi.fn(async () => responses.shift() ?? { data: null });
  return { request } as unknown as AdminApiClient;
}

beforeEach(() => {
  __clearShopInfoCacheForTesting();
});

afterEach(() => {
  __clearShopInfoCacheForTesting();
});

describe("getShopTimezone", () => {
  it("returns the shop's IANA timezone", async () => {
    const client = fakeClient([
      { data: { shop: { ianaTimezone: "America/Sao_Paulo" } } },
    ]);
    const tz = await getShopTimezone({
      shopifyShop: "gebeauty.myshopify.com",
      client,
    });
    expect(tz).toBe("America/Sao_Paulo");
  });

  it("caches per shop domain within TTL", async () => {
    const request = vi.fn(async () => ({
      data: { shop: { ianaTimezone: "America/Sao_Paulo" } },
    }));
    const client = { request } as unknown as AdminApiClient;

    const a = await getShopTimezone({ shopifyShop: "x.myshopify.com", client });
    const b = await getShopTimezone({ shopifyShop: "x.myshopify.com", client });

    expect(a).toBe("America/Sao_Paulo");
    expect(b).toBe("America/Sao_Paulo");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("refetches after TTL expires", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: { shop: { ianaTimezone: "UTC" } } })
      .mockResolvedValueOnce({
        data: { shop: { ianaTimezone: "America/Sao_Paulo" } },
      });
    const client = { request } as unknown as AdminApiClient;

    let clock = 1_000_000;
    const now = () => clock;
    const a = await getShopTimezone({
      shopifyShop: "x.myshopify.com",
      client,
      ttlMs: 1000,
      now,
    });
    clock += 2000;
    const b = await getShopTimezone({
      shopifyShop: "x.myshopify.com",
      client,
      ttlMs: 1000,
      now,
    });

    expect(a).toBe("UTC");
    expect(b).toBe("America/Sao_Paulo");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("throws when Shopify returns errors", async () => {
    const client = fakeClient([{ errors: { message: "forbidden" } }]);
    await expect(
      getShopTimezone({ shopifyShop: "x.myshopify.com", client }),
    ).rejects.toThrow(/Failed to fetch shop timezone .*forbidden/);
  });
});
