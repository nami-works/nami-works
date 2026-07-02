import type { AdminApiClient } from "@shopify/admin-api-client";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../mcp/types.js";

vi.mock("../../clients/shopify.js", () => ({
  getShopifyClient: vi.fn(),
}));

import { getShopifyClient } from "../../clients/shopify.js";
import { applyPriceTagHandler } from "./apply-price-tag.js";

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
    },
    logger: silentLogger,
    requestId: "req_test",
  };
}

function scriptedClient(responses: unknown[]): AdminApiClient {
  const request = vi.fn(async () => responses.shift() ?? null);
  return { request } as unknown as AdminApiClient;
}

const threeProducts = {
  data: {
    nodes: [
      {
        __typename: "Product",
        id: "gid://shopify/Product/1",
        title: "Shampoo",
        tags: [],
      },
      {
        __typename: "Product",
        id: "gid://shopify/Product/2",
        title: "Conditioner",
        tags: ["lancto"],
      },
      {
        __typename: "Product",
        id: "gid://shopify/Product/3",
        title: "Oil",
        tags: [],
      },
    ],
  },
};

beforeEach(() => {
  vi.mocked(getShopifyClient).mockReset();
});

describe("applyPriceTagHandler — preview", () => {
  it("lists affected + already-tagged products without mutating", async () => {
    const client = scriptedClient([threeProducts]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await applyPriceTagHandler(
      { productIds: ["1", "2", "3"], tag: "lancto" },
      makeCtx(),
    );
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("Preview (no changes made yet)");
    expect(text).toContain("Will affect 2 product(s)");
    expect(text).toContain("Shampoo");
    expect(text).toContain("Oil");
    expect(text).toContain("Already tagged");
    expect(text).toContain("Conditioner");
    expect((client.request as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(
      1,
    );
  });
});

describe("applyPriceTagHandler — confirm", () => {
  it("tags only products that don't already have the tag", async () => {
    const successNode = (id: string) => ({
      data: {
        tagsAdd: {
          node: { id },
          userErrors: [],
        },
      },
    });
    const client = scriptedClient([
      threeProducts,
      successNode("gid://shopify/Product/1"),
      successNode("gid://shopify/Product/3"),
    ]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await applyPriceTagHandler(
      { productIds: ["1", "2", "3"], tag: "lancto", confirm: true },
      makeCtx(),
    );
    expect(res.isError).toBeUndefined();
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("Applied tag \"lancto\" to 2/2 product(s)");
    // 1 lookup + 2 tag mutations (Conditioner skipped)
    expect((client.request as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(
      3,
    );
  });

  it("surfaces per-product userErrors", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      scriptedClient([
        threeProducts,
        {
          data: {
            tagsAdd: {
              node: null,
              userErrors: [
                { field: ["tags"], message: "Tag contains illegal char." },
              ],
            },
          },
        },
        {
          data: {
            tagsAdd: {
              node: { id: "gid://shopify/Product/3" },
              userErrors: [],
            },
          },
        },
      ]),
    );

    const res = await applyPriceTagHandler(
      { productIds: ["1", "2", "3"], tag: "lancto", confirm: true },
      makeCtx(),
    );
    expect(res.isError).toBe(true);
    const text = res.content[0]?.text ?? "";
    // Conditioner already has "lancto", so needsTag = [Shampoo, Oil].
    // Scripted: Shampoo → userError, Oil → success. So 1/2 applied.
    expect(text).toContain("Applied tag \"lancto\" to 1/2");
    expect(text).toContain("Tag contains illegal char");
  });

  it("returns a no-op message when every product already has the tag", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      scriptedClient([
        {
          data: {
            nodes: [
              {
                __typename: "Product",
                id: "gid://shopify/Product/1",
                title: "Shampoo",
                tags: ["lancto"],
              },
            ],
          },
        },
      ]),
    );

    const res = await applyPriceTagHandler(
      { productIds: ["1"], tag: "lancto", confirm: true },
      makeCtx(),
    );
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text).toContain("No-op");
  });
});
