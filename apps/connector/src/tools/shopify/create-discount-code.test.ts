import type { AdminApiClient } from "@shopify/admin-api-client";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../mcp/types.js";

vi.mock("../../clients/shopify.js", () => ({
  getShopifyClient: vi.fn(),
}));

import { getShopifyClient } from "../../clients/shopify.js";
import { createDiscountCodeHandler } from "./create-discount-code.js";

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

beforeEach(() => {
  vi.mocked(getShopifyClient).mockReset();
});

describe("createDiscountCodeHandler — validation", () => {
  it("rejects if neither percentageOff nor amountOff is provided", async () => {
    const res = await createDiscountCodeHandler(
      { code: "FOO" },
      makeCtx(),
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("Provide exactly one");
  });

  it("rejects if both percentageOff and amountOff are provided", async () => {
    const res = await createDiscountCodeHandler(
      {
        code: "FOO",
        percentageOff: 0.1,
        amountOff: { amount: "10", currencyCode: "BRL" },
      },
      makeCtx(),
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("only one of");
  });
});

describe("createDiscountCodeHandler — preview", () => {
  it("returns a preview (no mutation) without confirm", async () => {
    const client = scriptedClient([]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await createDiscountCodeHandler(
      {
        code: "BEAUTYBACK10",
        percentageOff: 0.1,
        appliesOncePerCustomer: true,
      },
      makeCtx(),
    );
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("Preview (no changes made yet)");
    expect(text).toContain("Discount code: BEAUTYBACK10");
    expect(text).toContain("10% off");
    expect(text).toContain("Applies once per customer: yes");
    expect(text).toContain("confirm: true");
    // Preview never hits Shopify.
    expect((client.request as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(
      0,
    );
  });
});

describe("createDiscountCodeHandler — confirm", () => {
  it("creates a percentage discount and reports the GID", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      scriptedClient([
        {
          data: {
            discountCodeBasicCreate: {
              codeDiscountNode: {
                id: "gid://shopify/DiscountCodeNode/42",
              },
              userErrors: [],
            },
          },
        },
      ]),
    );

    const res = await createDiscountCodeHandler(
      {
        code: "BEAUTYBACK10",
        percentageOff: 0.1,
        confirm: true,
      },
      makeCtx(),
    );
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text).toContain('Created discount code "BEAUTYBACK10"');
    expect(res.content[0]?.text).toContain("10% off");
    expect(res.content[0]?.text).toContain("DiscountCodeNode/42");
  });

  it("surfaces Shopify userErrors", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      scriptedClient([
        {
          data: {
            discountCodeBasicCreate: {
              codeDiscountNode: null,
              userErrors: [
                {
                  field: ["code"],
                  message: "Code already exists.",
                  code: "TAKEN",
                },
              ],
            },
          },
        },
      ]),
    );

    const res = await createDiscountCodeHandler(
      {
        code: "EXISTINGCODE",
        percentageOff: 0.1,
        confirm: true,
      },
      makeCtx(),
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("Code already exists");
    expect(res.content[0]?.text).toContain("[TAKEN]");
  });
});
