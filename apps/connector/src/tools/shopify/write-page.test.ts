import type { AdminApiClient } from "@shopify/admin-api-client";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../mcp/types.js";

vi.mock("../../clients/shopify.js", () => ({
  getShopifyClient: vi.fn(),
}));

import { getShopifyClient } from "../../clients/shopify.js";
import { writePageHandler } from "./write-page.js";

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

const noPageFound = { data: { pages: { nodes: [] } } };

const existingPage = {
  data: {
    pages: {
      nodes: [
        {
          id: "gid://shopify/Page/1",
          title: "Sobre nós",
          handle: "sobre-nos",
          body: "<p>Conteúdo antigo</p>",
          isPublished: true,
          templateSuffix: null,
        },
      ],
    },
  },
};

beforeEach(() => {
  vi.mocked(getShopifyClient).mockReset();
});

describe("writePageHandler — preview (no confirm)", () => {
  it("shows a create preview when no page matches the handle", async () => {
    const client = scriptedClient([noPageFound]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await writePageHandler(
      { handle: "nova-pagina", title: "Página Nova", body: "<p>Olá</p>" },
      makeCtx(),
    );
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("Preview (no changes made yet)");
    expect(text).toContain('Creating new page: "Página Nova"');
    expect(res.isError).toBeUndefined();
  });

  it("errors when creating and no title is given", async () => {
    const client = scriptedClient([noPageFound]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await writePageHandler({ handle: "nova-pagina" }, makeCtx());
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text ?? "").toContain("requires `title`");
  });

  it("shows an update diff (only for the fields provided) when a page matches", async () => {
    const client = scriptedClient([existingPage]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await writePageHandler(
      { handle: "sobre-nos", body: "<p>Conteúdo novo</p>" },
      makeCtx(),
    );
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("Preview (no changes made yet)");
    expect(text).toContain('Updating existing page: "Sobre nós"');
    expect(text).toContain("Conteúdo antigo");
    expect(text).toContain("Conteúdo novo");
    // title wasn't provided, so it must not appear as a proposed change
    expect(text).not.toContain("title:");
  });

  it("warns when the update would unpublish a currently-published page", async () => {
    const client = scriptedClient([existingPage]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await writePageHandler(
      { handle: "sobre-nos", published: false },
      makeCtx(),
    );
    expect(res.content[0]?.text ?? "").toContain("unpublishes a live page");
  });
});

describe("writePageHandler — confirm", () => {
  it("creates a new page via pageCreate", async () => {
    const createOk = {
      data: {
        pageCreate: {
          page: { id: "gid://shopify/Page/2", title: "Página Nova", handle: "nova-pagina", isPublished: true, templateSuffix: null },
          userErrors: [],
        },
      },
    };
    const client = scriptedClient([noPageFound, createOk]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await writePageHandler(
      { handle: "nova-pagina", title: "Página Nova", body: "<p>Olá</p>", confirm: true },
      makeCtx(),
    );
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text ?? "").toContain("Created page");

    const calls = (client.request as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    const createCall = calls[1] as [string, { variables: { page: { title: string; handle: string; body: string } } }];
    expect(createCall[1].variables.page).toEqual(
      expect.objectContaining({ title: "Página Nova", handle: "nova-pagina", body: "<p>Olá</p>" }),
    );
  });

  it("updates an existing page via pageUpdate, sending only the provided fields", async () => {
    const updateOk = {
      data: {
        pageUpdate: {
          page: { id: "gid://shopify/Page/1", title: "Sobre nós", handle: "sobre-nos", isPublished: true, templateSuffix: null },
          userErrors: [],
        },
      },
    };
    const client = scriptedClient([existingPage, updateOk]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await writePageHandler(
      { handle: "sobre-nos", body: "<p>Conteúdo novo</p>", confirm: true },
      makeCtx(),
    );
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text ?? "").toContain("Updated page");

    const calls = (client.request as ReturnType<typeof vi.fn>).mock.calls;
    const updateCall = calls[1] as [string, { variables: { id: string; page: Record<string, unknown> } }];
    expect(updateCall[1].variables.id).toBe("gid://shopify/Page/1");
    expect(updateCall[1].variables.page).toEqual({ body: "<p>Conteúdo novo</p>" });
  });

  it("surfaces userErrors from pageUpdate as a tool error", async () => {
    const updateFail = {
      data: {
        pageUpdate: {
          page: null,
          userErrors: [{ field: ["page", "handle"], message: "Handle has already been taken" }],
        },
      },
    };
    const client = scriptedClient([existingPage, updateFail]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await writePageHandler(
      { handle: "sobre-nos", title: "Novo título", confirm: true },
      makeCtx(),
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text ?? "").toContain("Handle has already been taken");
  });
});
