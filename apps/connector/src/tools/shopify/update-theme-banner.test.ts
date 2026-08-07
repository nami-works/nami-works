import type { AdminApiClient } from "@shopify/admin-api-client";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../mcp/types.js";

vi.mock("../../clients/shopify.js", () => ({
  getShopifyClient: vi.fn(),
}));

import { getShopifyClient } from "../../clients/shopify.js";
import { updateThemeBannerHandler } from "./update-theme-banner.js";

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
  data: {
    themes: {
      nodes: [{ id: "gid://shopify/OnlineStoreTheme/1", role: "MAIN", name: "[Check] - Produção" }],
    },
  },
};

const themeFile = (content: object) => ({
  data: {
    theme: {
      id: "gid://shopify/OnlineStoreTheme/1",
      role: "MAIN",
      files: {
        nodes: [{ filename: "templates/index.json", body: { content: JSON.stringify(content) } }],
      },
    },
  },
});

const baseTemplate = {
  sections: {
    slideshow_igYUMi: {
      blocks: {
        slide_XrHipC: {
          settings: {
            image: "shopify://shop_images/old-desktop.png",
            image_mb: "shopify://shop_images/old-mobile.png",
          },
        },
      },
    },
  },
};

beforeEach(() => {
  vi.mocked(getShopifyClient).mockReset();
});

describe("updateThemeBannerHandler — home_slide preview", () => {
  it("shows the before/after image swap without mutating", async () => {
    const client = scriptedClient([mainTheme, themeFile(baseTemplate)]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await updateThemeBannerHandler(
      {
        mode: "home_slide",
        imageFilename: "new-desktop.png",
        imageFilenameMobile: "new-mobile.png",
        sectionId: "slideshow_igYUMi",
        blockId: "slide_XrHipC",
      },
      makeCtx(),
    );
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("Preview (no changes made yet)");
    expect(text).toContain("old-desktop.png  →  shopify://shop_images/new-desktop.png");
    expect(text).toContain("old-mobile.png  →  shopify://shop_images/new-mobile.png");
    expect((client.request as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it("errors when the section/block isn't found", async () => {
    const client = scriptedClient([mainTheme, themeFile(baseTemplate)]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await updateThemeBannerHandler(
      {
        mode: "home_slide",
        imageFilename: "new-desktop.png",
        sectionId: "slideshow_igYUMi",
        blockId: "slide_DOES_NOT_EXIST",
      },
      makeCtx(),
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text ?? "").toContain("not found");
  });
});

describe("updateThemeBannerHandler — home_slide confirm", () => {
  it("writes the updated template JSON via themeFilesUpsert", async () => {
    const upsertOk = {
      data: {
        themeFilesUpsert: { upsertedThemeFiles: [{ filename: "templates/index.json" }], userErrors: [] },
      },
    };
    const client = scriptedClient([mainTheme, themeFile(baseTemplate), upsertOk]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await updateThemeBannerHandler(
      {
        mode: "home_slide",
        imageFilename: "new-desktop.png",
        imageFilenameMobile: "new-mobile.png",
        sectionId: "slideshow_igYUMi",
        blockId: "slide_XrHipC",
        confirm: true,
      },
      makeCtx(),
    );
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text ?? "").toContain("Updated templates/index.json");

    const calls = (client.request as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(3);
    const upsertCall = calls[2] as [string, { variables: { files: Array<{ body: { value: string } }> } }];
    const written = JSON.parse(upsertCall[1].variables.files[0].body.value);
    expect(written.sections.slideshow_igYUMi.blocks.slide_XrHipC.settings.image).toBe(
      "shopify://shop_images/new-desktop.png",
    );
    expect(written.sections.slideshow_igYUMi.blocks.slide_XrHipC.settings.image_mb).toBe(
      "shopify://shop_images/new-mobile.png",
    );
  });
});

describe("updateThemeBannerHandler — collection_banner preview", () => {
  it("resolves the collection + files and shows the swap without mutating", async () => {
    const collectionByIdentifier = {
      data: { collectionByIdentifier: { id: "gid://shopify/Collection/1", title: "Body & Hair Mists" } },
    };
    const findDesktopFile = {
      data: {
        files: {
          nodes: [{ __typename: "MediaImage", id: "gid://shopify/MediaImage/10", image: { url: "https://cdn/new-desktop.png" } }],
        },
      },
    };
    const findMobileFile = {
      data: {
        files: {
          nodes: [{ __typename: "MediaImage", id: "gid://shopify/MediaImage/11", image: { url: "https://cdn/new-mobile.png" } }],
        },
      },
    };
    const currentMetafields = {
      data: {
        collection: {
          id: "gid://shopify/Collection/1",
          title: "Body & Hair Mists",
          desktop: { reference: { id: "gid://shopify/MediaImage/1", image: { url: "https://cdn/old-desktop.png" } } },
          mobile: { reference: { id: "gid://shopify/MediaImage/2", image: { url: "https://cdn/old-mobile.png" } } },
        },
      },
    };
    const client = scriptedClient([collectionByIdentifier, findDesktopFile, findMobileFile, currentMetafields]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await updateThemeBannerHandler(
      {
        mode: "collection_banner",
        imageFilename: "new-desktop.png",
        imageFilenameMobile: "new-mobile.png",
        collectionHandle: "body-hair-mist",
      },
      makeCtx(),
    );
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("Preview (no changes made yet)");
    expect(text).toContain("https://cdn/old-desktop.png  →  https://cdn/new-desktop.png");
    expect(text).toContain("https://cdn/old-mobile.png  →  https://cdn/new-mobile.png");
  });

  it("errors when the image filename doesn't resolve to a Shopify Files upload", async () => {
    const collectionByIdentifier = {
      data: { collectionByIdentifier: { id: "gid://shopify/Collection/1", title: "Body & Hair Mists" } },
    };
    const findFileEmpty = { data: { files: { nodes: [] } } };
    const client = scriptedClient([collectionByIdentifier, findFileEmpty, findFileEmpty]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await updateThemeBannerHandler(
      {
        mode: "collection_banner",
        imageFilename: "missing.png",
        collectionHandle: "body-hair-mist",
      },
      makeCtx(),
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text ?? "").toContain("No Shopify Files image found");
  });
});

describe("updateThemeBannerHandler — collection_banner confirm", () => {
  it("writes both metafields via metafieldsSet", async () => {
    const collectionByIdentifier = {
      data: { collectionByIdentifier: { id: "gid://shopify/Collection/1", title: "Body & Hair Mists" } },
    };
    const findDesktopFile = {
      data: { files: { nodes: [{ __typename: "MediaImage", id: "gid://shopify/MediaImage/10", image: { url: "https://cdn/new-desktop.png" } }] } },
    };
    const findMobileFile = {
      data: { files: { nodes: [{ __typename: "MediaImage", id: "gid://shopify/MediaImage/11", image: { url: "https://cdn/new-mobile.png" } }] } },
    };
    const currentMetafields = {
      data: {
        collection: {
          id: "gid://shopify/Collection/1",
          title: "Body & Hair Mists",
          desktop: null,
          mobile: null,
        },
      },
    };
    const setOk = {
      data: {
        metafieldsSet: {
          metafields: [
            { id: "gid://shopify/Metafield/1", key: "banner_1", namespace: "custom" },
            { id: "gid://shopify/Metafield/2", key: "banner_1_mb", namespace: "custom" },
          ],
          userErrors: [],
        },
      },
    };
    const client = scriptedClient([collectionByIdentifier, findDesktopFile, findMobileFile, currentMetafields, setOk]);
    vi.mocked(getShopifyClient).mockResolvedValue(client);

    const res = await updateThemeBannerHandler(
      {
        mode: "collection_banner",
        imageFilename: "new-desktop.png",
        imageFilenameMobile: "new-mobile.png",
        collectionHandle: "body-hair-mist",
        confirm: true,
      },
      makeCtx(),
    );
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text ?? "").toContain("Updated collection banner");

    const calls = (client.request as ReturnType<typeof vi.fn>).mock.calls;
    const setCall = calls[4] as [string, { variables: { metafields: Array<{ key: string; value: string }> } }];
    const metafields = setCall[1].variables.metafields;
    expect(metafields).toEqual([
      expect.objectContaining({ key: "banner_1", value: "gid://shopify/MediaImage/10" }),
      expect.objectContaining({ key: "banner_1_mb", value: "gid://shopify/MediaImage/11" }),
    ]);
  });
});
