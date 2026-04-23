import type { AdminApiClient } from "@shopify/admin-api-client";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../mcp/types.js";

vi.mock("../../clients/shopify.js", () => ({
  getShopifyClient: vi.fn(),
}));

import { getShopifyClient } from "../../clients/shopify.js";
import { auditCampaignConsistencyHandler } from "./audit-campaign-consistency.js";

const silentLogger = pino({ level: "silent" });

function makeCtx(): ToolContext {
  return {
    tenant: {
      id: "t_test",
      slug: "test",
      displayName: "Test",
      brand: "cpg_labs",
      shopifyShop: "test.myshopify.com",
      ssmPrefix: "/nami-works/tenants/test",
    },
    logger: silentLogger,
    requestId: "req_test",
  };
}

function fakeClient(response: unknown): AdminApiClient {
  return {
    request: vi.fn().mockResolvedValue(response),
  } as unknown as AdminApiClient;
}

function product(title: string, v: { price: string; compareAtPrice: string | null }) {
  return {
    node: {
      id: `gid://shopify/Product/${title}`,
      title,
      variants: {
        edges: [
          {
            node: {
              id: "v1",
              sku: `${title}-SKU`,
              price: v.price,
              compareAtPrice: v.compareAtPrice,
            },
          },
        ],
      },
    },
  };
}

beforeEach(() => {
  vi.mocked(getShopifyClient).mockReset();
});

describe("auditCampaignConsistencyHandler", () => {
  it("rejects empty campaignTag", async () => {
    const res = await auditCampaignConsistencyHandler(
      { campaignTag: "  " },
      makeCtx(),
    );
    expect(res.isError).toBe(true);
  });

  it("reports consistency when every product is discounted", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      fakeClient({
        data: {
          products: {
            edges: [
              product("A", { price: "80", compareAtPrice: "100" }),
              product("B", { price: "90", compareAtPrice: "120" }),
            ],
          },
        },
      }),
    );
    const res = await auditCampaignConsistencyHandler(
      { campaignTag: "BEAUTYBACK" },
      makeCtx(),
    );
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text).toContain("consistente");
    expect(res.content[0]?.text).toContain("todos em promoção");
  });

  it("reports consistency when no product is discounted", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      fakeClient({
        data: {
          products: {
            edges: [
              product("A", { price: "100", compareAtPrice: null }),
              product("B", { price: "120", compareAtPrice: null }),
            ],
          },
        },
      }),
    );
    const res = await auditCampaignConsistencyHandler(
      { campaignTag: "BEAUTYBACK" },
      makeCtx(),
    );
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text).toContain("nenhum em promoção");
  });

  it("flags inconsistency and surfaces the minority", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      fakeClient({
        data: {
          products: {
            edges: [
              product("A", { price: "80", compareAtPrice: "100" }),
              product("B", { price: "90", compareAtPrice: "120" }),
              product("C", { price: "100", compareAtPrice: null }),
            ],
          },
        },
      }),
    );
    const res = await auditCampaignConsistencyHandler(
      { campaignTag: "BEAUTYBACK" },
      makeCtx(),
    );
    expect(res.isError).toBe(true);
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("INCONSISTENTE");
    expect(text).toContain("2 produto(s) em promoção, 1 sem promoção");
    expect(text).toContain("C"); // minority surface
    expect(text).toContain("NÃO estão em promoção");
  });

  it("returns empty-state message when tag matches no products", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      fakeClient({ data: { products: { edges: [] } } }),
    );
    const res = await auditCampaignConsistencyHandler(
      { campaignTag: "DOES_NOT_EXIST" },
      makeCtx(),
    );
    expect(res.content[0]?.text).toContain("Nenhum produto encontrado");
  });
});
