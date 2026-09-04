import type { AdminApiClient } from "@shopify/admin-api-client";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../clients/shopify.js", () => ({
  getShopifyClient: vi.fn(),
}));
vi.mock("../db/prisma.js", () => ({
  prisma: {
    justBoughtCreditIssuance: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { getShopifyClient } from "../clients/shopify.js";
import { prisma } from "../db/prisma.js";
import { handleOrdersPaidWebhook, issuePendingCredit, type WebhookLog } from "./just-bought-credit.js";

const silentLog: WebhookLog = pino({ level: "silent" }) as unknown as WebhookLog;

const createMock = vi.mocked(prisma.justBoughtCreditIssuance.create);
const updateMock = vi.mocked(prisma.justBoughtCreditIssuance.update);
const getShopifyClientMock = vi.mocked(getShopifyClient);

function scriptedClient(responses: unknown[]): AdminApiClient {
  const request = vi.fn(async () => responses.shift() ?? { data: {} });
  return { request } as unknown as AdminApiClient;
}

function baseCtx() {
  return { tenantId: "t_gebeauty", ssmPrefix: "/nami-works/tenants/gebeauty", shopifyShop: "gebeauty.myshopify.com", log: silentLog };
}

beforeEach(() => {
  createMock.mockReset();
  updateMock.mockReset();
  getShopifyClientMock.mockReset();
});

describe("handleOrdersPaidWebhook — 72h hold", () => {
  it("writes a pending_hold row with holdUntil ~72h out and never calls a credit mutation", async () => {
    getShopifyClientMock.mockResolvedValue(
      scriptedClient([{ data: { order: { shippingAddress: null } } }]),
    );
    createMock.mockResolvedValue({} as never);

    await handleOrdersPaidWebhook(
      {
        id: 1,
        admin_graphql_api_id: "gid://shopify/Order/1",
        current_total_price: "200.00",
        customer: { admin_graphql_api_id: "gid://shopify/Customer/1" },
      },
      baseCtx(),
    );

    expect(createMock).toHaveBeenCalledTimes(1);
    const data = createMock.mock.calls[0]![0]!.data as Record<string, unknown>;
    expect(data.status).toBe("pending_hold");
    expect(data.creditAmount).toBe(40); // 20% of 200
    const createdAt = data.createdAt as Date;
    const holdUntil = data.holdUntil as Date;
    const hoursApart = (holdUntil.getTime() - createdAt.getTime()) / (60 * 60 * 1000);
    expect(hoursApart).toBeCloseTo(72, 1);

    // No mutation call at all in the orders/paid path — only the
    // shipping-address query ran against the client.
    const client = await getShopifyClientMock.mock.results[0]!.value;
    expect((client as AdminApiClient).request).toHaveBeenCalledTimes(1);
  });

  it("forces armDays to 60 and skips the shipping-address lookup's random draw when there's no shipping address", async () => {
    getShopifyClientMock.mockResolvedValue(
      scriptedClient([{ data: { order: { shippingAddress: null } } }]),
    );
    createMock.mockResolvedValue({} as never);

    await handleOrdersPaidWebhook(
      {
        id: 2,
        admin_graphql_api_id: "gid://shopify/Order/2",
        current_total_price: "300.00",
        customer: { admin_graphql_api_id: "gid://shopify/Customer/2" },
      },
      baseCtx(),
    );

    const data = createMock.mock.calls[0]![0]!.data as Record<string, unknown>;
    expect(data.armDays).toBe(60);
    expect(data.armForcedReason).toBe("pickup_or_instore");
  });

  it("skips the hold entirely (status skipped_floor, no holdUntil) when credit is below the floor", async () => {
    createMock.mockResolvedValue({} as never);

    await handleOrdersPaidWebhook(
      {
        id: 3,
        admin_graphql_api_id: "gid://shopify/Order/3",
        current_total_price: "10.00", // 20% = 2.00, below the 10.00 floor
        customer: { admin_graphql_api_id: "gid://shopify/Customer/3" },
      },
      baseCtx(),
    );

    const data = createMock.mock.calls[0]![0]!.data as Record<string, unknown>;
    expect(data.status).toBe("skipped_floor");
    expect(data.holdUntil).toBeNull();
    // Below-floor orders never need the shipping-address lookup.
    expect(getShopifyClientMock).not.toHaveBeenCalled();
  });
});

describe("issuePendingCredit", () => {
  it("grants credit, tags, and marks the row issued", async () => {
    const client = scriptedClient([
      { data: { storeCreditAccountCredit: { storeCreditAccountTransaction: { id: "txn_1" }, userErrors: [] } } },
      { data: { tagsAdd: { userErrors: [] } } },
    ]);
    updateMock.mockResolvedValue({} as never);

    await issuePendingCredit(
      {
        id: "row_1",
        shopifyOrderId: "gid://shopify/Order/1",
        customerGid: "gid://shopify/Customer/1",
        creditAmount: 40,
        armDays: 60,
        armTag: "just-bought-credit-60d",
      } as never,
      client,
      silentLog,
    );

    expect(client.request).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "row_1" },
      data: expect.objectContaining({ status: "issued" }),
    });
  });

  it("throws and does not mark the row issued when the credit mutation returns userErrors", async () => {
    const client = scriptedClient([
      { data: { storeCreditAccountCredit: { storeCreditAccountTransaction: null, userErrors: [{ field: null, message: "boom", code: null }] } } },
    ]);

    await expect(
      issuePendingCredit(
        {
          id: "row_2",
          shopifyOrderId: "gid://shopify/Order/2",
          customerGid: "gid://shopify/Customer/2",
          creditAmount: 40,
          armDays: 60,
          armTag: "just-bought-credit-60d",
        } as never,
        client,
        silentLog,
      ),
    ).rejects.toThrow(/storeCreditAccountCredit failed/);

    expect(updateMock).not.toHaveBeenCalled();
  });
});
