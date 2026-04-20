import type { AdminApiClient } from "@shopify/admin-api-client";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../mcp/types.js";

vi.mock("../../clients/shopify.js", () => ({
  getShopifyClient: vi.fn(),
}));

// Imports below must come after vi.mock so find-order.ts sees the stub.
import { getShopifyClient } from "../../clients/shopify.js";
import { findOrderHandler } from "./find-order.js";

const silentLogger = pino({ level: "silent" });

function makeCtx(): ToolContext {
  return {
    tenant: {
      id: "t_test",
      slug: "test",
      displayName: "Test Tenant",
      brand: "cpg_labs",
      shopifyShop: "test-shop.myshopify.com",
      ssmPrefix: "/nami-works/tenants/test",
    },
    logger: silentLogger,
    requestId: "req_test",
  };
}

function fakeShopifyClient(response: unknown): AdminApiClient {
  const request = vi.fn().mockResolvedValue(response);
  return { request } as unknown as AdminApiClient;
}

beforeEach(() => {
  vi.mocked(getShopifyClient).mockReset();
});

describe("findOrderHandler", () => {
  it("formats an order summary when one is found", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      fakeShopifyClient({
        data: {
          orders: {
            edges: [
              {
                node: {
                  id: "gid://shopify/Order/1",
                  name: "#1001",
                  email: "buyer@example.com",
                  createdAt: "2026-04-20T12:00:00Z",
                  processedAt: null,
                  displayFinancialStatus: "PAID",
                  displayFulfillmentStatus: "UNFULFILLED",
                  totalPriceSet: {
                    shopMoney: { amount: "250.00", currencyCode: "BRL" },
                  },
                  customer: {
                    firstName: "Ana",
                    lastName: "Costa",
                    email: "ana@example.com",
                    phone: null,
                  },
                  lineItems: {
                    edges: [
                      {
                        node: {
                          title: "Shampoo",
                          quantity: 2,
                          variant: { sku: "GE-01" },
                          originalUnitPriceSet: {
                            shopMoney: {
                              amount: "125.00",
                              currencyCode: "BRL",
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
      }),
    );

    const result = await findOrderHandler({ nameOrId: "1001" }, makeCtx());
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Order #1001");
    expect(text).toContain("Ana Costa");
    expect(text).toContain("250.00 BRL");
    expect(text).toContain("2x Shampoo [GE-01]");
    expect(text).toContain("PAID");
    expect(result.isError).toBeUndefined();
  });

  it("returns a clean not-found message when no order matches", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      fakeShopifyClient({ data: { orders: { edges: [] } } }),
    );
    const result = await findOrderHandler({ nameOrId: "9999" }, makeCtx());
    expect(result.content[0]?.text).toContain(
      'No order found matching "9999".',
    );
    expect(result.isError).toBeUndefined();
  });

  it("throws on GraphQL errors so the registry wrapper marks it as an error", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      fakeShopifyClient({ errors: { message: "rate limited" } }),
    );
    await expect(
      findOrderHandler({ nameOrId: "1" }, makeCtx()),
    ).rejects.toThrow(/Shopify GraphQL error: rate limited/);
  });
});
