import type { AdminApiClient } from "@shopify/admin-api-client";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../mcp/types.js";

vi.mock("../../clients/shopify.js", () => ({
  getShopifyClient: vi.fn(),
}));

import { getShopifyClient } from "../../clients/shopify.js";
import { updateProductPriceHandler } from "./update-product-price.js";

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

type Resp = unknown;

function scriptedClient(responses: Resp[]): AdminApiClient {
  const request = vi.fn(async () => responses.shift() ?? null);
  return { request } as unknown as AdminApiClient;
}

const variantPayload = {
  data: {
    productVariant: {
      id: "gid://shopify/ProductVariant/11",
      title: "50ml",
      displayName: "Shampoo · 50ml",
      price: "79.90",
      compareAtPrice: null,
      sku: "GE-01",
      product: { id: "gid://shopify/Product/1", title: "Shampoo" },
    },
  },
};

beforeEach(() => {
  vi.mocked(getShopifyClient).mockReset();
});

describe("updateProductPriceHandler — preview", () => {
  it("returns a preview without calling the mutation", async () => {
    const client = scriptedClient([variantPayload]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await updateProductPriceHandler(
      { variantId: "11", price: "59.90" },
      makeCtx(),
    );
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("Preview (no changes made yet)");
    expect(text).toContain("Current price: 79.90");
    expect(text).toContain("New price:     59.90");
    expect(text).toContain("confirm: true");
    // Only the lookup should have fired, not the mutation.
    expect((client.request as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(
      1,
    );
  });

  it("surfaces 'not found' when the variant does not exist", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      scriptedClient([{ data: { productVariant: null } }]),
    );
    const res = await updateProductPriceHandler(
      { variantId: "99999", price: "10.00" },
      makeCtx(),
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("No variant found");
  });
});

describe("updateProductPriceHandler — confirm", () => {
  it("executes the mutation when confirm=true and reports success", async () => {
    const client = scriptedClient([
      variantPayload,
      {
        data: {
          productVariantsBulkUpdate: {
            productVariants: [
              { id: "gid://shopify/ProductVariant/11", price: "59.90" },
            ],
            userErrors: [],
          },
        },
      },
    ]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await updateProductPriceHandler(
      { variantId: "11", price: "59.90", confirm: true },
      makeCtx(),
    );
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text).toContain(
      "price is now 59.90",
    );
    expect((client.request as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(
      2,
    );
  });

  it("surfaces userErrors as an isError result", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      scriptedClient([
        variantPayload,
        {
          data: {
            productVariantsBulkUpdate: {
              productVariants: null,
              userErrors: [
                {
                  field: ["variants", "0", "price"],
                  message: "Price must be non-negative.",
                },
              ],
            },
          },
        },
      ]),
    );

    const res = await updateProductPriceHandler(
      { variantId: "11", price: "-1", confirm: true },
      makeCtx(),
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("Price must be non-negative");
  });
});
