import type { AdminApiClient } from "@shopify/admin-api-client";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../mcp/types.js";

vi.mock("../../clients/shopify.js", () => ({
  getShopifyClient: vi.fn(),
}));

import { getShopifyClient } from "../../clients/shopify.js";
import { auditPromotionalConsistencyHandler } from "./audit-promotional-consistency.js";

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

function scriptedClient(responses: unknown[]): AdminApiClient {
  const request = vi.fn(async () => responses.shift() ?? null);
  return { request } as unknown as AdminApiClient;
}

const mainTheme = {
  data: { themes: { nodes: [{ id: "gid://shopify/OnlineStoreTheme/1", role: "MAIN", name: "[Check] - Produção" }] } },
};

function themeTexts(headerText: string, settingsText: string) {
  return {
    data: {
      theme: {
        files: {
          nodes: [
            {
              filename: "sections/header-group.json",
              body: { content: JSON.stringify({ blocks: { b1: { settings: { text: headerText } } } }) },
            },
            {
              filename: "config/settings_data.json",
              body: { content: JSON.stringify({ current: { promotional_bar_pdp_text: settingsText } }) },
            },
          ],
        },
      },
    },
  };
}

beforeEach(() => {
  vi.mocked(getShopifyClient).mockReset();
});

describe("auditPromotionalConsistencyHandler", () => {
  it("matches a claimed percentage to an active discount cleanly", async () => {
    const discounts = {
      data: {
        codeDiscountNodes: {
          nodes: [
            {
              codeDiscount: {
                __typename: "DiscountCodeBasic",
                title: "Consumidor 20",
                codes: { edges: [{ node: { code: "CONSUMIDOR20" } }] },
                customerGets: { value: { __typename: "DiscountPercentage", percentage: 0.2 } },
              },
            },
          ],
        },
        automaticDiscountNodes: { nodes: [] },
      },
    };
    const client = scriptedClient([
      mainTheme,
      themeTexts("20% off em toda a loja!", ""),
      discounts,
    ]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await auditPromotionalConsistencyHandler({}, makeCtx());
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("Percentages mentioned in banner/promo text: 20%");
    expect(text).toContain('Active discounts (1): code "CONSUMIDOR20" = 20%');
    expect(text).toContain("Every percentage mentioned in theme text matches an active discount");
  });

  it("flags a banner claim with no matching active discount", async () => {
    const discounts = {
      data: { codeDiscountNodes: { nodes: [] }, automaticDiscountNodes: { nodes: [] } },
    };
    const client = scriptedClient([mainTheme, themeTexts("25% OFF hoje!", ""), discounts]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await auditPromotionalConsistencyHandler({}, makeCtx());
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("⚠ Theme text claims 25% but no active discount matches");
  });

  it("flags an active discount not mentioned in any banner text", async () => {
    const discounts = {
      data: {
        codeDiscountNodes: {
          nodes: [
            {
              codeDiscount: {
                __typename: "DiscountCodeBasic",
                title: "Hidden",
                codes: { edges: [{ node: { code: "HIDDEN15" } }] },
                customerGets: { value: { __typename: "DiscountPercentage", percentage: 0.15 } },
              },
            },
          ],
        },
        automaticDiscountNodes: { nodes: [] },
      },
    };
    const client = scriptedClient([mainTheme, themeTexts("", ""), discounts]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await auditPromotionalConsistencyHandler({}, makeCtx());
    const text = res.content[0]?.text ?? "";
    expect(text).toContain('⚠ Active but not mentioned in any banner text: code "HIDDEN15" (15%)');
  });
});
