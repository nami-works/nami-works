import type { AdminApiClient } from "@shopify/admin-api-client";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../mcp/types.js";

vi.mock("../../clients/shopify.js", () => ({
  getShopifyClient: vi.fn(),
}));

import { getShopifyClient } from "../../clients/shopify.js";
import { auditExcludedInCampaignHandler } from "./audit-excluded-in-campaign.js";

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

function tagged(title: string, tags: string[], variant: { price: string; compareAtPrice: string | null }) {
  return {
    node: {
      id: `gid://shopify/Product/${title}`,
      title,
      tags,
      variants: {
        edges: [
          {
            node: {
              id: "v1",
              sku: `${title}-SKU`,
              price: variant.price,
              compareAtPrice: variant.compareAtPrice,
            },
          },
        ],
      },
    },
  };
}

beforeEach(() => {
  vi.mocked(getShopifyClient).mockReset();
});

describe("auditExcludedInCampaignHandler", () => {
  it("confirms clean state when no lancto product is discounted", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      fakeClient({
        data: {
          products: {
            edges: [
              tagged("Novidade A", ["lancto"], {
                price: "100.00",
                compareAtPrice: null,
              }),
              tagged("Novidade B", ["lancto"], {
                price: "150.00",
                compareAtPrice: null,
              }),
            ],
          },
        },
      }),
    );
    const res = await auditExcludedInCampaignHandler({}, makeCtx());
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text).toContain("Auditoria limpa");
  });

  it("reports offenders when lancto products have compareAtPrice set", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      fakeClient({
        data: {
          products: {
            edges: [
              tagged("Novidade A", ["lancto"], {
                price: "90.00",
                compareAtPrice: "100.00",
              }),
              tagged("Novidade B", ["lancto"], {
                price: "150.00",
                compareAtPrice: null,
              }),
            ],
          },
        },
      }),
    );
    const res = await auditExcludedInCampaignHandler({}, makeCtx());
    expect(res.isError).toBe(true);
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("VIOLAÇÃO");
    expect(text).toContain("Novidade A");
    expect(text).not.toContain("Novidade B"); // clean product, shouldn't be listed
    expect(text).toContain("em violação: 1");
  });

  it("handles custom exclusionTag arg", async () => {
    let captured: string | null = null;
    const client: AdminApiClient = {
      request: vi.fn(async (_q, opts: { variables?: { query?: string } }) => {
        captured = opts.variables?.query ?? null;
        return { data: { products: { edges: [] } } };
      }),
    } as unknown as AdminApiClient;
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    await auditExcludedInCampaignHandler(
      { exclusionTag: "exclusivo_atacado" },
      makeCtx(),
    );
    expect(captured).toBe("tag:exclusivo_atacado");
  });

  it("returns an empty-state message when no products carry the tag", async () => {
    vi.mocked(getShopifyClient).mockResolvedValue(
      fakeClient({ data: { products: { edges: [] } } }),
    );
    const res = await auditExcludedInCampaignHandler({}, makeCtx());
    expect(res.content[0]?.text).toContain("Nenhum produto com a tag");
    expect(res.isError).toBeUndefined();
  });
});
