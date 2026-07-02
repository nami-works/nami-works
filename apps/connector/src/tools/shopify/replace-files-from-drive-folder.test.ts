import type { AdminApiClient } from "@shopify/admin-api-client";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleDriveClient } from "../../clients/google-drive.js";
import type { ToolContext } from "../../mcp/types.js";

vi.mock("../../clients/shopify.js", () => ({
  getShopifyClient: vi.fn(),
}));
vi.mock("../../clients/google-drive.js", () => ({
  getGoogleDriveClient: vi.fn(),
}));

import { getGoogleDriveClient } from "../../clients/google-drive.js";
import { getShopifyClient } from "../../clients/shopify.js";
import { replaceFilesFromDriveFolderHandler } from "./replace-files-from-drive-folder.js";

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
    },
    logger: silentLogger,
    requestId: "req_test",
  };
}

function scriptedShopify(responses: unknown[]): AdminApiClient {
  const request = vi.fn(async () => responses.shift() ?? null);
  return { request } as unknown as AdminApiClient;
}

function scriptedDrive(opts: {
  files: Array<{ id: string; name: string; mimeType: string; size: number }>;
  bytes?: Map<string, Buffer>;
}): GoogleDriveClient {
  return {
    listFolderContents: vi.fn(async () =>
      opts.files.map((f) => ({ ...f, modifiedTime: "2026-04-01T00:00:00Z" })),
    ),
    downloadFile: vi.fn(async (id: string) => {
      const b = opts.bytes?.get(id);
      if (!b) return Buffer.from("default-bytes");
      return b;
    }),
  };
}

beforeEach(() => {
  vi.mocked(getShopifyClient).mockReset();
  vi.mocked(getGoogleDriveClient).mockReset();
  vi.spyOn(globalThis, "fetch").mockReset();
});

describe("replaceFilesFromDriveFolderHandler — preview", () => {
  it("classifies match / not_found / ambiguous and does not mutate", async () => {
    vi.mocked(getGoogleDriveClient).mockResolvedValue(
      scriptedDrive({
        files: [
          { id: "d1", name: "melon.jpg", mimeType: "image/jpeg", size: 100 },
          { id: "d2", name: "lemon.jpg", mimeType: "image/jpeg", size: 200 },
          { id: "d3", name: "vanilla.jpg", mimeType: "image/jpeg", size: 300 },
        ],
      }),
    );

    const shopify = scriptedShopify([
      // match for melon.jpg
      { data: { files: { edges: [{ node: { id: "gid://1", fileStatus: "READY" } }] } } },
      // not_found for lemon.jpg
      { data: { files: { edges: [] } } },
      // ambiguous for vanilla.jpg
      {
        data: {
          files: {
            edges: [
              { node: { id: "gid://A", fileStatus: "READY" } },
              { node: { id: "gid://B", fileStatus: "READY" } },
            ],
          },
        },
      },
    ]);
    vi.mocked(getShopifyClient).mockResolvedValue(shopify);

    const res = await replaceFilesFromDriveFolderHandler(
      { driveFolderId: "FOLDER" },
      makeCtx(),
    );
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("Preview (no changes made yet)");
    expect(text).toContain("melon.jpg → gid://1");
    expect(text).toContain("lemon.jpg → SKIP: no Shopify file");
    expect(text).toContain("vanilla.jpg → SKIP: 2 ambiguous");
    expect(text).toContain("1 will replace, 1 not found, 1 ambiguous");
    // 3 file lookups + nothing else (no upload, no fileUpdate)
    expect(
      (shopify.request as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(3);
  });

  it("filters by filenameFilter and skips non-image files in folder", async () => {
    vi.mocked(getGoogleDriveClient).mockResolvedValue(
      scriptedDrive({
        files: [
          { id: "d1", name: "melon.jpg", mimeType: "image/jpeg", size: 100 },
          { id: "d2", name: "notes.txt", mimeType: "text/plain", size: 50 },
          { id: "d3", name: "lemon.jpg", mimeType: "image/jpeg", size: 200 },
        ],
      }),
    );
    const shopify = scriptedShopify([
      { data: { files: { edges: [{ node: { id: "gid://1", fileStatus: "READY" } }] } } },
    ]);
    vi.mocked(getShopifyClient).mockResolvedValue(shopify);

    const res = await replaceFilesFromDriveFolderHandler(
      { driveFolderId: "FOLDER", filenameFilter: "melon.jpg" },
      makeCtx(),
    );
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("melon.jpg");
    expect(text).not.toContain("lemon.jpg");
    expect(text).not.toContain("notes.txt");
    expect(text).toContain("1 will replace");
  });

  it("handles an empty folder gracefully", async () => {
    vi.mocked(getGoogleDriveClient).mockResolvedValue(
      scriptedDrive({ files: [] }),
    );
    vi.mocked(getShopifyClient).mockResolvedValue(scriptedShopify([]));

    const res = await replaceFilesFromDriveFolderHandler(
      { driveFolderId: "EMPTY" },
      makeCtx(),
    );
    expect(res.isError).toBeUndefined();
    expect(res.content[0]?.text).toContain("No image files");
  });
});

describe("replaceFilesFromDriveFolderHandler — confirm", () => {
  it("downloads from Drive, stages upload, fileUpdate, reports success", async () => {
    vi.mocked(getGoogleDriveClient).mockResolvedValue(
      scriptedDrive({
        files: [
          { id: "d1", name: "melon.jpg", mimeType: "image/jpeg", size: 5 },
        ],
        bytes: new Map([["d1", Buffer.from("HELLO")]]),
      }),
    );
    const shopify = scriptedShopify([
      // file lookup
      { data: { files: { edges: [{ node: { id: "gid://1", fileStatus: "READY" } }] } } },
      // stagedUploadsCreate
      {
        data: {
          stagedUploadsCreate: {
            stagedTargets: [
              {
                url: "https://staging.example/upload",
                resourceUrl: "https://staging.example/resource/abc",
                parameters: [{ name: "key", value: "abc" }],
              },
            ],
            userErrors: [],
          },
        },
      },
      // fileUpdate
      {
        data: {
          fileUpdate: {
            files: [{ id: "gid://1", fileStatus: "READY" }],
            userErrors: [],
          },
        },
      },
    ]);
    vi.mocked(getShopifyClient).mockResolvedValue(shopify);

    // Mock fetch for the multipart POST to the staging URL.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 200 }),
    );

    const res = await replaceFilesFromDriveFolderHandler(
      { driveFolderId: "FOLDER", confirm: true },
      makeCtx(),
    );
    expect(res.isError).toBeUndefined();
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("1/1 replaced");
    expect(text).toContain("melon.jpg");
    // 1 lookup + 1 stagedUploadsCreate + 1 fileUpdate
    expect(
      (shopify.request as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(3);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("captures per-file failures without aborting the batch", async () => {
    vi.mocked(getGoogleDriveClient).mockResolvedValue(
      scriptedDrive({
        files: [
          { id: "d1", name: "melon.jpg", mimeType: "image/jpeg", size: 5 },
          { id: "d2", name: "lemon.jpg", mimeType: "image/jpeg", size: 5 },
        ],
        bytes: new Map([
          ["d1", Buffer.from("AAAAA")],
          ["d2", Buffer.from("BBBBB")],
        ]),
      }),
    );
    const stagedTarget = {
      url: "https://staging.example/upload",
      resourceUrl: "https://staging.example/resource/x",
      parameters: [{ name: "key", value: "x" }],
    };
    const shopify = scriptedShopify([
      // 2 lookups
      { data: { files: { edges: [{ node: { id: "gid://1", fileStatus: "READY" } }] } } },
      { data: { files: { edges: [{ node: { id: "gid://2", fileStatus: "READY" } }] } } },
      // melon staged
      { data: { stagedUploadsCreate: { stagedTargets: [stagedTarget], userErrors: [] } } },
      // melon fileUpdate userError
      {
        data: {
          fileUpdate: {
            files: [],
            userErrors: [
              { field: ["files", "0"], message: "File too small.", code: "INVALID" },
            ],
          },
        },
      },
      // lemon staged
      { data: { stagedUploadsCreate: { stagedTargets: [stagedTarget], userErrors: [] } } },
      // lemon fileUpdate ok
      {
        data: {
          fileUpdate: {
            files: [{ id: "gid://2", fileStatus: "READY" }],
            userErrors: [],
          },
        },
      },
    ]);
    vi.mocked(getShopifyClient).mockResolvedValue(shopify);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 200 }),
    );

    const res = await replaceFilesFromDriveFolderHandler(
      { driveFolderId: "FOLDER", confirm: true },
      makeCtx(),
    );
    expect(res.isError).toBe(true);
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("1/2 replaced");
    expect(text).toContain("Failed:");
    expect(text).toContain("melon.jpg");
    expect(text).toContain("File too small");
    expect(text).toContain("Replaced:");
    expect(text).toContain("lemon.jpg");
  });
});
