import type { AdminApiClient } from "@shopify/admin-api-client";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../mcp/types.js";

vi.mock("../../clients/shopify.js", () => ({
  getShopifyClient: vi.fn(),
}));

import { getShopifyClient } from "../../clients/shopify.js";
import { listDeadCollectionsHandler } from "./list-dead-collections.js";

const silentLogger = pino({ level: "silent" });

function makeCtx(): ToolContext {
  return {
    tenant: {
      id: "t_test",
      slug: "test",
      displayName: "Test",
      brand: "cpg_labs",
      shopifyShop: "test-shop.myshopify.com",
      ssmPrefix: "/nami-works/tenants/test",
      role: "operator",
      principalId: null,
      actorLabel: null,
      access: { isOwner: true, systems: {} },
    },
    logger: silentLogger,
    requestId: "req_test",
  };
}

function scriptedClient(response: unknown): AdminApiClient {
  return { request: async () => response } as unknown as AdminApiClient;
}

describe("listDeadCollectionsHandler", () => {
  it("filters to 0-product collections and shows rules for smart collections", async () => {
    const res = {
      data: {
        collections: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            { id: "gid://shopify/Collection/1", title: "Boosters", handle: "boosters", sortOrder: "BEST_SELLING", productsCount: { count: 5 }, ruleSet: null },
            {
              id: "gid://shopify/Collection/2",
              title: "Ex-Promo",
              handle: "ex-promo",
              sortOrder: "MANUAL",
              productsCount: { count: 0 },
              ruleSet: { appliedDisjunctively: false, rules: [{ column: "TAG", relation: "EQUALS", condition: "ex-promo-2024" }] },
            },
            {
              id: "gid://shopify/Collection/3",
              title: "Old Manual List",
              handle: "old-manual",
              sortOrder: "MANUAL",
              productsCount: { count: 0 },
              ruleSet: null,
            },
          ],
        },
      },
    };
    const client = scriptedClient(res);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const out = await listDeadCollectionsHandler({}, makeCtx());
    const text = out.content[0]?.text ?? "";
    expect(text).toContain("2/3 collections have 0 products");
    expect(text).not.toContain("Boosters");
    expect(text).toContain('Ex-Promo (ex-promo) — smart collection, 0 products. Rules: TAG EQUALS "ex-promo-2024"');
    expect(text).toContain("Old Manual List (old-manual) — manual collection, 0 products (nothing added)");
  });

  it("reports no dead collections when all have products", async () => {
    const res = {
      data: {
        collections: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            { id: "gid://shopify/Collection/1", title: "Boosters", handle: "boosters", sortOrder: "BEST_SELLING", productsCount: { count: 5 }, ruleSet: null },
          ],
        },
      },
    };
    vi.mocked(getShopifyClient).mockResolvedValue(scriptedClient(res));

    const out = await listDeadCollectionsHandler({}, makeCtx());
    expect(out.content[0]?.text ?? "").toContain("No dead collections");
  });
});

beforeEach(() => {
  vi.mocked(getShopifyClient).mockReset();
});
