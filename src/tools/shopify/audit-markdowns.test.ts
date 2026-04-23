import type { AdminApiClient } from "@shopify/admin-api-client";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../mcp/types.js";

vi.mock("../../clients/shopify.js", () => ({
  getShopifyClient: vi.fn(),
}));

import { getShopifyClient } from "../../clients/shopify.js";
import { auditMarkdownsHandler } from "./audit-markdowns.js";

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

function fakeClient(response: unknown): AdminApiClient {
  return {
    request: vi.fn().mockResolvedValue(response),
  } as unknown as AdminApiClient;
}

type VariantFixture = {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  compareAtPrice: string | null;
};

function productFixture(
  title: string,
  tags: string[],
  variants: VariantFixture[],
) {
  return {
    node: {
      id: `gid://shopify/Product/${title}`,
      title,
      tags,
      variants: { edges: variants.map((v) => ({ node: v })) },
    },
  };
}

beforeEach(() => {
  vi.mocked(getShopifyClient).mockReset();
});

describe("auditMarkdownsHandler", () => {
  it("returns a clean message when nothing is marked down", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      fakeClient({
        data: {
          products: {
            edges: [
              productFixture("Shampoo", [], [
                {
                  id: "v1",
                  title: "50ml",
                  sku: "A",
                  price: "79.90",
                  compareAtPrice: null,
                },
              ]),
            ],
          },
        },
      }),
    );
    const res = await auditMarkdownsHandler({}, makeCtx());
    expect(res.content[0]?.text).toContain("Nenhum produto marcado");
    expect(res.isError).toBeUndefined();
  });

  it("lists regular promos without flags", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      fakeClient({
        data: {
          products: {
            edges: [
              productFixture("Shampoo", ["campaign-x"], [
                {
                  id: "v1",
                  title: "50ml",
                  sku: "A",
                  price: "59.90",
                  compareAtPrice: "79.90",
                },
              ]),
            ],
          },
        },
      }),
    );
    const res = await auditMarkdownsHandler({}, makeCtx());
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("1 promoção(ões) regular(es)");
    expect(text).toContain("Shampoo");
    expect(text).toContain("-25%");
  });

  it("flags products tagged 'lancto' as EXCLUSION_VIOLATION", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      fakeClient({
        data: {
          products: {
            edges: [
              productFixture("Lançamento A", ["lancto"], [
                {
                  id: "v1",
                  title: "default",
                  sku: "LANC-A",
                  price: "90.00",
                  compareAtPrice: "100.00",
                },
              ]),
            ],
          },
        },
      }),
    );
    const res = await auditMarkdownsHandler({}, makeCtx());
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("VIOLAÇÃO");
    expect(text).toContain("EXCLUSION_VIOLATION");
    expect(text).toContain("Lançamento A");
  });

  it("flags >50% markdowns as DEEP_DISCOUNT", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      fakeClient({
        data: {
          products: {
            edges: [
              productFixture("Big Sale", [], [
                {
                  id: "v1",
                  title: "default",
                  sku: "BS-1",
                  price: "20.00",
                  compareAtPrice: "100.00",
                },
              ]),
            ],
          },
        },
      }),
    );
    const res = await auditMarkdownsHandler({}, makeCtx());
    expect(res.content[0]?.text).toContain("DEEP_DISCOUNT");
  });

  it("passes the campaign tag filter through to the query when provided", async () => {
    let captured: string | null = null;
    const client: AdminApiClient = {
      request: vi.fn(async (_query, opts: { variables?: { query?: string } }) => {
        captured = opts.variables?.query ?? null;
        return { data: { products: { edges: [] } } };
      }),
    } as unknown as AdminApiClient;
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    await auditMarkdownsHandler({ tag: "BEAUTYBACK" }, makeCtx());
    expect(captured).toBe("tag:BEAUTYBACK");
  });
});
