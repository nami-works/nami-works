import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../clients/shopify.js", () => ({
  getShopifyClient: vi.fn(),
}));
vi.mock("../db/prisma.js", () => ({
  prisma: {
    justBoughtCreditIssuance: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
}));

import { getShopifyClient } from "../clients/shopify.js";
import { prisma } from "../db/prisma.js";
import { handleRefundsCreateWebhook } from "./refund-clawback.js";

const silentLog = pino({ level: "silent" }) as never;
const findUniqueMock = vi.mocked(prisma.justBoughtCreditIssuance.findUnique);
const updateManyMock = vi.mocked(prisma.justBoughtCreditIssuance.updateMany);
const getShopifyClientMock = vi.mocked(getShopifyClient);

function baseCtx() {
  return { tenantId: "t_gebeauty", ssmPrefix: "/nami-works/tenants/gebeauty", shopifyShop: "gebeauty.myshopify.com", log: silentLog };
}

beforeEach(() => {
  findUniqueMock.mockReset();
  updateManyMock.mockReset();
  getShopifyClientMock.mockReset();
});

describe("handleRefundsCreateWebhook — refund during the 72h hold", () => {
  it("cancels a pending_hold row without calling Shopify at all", async () => {
    findUniqueMock.mockResolvedValue({ status: "pending_hold", customerGid: "gid://shopify/Customer/1" } as never);
    updateManyMock.mockResolvedValue({ count: 1 });

    await handleRefundsCreateWebhook({ order_id: 1 }, baseCtx() as never);

    expect(updateManyMock).toHaveBeenCalledWith({
      where: { tenantId: "t_gebeauty", shopifyOrderId: "gid://shopify/Order/1", status: "pending_hold" },
      data: { status: "cancelled_before_issuance" },
    });
    expect(getShopifyClientMock).not.toHaveBeenCalled();
  });

  it("no-ops if the pending row was already cancelled by a duplicate delivery", async () => {
    findUniqueMock.mockResolvedValue({ status: "pending_hold", customerGid: "gid://shopify/Customer/1" } as never);
    updateManyMock.mockResolvedValue({ count: 0 });

    await handleRefundsCreateWebhook({ order_id: 1 }, baseCtx() as never);

    expect(getShopifyClientMock).not.toHaveBeenCalled();
  });

  it("still no-ops for a never-issued (skipped_floor) order", async () => {
    findUniqueMock.mockResolvedValue({ status: "skipped_floor", customerGid: "gid://shopify/Customer/1" } as never);

    await handleRefundsCreateWebhook({ order_id: 1 }, baseCtx() as never);

    expect(updateManyMock).not.toHaveBeenCalled();
    expect(getShopifyClientMock).not.toHaveBeenCalled();
  });
});
