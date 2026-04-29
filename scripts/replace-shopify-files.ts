/**
 * Bulk-replace files in a Shopify Files library by name.
 *
 * Walks a local folder of replacement images, matches each by exact filename
 * against the Shopify Files library, and replaces the bytes in place via the
 * `fileUpdate` mutation. Same file ID, same CDN path, new pixels — equivalent
 * to clicking "Replace" in Shopify Admin → Content → Files.
 *
 * Usage:
 *   npm run replace-shopify-files -- --tenant gebeauty \
 *     --folder "G:\\Drives compartilhados\\..." --dry-run
 *
 *   npm run replace-shopify-files -- --tenant gebeauty \
 *     --folder "G:\\Drives compartilhados\\..." --confirm
 *
 *   # Single file:
 *   npm run replace-shopify-files -- --tenant gebeauty \
 *     --folder "G:\\..." --filename melon-mood.jpg --confirm
 */

import "dotenv/config";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { parseArgs } from "node:util";
import { getShopifyClient } from "../src/clients/shopify.js";
import { prisma } from "../src/db/prisma.js";

const ALLOWED_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function die(msg: string, code = 1): never {
  console.error(`[replace-shopify-files] ${msg}`);
  process.exit(code);
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

const { values } = parseArgs({
  options: {
    tenant: { type: "string" },
    folder: { type: "string" },
    filename: { type: "string" },
    "dry-run": { type: "boolean" },
    confirm: { type: "boolean" },
  },
  strict: true,
});

const tenantSlug = values.tenant;
const folderPath = values.folder;
const filenameFilter = values.filename;
const isDryRun = values["dry-run"] === true;
const isConfirm = values.confirm === true;

if (!tenantSlug) die("--tenant is required");
if (!folderPath) die("--folder is required");
if (isDryRun === isConfirm) {
  die("Pass exactly one of --dry-run or --confirm (not both, not neither).");
}

// ---------- 1. Resolve tenant + Shopify client -----------------------------

const tenant = await prisma.integrationTenant.findUnique({
  where: { slug: tenantSlug },
});
if (!tenant) die(`No tenant found for slug "${tenantSlug}".`);
if (!tenant.shopifyShop) {
  die(`Tenant "${tenantSlug}" has no shopifyShop configured.`);
}

const client = await getShopifyClient({
  ssmPrefix: tenant.ssmPrefix,
  shopifyShop: tenant.shopifyShop,
});

console.log(
  `\nTenant: ${tenant.slug} (${tenant.displayName}) → ${tenant.shopifyShop}`,
);
console.log(`Folder: ${folderPath}`);
console.log(`Mode:   ${isDryRun ? "DRY-RUN (no mutations)" : "EXECUTE"}\n`);

// ---------- 2. Walk local folder -------------------------------------------

type Candidate = {
  filename: string;
  path: string;
  size: number;
  mime: string;
};

let entries: string[];
try {
  entries = await readdir(folderPath);
} catch (err) {
  die(
    `Cannot read folder ${folderPath}: ${err instanceof Error ? err.message : String(err)}`,
  );
}

const candidates: Candidate[] = [];
for (const entry of entries) {
  const ext = extname(entry).toLowerCase();
  if (!ALLOWED_EXTS.includes(ext)) continue;
  if (filenameFilter && entry !== filenameFilter) continue;
  const fullPath = join(folderPath, entry);
  const stats = await stat(fullPath);
  if (!stats.isFile()) continue;
  candidates.push({
    filename: entry,
    path: fullPath,
    size: stats.size,
    mime: MIME_BY_EXT[ext] ?? "application/octet-stream",
  });
}

if (candidates.length === 0) {
  die(
    filenameFilter
      ? `No file named "${filenameFilter}" with an image extension was found in ${folderPath}.`
      : `No image files (${ALLOWED_EXTS.join(", ")}) found in ${folderPath}.`,
  );
}

console.log(`Found ${candidates.length} local file(s) to process.\n`);

// ---------- 3. Look up each candidate in Shopify's Files library -----------

const FILES_QUERY = /* GraphQL */ `
  query FilesByName($query: String!) {
    files(first: 5, query: $query) {
      edges {
        node {
          id
          fileStatus
          alt
          updatedAt
          ... on MediaImage {
            image {
              url
            }
          }
          ... on GenericFile {
            url
          }
        }
      }
    }
  }
`;

type FileNode = {
  id: string;
  fileStatus: string;
  alt: string | null;
  updatedAt: string;
  image?: { url: string | null } | null;
  url?: string | null;
};

type FilesQueryResp = {
  files: { edges: Array<{ node: FileNode }> };
};

type Plan =
  | { kind: "match"; candidate: Candidate; file: FileNode }
  | { kind: "not_found"; candidate: Candidate }
  | { kind: "ambiguous"; candidate: Candidate; matches: FileNode[] };

const plans: Plan[] = [];
for (const c of candidates) {
  const res = await client.request<FilesQueryResp>(FILES_QUERY, {
    variables: { query: `filename:${c.filename}` },
  });
  if (res.errors) {
    die(
      `Shopify GraphQL error looking up ${c.filename}: ${res.errors.message ?? "unknown"}`,
    );
  }
  const nodes = (res.data?.files.edges ?? []).map((e) => e.node);
  if (nodes.length === 0) {
    plans.push({ kind: "not_found", candidate: c });
  } else if (nodes.length === 1) {
    plans.push({ kind: "match", candidate: c, file: nodes[0]! });
  } else {
    plans.push({ kind: "ambiguous", candidate: c, matches: nodes });
  }
}

// ---------- 4. Print plan --------------------------------------------------

const matches = plans.filter((p): p is Extract<Plan, { kind: "match" }> => p.kind === "match");
const notFound = plans.filter((p) => p.kind === "not_found");
const ambiguous = plans.filter((p): p is Extract<Plan, { kind: "ambiguous" }> => p.kind === "ambiguous");

console.log("Plan:\n");
plans.forEach((p, i) => {
  const idx = `[${(i + 1).toString().padStart(2, " ")}/${plans.length}]`;
  if (p.kind === "match") {
    console.log(
      `${idx} ${p.candidate.filename} → ${p.file.id} (replacing with ${fmtBytes(p.candidate.size)})`,
    );
  } else if (p.kind === "not_found") {
    console.log(
      `${idx} ${p.candidate.filename} → SKIP: no Shopify file with this name`,
    );
  } else {
    console.log(
      `${idx} ${p.candidate.filename} → SKIP: ${p.matches.length} ambiguous matches in Shopify`,
    );
    for (const m of p.matches) console.log(`         - ${m.id}`);
  }
});
console.log(
  `\n${matches.length} will replace, ${notFound.length} not found, ${ambiguous.length} ambiguous.`,
);

if (isDryRun) {
  console.log("\nDry-run only — re-run with --confirm to execute.");
  await prisma.$disconnect();
  process.exit(0);
}

if (matches.length === 0) {
  console.log("\nNothing to replace. Exiting.");
  await prisma.$disconnect();
  process.exit(0);
}

// ---------- 5. Execute fileUpdate per matched file -------------------------

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
      files { id fileStatus updatedAt }
      userErrors { field message code }
    }
  }
`;

type FileUpdateResp = {
  fileUpdate: {
    files: Array<{ id: string; fileStatus: string; updatedAt: string }>;
    userErrors: Array<{
      field: string[] | null;
      message: string;
      code: string | null;
    }>;
  };
};

console.log(`\nExecuting ${matches.length} replacement(s)...\n`);

const successes: string[] = [];
const failures: { filename: string; reason: string }[] = [];

for (let i = 0; i < matches.length; i++) {
  const p = matches[i]!;
  const idx = `[${(i + 1).toString().padStart(2, " ")}/${matches.length}]`;
  const start = Date.now();

  try {
    // 5a. Stage upload
    const stagedRes = await client.request<StagedUploadResp>(
      STAGED_UPLOAD_MUT,
      {
        variables: {
          input: [
            {
              filename: p.candidate.filename,
              mimeType: p.candidate.mime,
              fileSize: String(p.candidate.size),
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
    const userErrs = stagedRes.data?.stagedUploadsCreate.userErrors ?? [];
    if (userErrs.length > 0) {
      throw new Error(
        `stagedUploadsCreate: ${userErrs.map((e) => e.message).join("; ")}`,
      );
    }
    const target = stagedRes.data?.stagedUploadsCreate.stagedTargets[0];
    if (!target) throw new Error("stagedUploadsCreate returned no target");

    // 5b. Multipart POST bytes to Shopify staging URL
    const form = new FormData();
    for (const param of target.parameters) {
      form.append(param.name, param.value);
    }
    // Stream the file as a Blob (Node 20+ supports this).
    const fileChunks: Buffer[] = [];
    for await (const chunk of createReadStream(p.candidate.path)) {
      fileChunks.push(chunk as Buffer);
    }
    const blob = new Blob([Buffer.concat(fileChunks)], { type: p.candidate.mime });
    form.append("file", blob, p.candidate.filename);

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

    // 5c. fileUpdate to swap bytes on the existing file ID
    const updateRes = await client.request<FileUpdateResp>(FILE_UPDATE_MUT, {
      variables: {
        files: [
          { id: p.file.id, originalSource: target.resourceUrl },
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

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`${idx} ${p.candidate.filename} → done (${elapsed}s)`);
    successes.push(p.candidate.filename);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.log(`${idx} ${p.candidate.filename} → FAILED: ${reason}`);
    failures.push({ filename: p.candidate.filename, reason });
  }
}

// ---------- 6. Summary -----------------------------------------------------

console.log(
  `\n${successes.length}/${matches.length} succeeded. ` +
    `Skipped before run: ${notFound.length + ambiguous.length}.`,
);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f.filename}: ${f.reason}`);
}

await prisma.$disconnect();
process.exit(failures.length > 0 ? 2 : 0);

// Reference: `basename` is imported above to keep the import surface honest
// in case future maintainers extract a sub-folder mode.
void basename;
