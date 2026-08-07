import type { AdminApiClient } from "@shopify/admin-api-client";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../mcp/types.js";

vi.mock("../../clients/shopify.js", () => ({
  getShopifyClient: vi.fn(),
}));

import { getShopifyClient } from "../../clients/shopify.js";
import { verifyCampaignPriceAlignmentHandler } from "./verify-campaign-price-alignment.js";

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

function variant(overrides: Partial<{ title: string; sku: string | null; price: string; compareAtPrice: string | null }>) {
  return { id: "gid://shopify/ProductVariant/1", title: "Default Title", sku: "GEB 001", price: "80.75", compareAtPrice: null, ...overrides };
}

beforeEach(() => {
  vi.mocked(getShopifyClient).mockReset();
});

describe("verifyCampaignPriceAlignmentHandler", () => {
  it("passes when price matches compareAtPrice x (1 - discount)", async () => {
    const res = {
      data: {
        products: {
          pageInfo: { hasNextPage: false, endCursor: null },
          edges: [
            {
              node: {
                id: "gid://shopify/Product/1",
                title: "Shampoo",
                variants: { edges: [{ node: variant({ price: "64.00", compareAtPrice: "80.00" }) }] },
              },
            },
          ],
        },
      },
    };
    vi.mocked(getShopifyClient).mockResolvedValue(scriptedClient(res));

    const out = await verifyCampaignPriceAlignmentHandler(
      { campaignTag: "consumidor-20", discountPercent: 0.2 },
      makeCtx(),
    );
    expect(out.isError).toBeUndefined();
    expect(out.content[0]?.text ?? "").toContain("all 1 variant(s) aligned");
  });

  it("flags a variant whose price doesn't match the claimed discount", async () => {
    const res = {
      data: {
        products: {
          pageInfo: { hasNextPage: false, endCursor: null },
          edges: [
            {
              node: {
                id: "gid://shopify/Product/1",
                title: "Shampoo",
                // compareAt 80, claimed 20% off should be 64, but price is still 70 (drift)
                variants: { edges: [{ node: variant({ price: "70.00", compareAtPrice: "80.00" }) }] },
              },
            },
          ],
        },
      },
    };
    vi.mocked(getShopifyClient).mockResolvedValue(scriptedClient(res));

    const out = await verifyCampaignPriceAlignmentHandler(
      { campaignTag: "consumidor-20", discountPercent: 0.2 },
      makeCtx(),
    );
    expect(out.isError).toBe(true);
    const text = out.content[0]?.text ?? "";
    expect(text).toContain("1 price mismatch(es)");
    expect(text).toContain("expected 64.00 at 20%");
  });

  it("flags a variant with no compareAtPrice as missing the discount entirely", async () => {
    const res = {
      data: {
        products: {
          pageInfo: { hasNextPage: false, endCursor: null },
          edges: [
            {
              node: {
                id: "gid://shopify/Product/1",
                title: "Shampoo",
                variants: { edges: [{ node: variant({ price: "80.75", compareAtPrice: null }) }] },
              },
            },
          ],
        },
      },
    };
    vi.mocked(getShopifyClient).mockResolvedValue(scriptedClient(res));

    const out = await verifyCampaignPriceAlignmentHandler(
      { campaignTag: "consumidor-20", discountPercent: 0.2 },
      makeCtx(),
    );
    expect(out.isError).toBe(true);
    expect(out.content[0]?.text ?? "").toContain("1 missing/invalid compareAtPrice");
  });

  it("rejects an out-of-range discountPercent", async () => {
    const out = await verifyCampaignPriceAlignmentHandler(
      { campaignTag: "x", discountPercent: 1.5 },
      makeCtx(),
    );
    expect(out.isError).toBe(true);
  });
});
