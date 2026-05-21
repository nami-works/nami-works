import type { AdminApiClient } from "@shopify/admin-api-client";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../mcp/types.js";

vi.mock("../../clients/shopify.js", () => ({
  getShopifyClient: vi.fn(),
}));
vi.mock("../../clients/shopify-shop-info.js", () => ({
  getShopTimezone: vi.fn(),
}));

import { getShopifyClient } from "../../clients/shopify.js";
import { getShopTimezone } from "../../clients/shopify-shop-info.js";
import { compareRevenueYoYHandler } from "./compare-revenue-yoy.js";
import { listPendingLocalDeliveryHandler } from "./list-pending-local-delivery.js";
import { topCitiesByOrdersHandler } from "./top-cities-by-orders.js";

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

function fakeClientSequence(responses: unknown[]): AdminApiClient {
  let i = 0;
  return {
    request: vi.fn(async () => responses[i++] ?? null),
  } as unknown as AdminApiClient;
}

beforeEach(() => {
  vi.mocked(getShopifyClient).mockReset();
  vi.mocked(getShopTimezone).mockReset();
  vi.mocked(getShopTimezone).mockResolvedValue("America/Sao_Paulo");
});

describe("topCitiesByOrdersHandler", () => {
  it("rejects non-ISO dates", async () => {
    const res = await topCitiesByOrdersHandler(
      { desde: "01/04/2026", ate: "30/04/2026" },
      makeCtx(),
    );
    expect(res.isError).toBe(true);
  });

  it("aggregates and ranks cities by order count", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      fakeClientSequence([
        {
          data: {
            orders: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [
                {
                  node: {
                    id: "o1",
                    totalPriceSet: { shopMoney: { amount: "100", currencyCode: "BRL" } },
                    shippingAddress: { city: "São Paulo", province: "SP", countryCodeV2: "BR" },
                  },
                },
                {
                  node: {
                    id: "o2",
                    totalPriceSet: { shopMoney: { amount: "200", currencyCode: "BRL" } },
                    shippingAddress: { city: "São Paulo", province: "SP", countryCodeV2: "BR" },
                  },
                },
                {
                  node: {
                    id: "o3",
                    totalPriceSet: { shopMoney: { amount: "50", currencyCode: "BRL" } },
                    shippingAddress: { city: "Rio de Janeiro", province: "RJ", countryCodeV2: "BR" },
                  },
                },
              ],
            },
          },
        },
      ]),
    );
    const res = await topCitiesByOrdersHandler(
      { desde: "2026-04-01", ate: "2026-04-30" },
      makeCtx(),
    );
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("São Paulo");
    expect(text).toContain("Rio de Janeiro");
    // SP first (2 orders), RJ second (1 order)
    expect(text.indexOf("São Paulo")).toBeLessThan(text.indexOf("Rio de Janeiro"));
  });

  it("reports orders missing a shipping city in the header", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      fakeClientSequence([
        {
          data: {
            orders: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [
                {
                  node: {
                    id: "o1",
                    totalPriceSet: { shopMoney: { amount: "100", currencyCode: "BRL" } },
                    shippingAddress: null,
                  },
                },
                {
                  node: {
                    id: "o2",
                    totalPriceSet: { shopMoney: { amount: "200", currencyCode: "BRL" } },
                    shippingAddress: { city: "Curitiba", province: "PR", countryCodeV2: "BR" },
                  },
                },
              ],
            },
          },
        },
      ]),
    );
    const res = await topCitiesByOrdersHandler(
      { desde: "2026-04-01", ate: "2026-04-30" },
      makeCtx(),
    );
    expect(res.content[0]?.text).toContain("sem cidade no shipping address");
    expect(res.content[0]?.text).toContain("Curitiba");
  });
});

describe("compareRevenueYoYHandler", () => {
  it("rejects non-ISO dates", async () => {
    const res = await compareRevenueYoYHandler(
      { desde: "bad", ate: "bad" },
      makeCtx(),
    );
    expect(res.isError).toBe(true);
  });

  it("computes deltas between two windows", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      fakeClientSequence([
        // current window: 2 paid orders, R$ 300 total
        {
          data: {
            orders: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [
                {
                  node: {
                    id: "o1",
                    displayFinancialStatus: "PAID",
                    totalPriceSet: { shopMoney: { amount: "100", currencyCode: "BRL" } },
                  },
                },
                {
                  node: {
                    id: "o2",
                    displayFinancialStatus: "PAID",
                    totalPriceSet: { shopMoney: { amount: "200", currencyCode: "BRL" } },
                  },
                },
              ],
            },
          },
        },
        // previous window: 1 paid order, R$ 150 total
        {
          data: {
            orders: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [
                {
                  node: {
                    id: "p1",
                    displayFinancialStatus: "PAID",
                    totalPriceSet: { shopMoney: { amount: "150", currencyCode: "BRL" } },
                  },
                },
              ],
            },
          },
        },
      ]),
    );
    const res = await compareRevenueYoYHandler(
      { desde: "2026-04-01", ate: "2026-04-30" },
      makeCtx(),
    );
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("Janela atual:    2026-04-01 → 2026-04-30");
    expect(text).toContain("Janela 1 ano(s) atrás: 2025-04-01 → 2025-04-30");
    expect(text).toContain("+100.0%"); // orders went 1→2 (= +100%)
    expect(text).toContain("+100.0%"); // revenue 150→300
  });
});

describe("listPendingLocalDeliveryHandler", () => {
  it("returns clean message when nothing pending", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      fakeClientSequence([{ data: { orders: { edges: [] } } }]),
    );
    const res = await listPendingLocalDeliveryHandler({}, makeCtx());
    expect(res.content[0]?.text).toContain("Nenhum pedido");
  });

  it("formats one order with shipping + customer details", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      fakeClientSequence([
        {
          data: {
            orders: {
              edges: [
                {
                  node: {
                    id: "o1",
                    name: "#1234",
                    createdAt: "2026-04-22T10:00:00Z",
                    tags: ["entrega-local", "rota-A"],
                    displayFinancialStatus: "PAID",
                    displayFulfillmentStatus: "UNFULFILLED",
                    totalPriceSet: { shopMoney: { amount: "180.00", currencyCode: "BRL" } },
                    customer: { firstName: "Ana", lastName: "Costa", phone: "+5511999" },
                    shippingAddress: {
                      address1: "Rua A 100",
                      city: "São Paulo",
                      zip: "01000-000",
                      province: "SP",
                      phone: null,
                    },
                  },
                },
              ],
            },
          },
        },
      ]),
    );
    const res = await listPendingLocalDeliveryHandler({}, makeCtx());
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("#1234");
    expect(text).toContain("Ana Costa");
    expect(text).toContain("Rua A 100");
    expect(text).toContain("+5511999");
  });

  it("filters by city when cityFilter is given", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      fakeClientSequence([
        {
          data: {
            orders: {
              edges: [
                {
                  node: {
                    id: "o1",
                    name: "#1",
                    createdAt: "2026-04-22T10:00:00Z",
                    tags: ["entrega-local"],
                    displayFinancialStatus: "PAID",
                    displayFulfillmentStatus: "UNFULFILLED",
                    totalPriceSet: { shopMoney: { amount: "100.00", currencyCode: "BRL" } },
                    customer: { firstName: "X", lastName: null, phone: null },
                    shippingAddress: {
                      address1: "Av A",
                      city: "São Paulo",
                      zip: null,
                      province: "SP",
                      phone: null,
                    },
                  },
                },
                {
                  node: {
                    id: "o2",
                    name: "#2",
                    createdAt: "2026-04-22T10:00:00Z",
                    tags: ["entrega-local"],
                    displayFinancialStatus: "PAID",
                    displayFulfillmentStatus: "UNFULFILLED",
                    totalPriceSet: { shopMoney: { amount: "100.00", currencyCode: "BRL" } },
                    customer: { firstName: "Y", lastName: null, phone: null },
                    shippingAddress: {
                      address1: "Av B",
                      city: "Rio de Janeiro",
                      zip: null,
                      province: "RJ",
                      phone: null,
                    },
                  },
                },
              ],
            },
          },
        },
      ]),
    );
    const res = await listPendingLocalDeliveryHandler(
      { cityFilter: "São Paulo" },
      makeCtx(),
    );
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("#1");
    expect(text).not.toContain("#2");
  });
});
