import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../clients/shopify.js", () => ({
  getShopifyClient: vi.fn(),
}));
vi.mock("../db/prisma.js", () => ({
  prisma: {
    justBoughtCreditIssuance: { findMany: vi.fn(), update: vi.fn() },
    integrationTenant: { findUnique: vi.fn() },
  },
}));
vi.mock("./just-bought-credit.js", () => ({
  issuePendingCredit: vi.fn(),
}));

import { getShopifyClient } from "../clients/shopify.js";
import { prisma } from "../db/prisma.js";
import { issuePendingCredit } from "./just-bought-credit.js";
import { processPendingCreditIssuances } from "./process-pending-credit.js";

const silentLog = pino({ level: "silent" }) as never;

const findManyMock = vi.mocked(prisma.justBoughtCreditIssuance.findMany);
const tenantFindUniqueMock = vi.mocked(prisma.integrationTenant.findUnique);
const getShopifyClientMock = vi.mocked(getShopifyClient);
const issuePendingCreditMock = vi.mocked(issuePendingCredit);

beforeEach(() => {
  findManyMock.mockReset();
  tenantFindUniqueMock.mockReset();
  getShopifyClientMock.mockReset();
  issuePendingCreditMock.mockReset();
});

describe("processPendingCreditIssuances", () => {
  it("does nothing when no rows are due", async () => {
    findManyMock.mockResolvedValue([]);
    await processPendingCreditIssuances(silentLog);
    expect(tenantFindUniqueMock).not.toHaveBeenCalled();
  });

  it("issues each due row for an active tenant, one shared client per tenant", async () => {
    findManyMock.mockResolvedValue([
      { id: "row_1", tenantId: "t_1", shopifyOrderId: "gid://shopify/Order/1" },
      { id: "row_2", tenantId: "t_1", shopifyOrderId: "gid://shopify/Order/2" },
    ] as never);
    tenantFindUniqueMock.mockResolvedValue({
      id: "t_1",
      status: "active",
      shopifyShop: "gebeauty.myshopify.com",
      ssmPrefix: "/nami-works/tenants/gebeauty",
    } as never);
    getShopifyClientMock.mockResolvedValue({} as never);
    issuePendingCreditMock.mockResolvedValue(undefined);

    await processPendingCreditIssuances(silentLog);

    expect(getShopifyClientMock).toHaveBeenCalledTimes(1);
    expect(issuePendingCreditMock).toHaveBeenCalledTimes(2);
  });

  it("skips a tenant that's gone inactive, without throwing", async () => {
    findManyMock.mockResolvedValue([{ id: "row_1", tenantId: "t_gone", shopifyOrderId: "gid://shopify/Order/1" }] as never);
    tenantFindUniqueMock.mockResolvedValue({ id: "t_gone", status: "suspended", shopifyShop: "x.myshopify.com" } as never);

    await expect(processPendingCreditIssuances(silentLog)).resolves.toBeUndefined();
    expect(issuePendingCreditMock).not.toHaveBeenCalled();
  });

  it("continues to the next row when one issuance throws", async () => {
    findManyMock.mockResolvedValue([
      { id: "row_1", tenantId: "t_1", shopifyOrderId: "gid://shopify/Order/1" },
      { id: "row_2", tenantId: "t_1", shopifyOrderId: "gid://shopify/Order/2" },
    ] as never);
    tenantFindUniqueMock.mockResolvedValue({
      id: "t_1",
      status: "active",
      shopifyShop: "gebeauty.myshopify.com",
      ssmPrefix: "/nami-works/tenants/gebeauty",
    } as never);
    getShopifyClientMock.mockResolvedValue({} as never);
    issuePendingCreditMock.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(undefined);

    await expect(processPendingCreditIssuances(silentLog)).resolves.toBeUndefined();
    expect(issuePendingCreditMock).toHaveBeenCalledTimes(2);
  });
});
