import type { AdminApiClient } from "@shopify/admin-api-client";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../mcp/types.js";

vi.mock("../../clients/shopify.js", () => ({
  getShopifyClient: vi.fn(),
}));

import { getShopifyClient } from "../../clients/shopify.js";
import { issueStoreCreditHandler } from "./issue-store-credit.js";

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

describe("issueStoreCreditHandler — validation", () => {
  it("rejects a non-numeric, non-GID customerId", async () => {
    const res = await issueStoreCreditHandler(
      { customerId: "not-an-id", amount: "10.00" },
      makeCtx(),
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("customerId must be");
  });

  it("rejects an amount with too many decimals", async () => {
    const res = await issueStoreCreditHandler(
      { customerId: "123", amount: "10.001" },
      makeCtx(),
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("up to 2 decimal places");
  });

  it("rejects a zero or negative amount", async () => {
    const res = await issueStoreCreditHandler(
      { customerId: "123", amount: "0.00" },
      makeCtx(),
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("greater than 0");
  });
});

describe("issueStoreCreditHandler — preview", () => {
  it("returns a preview (no mutation) without confirm", async () => {
    const client = scriptedClient([]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await issueStoreCreditHandler(
      {
        customerId: "123",
        amount: "20.00",
        sourceOrderName: "#77793",
      },
      makeCtx(),
    );
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("Preview (no changes made yet)");
    expect(text).toContain("gid://shopify/Customer/123");
    expect(text).toContain("20.00 BRL");
    expect(text).toContain("#77793");
    expect(text).toContain("confirm: true");
    expect((client.request as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(
      0,
    );
  });

  it("accepts a full GID and echoes it back in the preview", async () => {
    const client = scriptedClient([]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await issueStoreCreditHandler(
      {
        customerId: "gid://shopify/Customer/456",
        amount: "5.50",
        currencyCode: "USD",
      },
      makeCtx(),
    );
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("gid://shopify/Customer/456");
    expect(text).toContain("5.50 USD");
  });
});

describe("issueStoreCreditHandler — confirm", () => {
  it("credits the customer and reports the new balance", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      scriptedClient([
        {
          data: {
            storeCreditAccountCredit: {
              storeCreditAccountTransaction: {
                id: "gid://shopify/StoreCreditAccountCreditTransaction/9001",
                amount: { amount: "20.00", currencyCode: "BRL" },
                balanceAfterTransaction: {
                  amount: "35.00",
                  currencyCode: "BRL",
                },
                account: { id: "gid://shopify/StoreCreditAccount/77" },
              },
              userErrors: [],
            },
          },
        },
      ]),
    );

    const res = await issueStoreCreditHandler(
      { customerId: "123", amount: "20.00", confirm: true },
      makeCtx(),
    );
    expect(res.isError).toBeUndefined();
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("Credited 20.00 BRL");
    expect(text).toContain("New balance: 35.00 BRL");
    expect(text).toContain("StoreCreditAccountCreditTransaction/9001");
    expect(text).toContain("StoreCreditAccount/77");
  });

  it("surfaces Shopify userErrors", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      scriptedClient([
        {
          data: {
            storeCreditAccountCredit: {
              storeCreditAccountTransaction: null,
              userErrors: [
                {
                  field: ["id"],
                  message: "Customer not found.",
                  code: "NOT_FOUND",
                },
              ],
            },
          },
        },
      ]),
    );

    const res = await issueStoreCreditHandler(
      { customerId: "999999", amount: "20.00", confirm: true },
      makeCtx(),
    );
    expect(res.isError).toBe(true);
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("Customer not found");
    expect(text).toContain("[NOT_FOUND]");
  });
});
