import { z } from "zod";
import { getGoogleDriveClient } from "../../clients/google-drive.js";
import { getShopifyClient } from "../../clients/shopify.js";
import { confirmationPreview } from "../../lib/confirm.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
const IMAGE_MIME_PREFIXES = ["image/"];

const DEFAULT_MAX_FILES = 50;

function isImageMime(mime: string): boolean {
  return IMAGE_MIME_PREFIXES.some((p) => mime.toLowerCase().startsWith(p));
}

function isImageExt(filename: string): boolean {
  const lower = filename.toLowerCase();
  return IMAGE_EXTS.some((ext) => lower.endsWith(ext));
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// ---------- Shopify GraphQL ------------------------------------------------

const FILES_QUERY = /* GraphQL */ `
  query FilesByName($query: String!) {
    files(first: 5, query: $query) {
      edges {
        node {
          id
          fileStatus
          ... on MediaImage { image { url } }
          ... on GenericFile { url }
        }
      }
    }
  }
`;

type ShopifyFileNode = {
  id: string;
  fileStatus: string;
  image?: { url: string | null } | null;
  url?: string | null;
};

type FilesQueryResp = {
  files: { edges: Array<{ node: ShopifyFileNode }> };
};

const STAGED_UPLOAD_MUT = /* GraphQL */ `
  mutation StagedUploads($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }
`;

type StagedUploadResp = {
  stagedUploadsCreate: {
    stagedTargets: Array<{
      url: string;
      resourceUrl: string;
      parameters: Array<{ name: string; value: string }>;
    }>;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
};

const FILE_UPDATE_MUT = /* GraphQL */ `
  mutation FileUpdate($files: [FileUpdateInput!]!) {
    fileUpdate(files: $files) {
      files { id fileStatus }
      userErrors { field message code }
    }
  }
`;

type FileUpdateResp = {
  fileUpdate: {
    files: Array<{ id: string; fileStatus: string }>;
    userErrors: Array<{
      field: string[] | null;
      message: string;
      code: string | null;
    }>;
  };
};

// ---------- Handler --------------------------------------------------------

type Args = {
  driveFolderId: string;
  filenameFilter?: string | undefined;
  maxFiles?: number | undefined;
  confirm?: boolean | undefined;
};

type Plan =
  | {
      kind: "match";
      driveFile: { id: string; name: string; size: number; mimeType: string };
      shopifyFileId: string;
    }
  | {
      kind: "not_found";
      driveFile: { name: string; size: number };
    }
  | {
      kind: "ambiguous";
      driveFile: { name: string };
      shopifyFileIds: string[];
    };

export async function replaceFilesFromDriveFolderHandler(
  args: Args,
  ctx: ToolContext,
): Promise<ToolResult> {
  const folderId = args.driveFolderId.trim();
  if (!folderId) {
    return {
      content: [{ type: "text", text: "driveFolderId is required." }],
      isError: true,
    };
  }
  const maxFiles = Math.max(
    1,
    Math.min(args.maxFiles ?? DEFAULT_MAX_FILES, 100),
  );

  // Build clients up front so creds errors surface before we do work.
  const drive = await getGoogleDriveClient({ ssmPrefix: ctx.tenant.ssmPrefix });
  const shopify = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  // 1. List Drive folder → keep only image-shaped files, optionally filter by name
  const allDriveFiles = await drive.listFolderContents(folderId);
  const driveImages = allDriveFiles
    .filter((f) => isImageMime(f.mimeType) || isImageExt(f.name))
    .filter((f) => !args.filenameFilter || f.name === args.filenameFilter)
    .slice(0, maxFiles);

  if (driveImages.length === 0) {
    return {
      content: [
        {
          type: "text",
          text:
            (args.filenameFilter
              ? `No file named "${args.filenameFilter}" found in Drive folder ${folderId}.`
              : `No image files found in Drive folder ${folderId}.`) +
            ` (Total entries in folder: ${allDriveFiles.length}.)`,
        },
      ],
    };
  }

  // 2. Look up each Drive image in Shopify Files by exact filename
  const plans: Plan[] = [];
  for (const df of driveImages) {
    const res = await shopify.request<FilesQueryResp>(FILES_QUERY, {
      variables: { query: `filename:${df.name}` },
    });
    if (res.errors) {
      throw new Error(
        `Shopify GraphQL error looking up ${df.name}: ${res.errors.message ?? "unknown"}`,
      );
    }
    const nodes = (res.data?.files.edges ?? []).map((e) => e.node);
    if (nodes.length === 0) {
      plans.push({
        kind: "not_found",
        driveFile: { name: df.name, size: df.size },
      });
    } else if (nodes.length === 1) {
      plans.push({
        kind: "match",
        driveFile: {
          id: df.id,
          name: df.name,
          size: df.size,
          mimeType: df.mimeType,
        },
        shopifyFileId: nodes[0]!.id,
      });
    } else {
      plans.push({
        kind: "ambiguous",
        driveFile: { name: df.name },
        shopifyFileIds: nodes.map((n) => n.id),
      });
    }
  }

  const matches = plans.filter(
    (p): p is Extract<Plan, { kind: "match" }> => p.kind === "match",
  );
  const notFound = plans.filter((p) => p.kind === "not_found");
  const ambiguous = plans.filter(
    (p): p is Extract<Plan, { kind: "ambiguous" }> => p.kind === "ambiguous",
  );

  // 3. Build preview text
  const previewLines: string[] = [];
  previewLines.push(`Drive folder ${folderId}: ${driveImages.length} image file(s)`);
  previewLines.push(``);
  plans.forEach((p, i) => {
    const idx = `${(i + 1).toString().padStart(2, " ")}.`;
    if (p.kind === "match") {
      previewLines.push(
        `${idx} ${p.driveFile.name} → ${p.shopifyFileId} (${fmtBytes(p.driveFile.size)})`,
      );
    } else if (p.kind === "not_found") {
      previewLines.push(
        `${idx} ${p.driveFile.name} → SKIP: no Shopify file with this name`,
      );
    } else {
      previewLines.push(
        `${idx} ${p.driveFile.name} → SKIP: ${p.shopifyFileIds.length} ambiguous Shopify matches`,
      );
    }
  });
  previewLines.push(``);
  previewLines.push(
    `${matches.length} will replace, ${notFound.length} not found, ${ambiguous.length} ambiguous.`,
  );

  if (args.confirm !== true) {
    return confirmationPreview({
      summary: previewLines.join("\n"),
      actionLabel: `replace ${matches.length} Shopify file(s) with Drive contents`,
    });
  }

  if (matches.length === 0) {
    return {
      content: [
        {
          type: "text",
          text:
            `Nothing to replace.\n\n${previewLines.join("\n")}`,
        },
      ],
    };
  }

  // 4. Execute replacement per match
  const successes: string[] = [];
  const failures: { name: string; reason: string }[] = [];

  for (const m of matches) {
    try {
      // 4a. Download bytes from Drive
      const bytes = await drive.downloadFile(m.driveFile.id);

      // 4b. Stage upload on Shopify
      const stagedRes = await shopify.request<StagedUploadResp>(
        STAGED_UPLOAD_MUT,
        {
          variables: {
            input: [
              {
                filename: m.driveFile.name,
                mimeType: m.driveFile.mimeType,
                fileSize: String(bytes.byteLength),
                resource: "FILE",
                httpMethod: "POST",
              },
            ],
          },
        },
      );
      if (stagedRes.errors) {
        throw new Error(
          `stagedUploadsCreate transport: ${stagedRes.errors.message ?? "unknown"}`,
        );
      }
      const stagedErrs = stagedRes.data?.stagedUploadsCreate.userErrors ?? [];
      if (stagedErrs.length > 0) {
        throw new Error(
          `stagedUploadsCreate: ${stagedErrs.map((e) => e.message).join("; ")}`,
        );
      }
      const target = stagedRes.data?.stagedUploadsCreate.stagedTargets[0];
      if (!target) throw new Error("stagedUploadsCreate returned no target");

      // 4c. Multipart POST bytes to Shopify staging URL
      const form = new FormData();
      for (const param of target.parameters) {
        form.append(param.name, param.value);
      }
      form.append(
        "file",
        new Blob([bytes], { type: m.driveFile.mimeType }),
        m.driveFile.name,
      );
      const uploadRes = await fetch(target.url, {
        method: "POST",
        body: form,
      });
      if (!uploadRes.ok) {
        const body = await uploadRes.text().catch(() => "<no body>");
        throw new Error(
          `Upload to staging URL returned ${uploadRes.status}: ${body.slice(0, 200)}`,
        );
      }

      // 4d. fileUpdate to swap bytes on the existing file ID
      const updateRes = await shopify.request<FileUpdateResp>(FILE_UPDATE_MUT, {
        variables: {
          files: [
            { id: m.shopifyFileId, originalSource: target.resourceUrl },
          ],
        },
      });
      if (updateRes.errors) {
        throw new Error(
          `fileUpdate transport: ${updateRes.errors.message ?? "unknown"}`,
        );
      }
      const updErrs = updateRes.data?.fileUpdate.userErrors ?? [];
      if (updErrs.length > 0) {
        throw new Error(
          `fileUpdate: ${updErrs.map((e) => `${e.code ?? ""} ${e.message}`).join("; ")}`,
        );
      }

      successes.push(m.driveFile.name);
    } catch (err) {
      failures.push({
        name: m.driveFile.name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const resultLines: string[] = [];
  resultLines.push(
    `${successes.length}/${matches.length} replaced. Skipped before run: ${notFound.length + ambiguous.length}.`,
  );
  if (successes.length > 0) {
    resultLines.push(``);
    resultLines.push("Replaced:");
    for (const n of successes) resultLines.push(`  • ${n}`);
  }
  if (failures.length > 0) {
    resultLines.push(``);
    resultLines.push("Failed:");
    for (const f of failures) resultLines.push(`  • ${f.name}: ${f.reason}`);
  }

  return {
    content: [{ type: "text", text: resultLines.join("\n") }],
    ...(failures.length > 0 ? { isError: true } : {}),
  };
}

registerToolDefinition({
  name: "shopify_replace_files_from_drive_folder",
  description:
    "Replace files in Shopify's Files library with new versions from a Google Drive folder. Matches by exact filename. Same Shopify file ID and CDN path stay intact (equivalent to the 'Replace' button in Admin → Content → Files); only the bytes change. Two-step: first call (no confirm) returns a preview of matches/skips; call again with confirm: true to execute.",
  inputSchema: {
    driveFolderId: z
      .string()
      .min(1)
      .describe(
        "Google Drive folder ID (the part after /folders/ in the Drive URL).",
      ),
    filenameFilter: z
      .string()
      .optional()
      .describe(
        "Optional. If set, only the file with this exact name in the Drive folder is processed. Useful for smoke-testing one swap before running the batch.",
      ),
    maxFiles: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe(
        "Cap the number of files processed in one call. Defaults to 50 to keep tool latency under MCP timeouts. For larger batches, run multiple times with filename filters.",
      ),
    confirm: z
      .boolean()
      .optional()
      .describe(
        "Set to true on the second call to execute the replacement. Without confirm, only a preview is returned.",
      ),
  },
  handler: replaceFilesFromDriveFolderHandler,
});
