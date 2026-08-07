import type { AdminApiClient } from "@shopify/admin-api-client";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../mcp/types.js";

vi.mock("../../clients/shopify.js", () => ({
  getShopifyClient: vi.fn(),
}));

import { getShopifyClient } from "../../clients/shopify.js";
import { assignProductBadgesHandler } from "./assign-product-badges.js";

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

const badgeLibrary = {
  data: {
    metaobjects: {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [
        { id: "gid://shopify/Metaobject/1", handle: "vegano", fields: [{ key: "texto", value: "Vegano" }] },
        { id: "gid://shopify/Metaobject/2", handle: "cruelty-free", fields: [{ key: "texto", value: "Cruelty-free" }] },
        { id: "gid://shopify/Metaobject/3", handle: "10-pct-off", fields: [{ key: "texto", value: "10% off" }] },
      ],
    },
  },
};

beforeEach(() => {
  vi.mocked(getShopifyClient).mockReset();
});

describe("assignProductBadgesHandler — preview", () => {
  it("shows which products need the badge and which already have it", async () => {
    const products = {
      data: {
        nodes: [
          {
            __typename: "Product",
            id: "gid://shopify/Product/1",
            title: "Shampoo",
            etiquetas: { references: { nodes: [] } },
          },
          {
            __typename: "Product",
            id: "gid://shopify/Product/2",
            title: "Booster",
            etiquetas: { references: { nodes: [{ id: "gid://shopify/Metaobject/1", texto: { value: "Vegano" } }] } },
          },
        ],
      },
    };
    const client = scriptedClient([badgeLibrary, products]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await assignProductBadgesHandler(
      { productIds: ["1", "2"], badgeNames: ["vegano"] },
      makeCtx(),
    );
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("Preview (no changes made yet)");
    expect(text).toContain("Shampoo (gid://shopify/Product/1): + Vegano");
    expect(text).toContain("Booster (gid://shopify/Product/2): (no change) — already has: Vegano");
  });

  it("errors on an unknown badge name without guessing or creating one", async () => {
    const client = scriptedClient([badgeLibrary]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await assignProductBadgesHandler(
      { productIds: ["1"], badgeNames: ["sem gluten"] },
      makeCtx(),
    );
    expect(res.isError).toBe(true);
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("Unknown badge(s): sem gluten");
    expect(text).toContain("Vegano, Cruelty-free, 10% off");
  });
});

describe("assignProductBadgesHandler — confirm", () => {
  it("appends the new badge while preserving existing ones", async () => {
    const products = {
      data: {
        nodes: [
          {
            __typename: "Product",
            id: "gid://shopify/Product/2",
            title: "Booster",
            etiquetas: { references: { nodes: [{ id: "gid://shopify/Metaobject/3", texto: { value: "10% off" } }] } },
          },
        ],
      },
    };
    const setOk = {
      data: { metafieldsSet: { metafields: [{ id: "gid://shopify/Metafield/1" }], userErrors: [] } },
    };
    const client = scriptedClient([badgeLibrary, products, setOk]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await assignProductBadgesHandler(
      { productIds: ["2"], badgeNames: ["vegano"], confirm: true },
      makeCtx(),
    );
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text ?? "").toContain("Assigned badge(s) to 1/1 product(s)");

    const calls = (client.request as ReturnType<typeof vi.fn>).mock.calls;
    const setCall = calls[2] as [string, { variables: { metafields: Array<{ value: string }> } }];
    const newIds = JSON.parse(setCall[1].variables.metafields[0].value);
    expect(newIds).toEqual(["gid://shopify/Metaobject/3", "gid://shopify/Metaobject/1"]);
  });

  it("returns a no-op when every product already has the badge", async () => {
    const products = {
      data: {
        nodes: [
          {
            __typename: "Product",
            id: "gid://shopify/Product/2",
            title: "Booster",
            etiquetas: { references: { nodes: [{ id: "gid://shopify/Metaobject/1", texto: { value: "Vegano" } }] } },
          },
        ],
      },
    };
    const client = scriptedClient([badgeLibrary, products]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await assignProductBadgesHandler(
      { productIds: ["2"], badgeNames: ["vegano"], confirm: true },
      makeCtx(),
    );
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text ?? "").toContain("No-op");
  });
});
