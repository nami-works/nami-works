import type { AdminApiClient } from "@shopify/admin-api-client";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../mcp/types.js";

vi.mock("../../clients/shopify.js", () => ({
  getShopifyClient: vi.fn(),
}));

import { getShopifyClient } from "../../clients/shopify.js";
import { previewBulkPriceUpdateHandler } from "./preview-bulk-price-update.js";

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

function product(title: string, variants: Array<{ sku?: string; price: string; compareAtPrice: string | null }>) {
  return {
    node: {
      id: `gid://shopify/Product/${title}`,
      title,
      variants: {
        edges: variants.map((v, i) => ({
          node: {
            id: `v${i}`,
            sku: v.sku ?? null,
            price: v.price,
            compareAtPrice: v.compareAtPrice,
          },
        })),
      },
    },
  };
}

beforeEach(() => {
  vi.mocked(getShopifyClient).mockReset();
});

describe("previewBulkPriceUpdateHandler", () => {
  it("rejects invalid markdown_pct", async () => {
    const res = await previewBulkPriceUpdateHandler(
      { tag: "X", mode: "markdown_pct", value: 1.5 },
      makeCtx(),
    );
    expect(res.isError).toBe(true);
  });

  it("computes a 20% markdown across multiple products", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      fakeClient({
        data: {
          products: {
            edges: [
              product("A", [{ sku: "A-1", price: "100.00", compareAtPrice: null }]),
              product("B", [{ sku: "B-1", price: "50.00", compareAtPrice: null }]),
            ],
          },
        },
      }),
    );
    const res = await previewBulkPriceUpdateHandler(
      { tag: "X", mode: "markdown_pct", value: 0.2 },
      makeCtx(),
    );
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("2 variante(s) afetada(s)");
    expect(text).toContain("100.00 → 80.00");
    expect(text).toContain("50.00 → 40.00");
    expect(res.isError).toBeUndefined();
  });

  it("sets compareAtPrice to the old price on markdown when none existed", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      fakeClient({
        data: {
          products: {
            edges: [
              product("A", [{ sku: "A-1", price: "100.00", compareAtPrice: null }]),
            ],
          },
        },
      }),
    );
    const res = await previewBulkPriceUpdateHandler(
      { tag: "X", mode: "markdown_pct", value: 0.25 },
      makeCtx(),
    );
    expect(res.content[0]?.text).toContain("compare 100.00");
  });

  it("leaves compareAtPrice untouched when preserveCompareAtPrice=false", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      fakeClient({
        data: {
          products: {
            edges: [
              product("A", [{ sku: "A-1", price: "100.00", compareAtPrice: null }]),
            ],
          },
        },
      }),
    );
    const res = await previewBulkPriceUpdateHandler(
      {
        tag: "X",
        mode: "markdown_pct",
        value: 0.25,
        preserveCompareAtPrice: false,
      },
      makeCtx(),
    );
    expect(res.content[0]?.text).not.toContain("compare");
  });

  it("reports empty state when tag matches nothing", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      fakeClient({ data: { products: { edges: [] } } }),
    );
    const res = await previewBulkPriceUpdateHandler(
      { tag: "NOPE", mode: "set", value: 99 },
      makeCtx(),
    );
    expect(res.content[0]?.text).toContain("Nenhum produto encontrado");
  });

  it("skips variants already at the target price in 'set' mode", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      fakeClient({
        data: {
          products: {
            edges: [
              product("A", [{ sku: "A-1", price: "50.00", compareAtPrice: null }]),
              product("B", [{ sku: "B-1", price: "100.00", compareAtPrice: null }]),
            ],
          },
        },
      }),
    );
    const res = await previewBulkPriceUpdateHandler(
      { tag: "X", mode: "set", value: 50 },
      makeCtx(),
    );
    expect(res.content[0]?.text).toContain("1 variante(s) afetada(s)");
  });

  it("makes clear this is a preview, never a write", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      fakeClient({
        data: {
          products: {
            edges: [
              product("A", [{ sku: "A-1", price: "100.00", compareAtPrice: null }]),
            ],
          },
        },
      }),
    );
    const res = await previewBulkPriceUpdateHandler(
      { tag: "X", mode: "set", value: 80 },
      makeCtx(),
    );
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("preview");
    expect(text).toContain("Nenhuma mudança foi aplicada");
  });
});
