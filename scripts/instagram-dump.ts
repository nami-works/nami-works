import "dotenv/config";
import { parseArgs } from "node:util";
import { prisma } from "../src/db/prisma.js";
import { buildInstagramClient } from "../src/clients/instagram.js";
import { ingestInstagramPosts } from "../src/services/instagram/ingest.js";

/**
 * Dev-mode Instagram ingest. Bypasses SSM by reading the long-lived token
 * from `IG_LONG_LIVED_TOKEN` in the environment, so we can pull a tenant's
 * captions while the Meta App is still in Development mode (pre App Review).
 *
 * Usage:
 *   IG_LONG_LIVED_TOKEN=EAAB... \
 *     npm run instagram-dump -- \
 *       --tenant gebeauty \
 *       --ig-user-id 17841423297702015 \
 *       [--username gebeauty] \
 *       [--mode full|incremental] \
 *       [--max-pages 20]
 *
 * Idempotent — re-running upserts. First run should pass --mode full to
 * backfill the 10k-item window; subsequent runs default to incremental.
 *
 * Once the production OAuth flow lands, switch tenants over to
 * `getInstagramClient({ ssmPrefix })` and retire this script.
 */

function die(message: string, code = 1): never {
  console.error(`[instagram-dump] ${message}`);
  process.exit(code);
}

const { values } = parseArgs({
  options: {
    tenant: { type: "string" },
    "ig-user-id": { type: "string" },
    username: { type: "string" },
    mode: { type: "string" },
    "max-pages": { type: "string" },
  },
  strict: true,
});

const slug = values.tenant;
const igUserId = values["ig-user-id"];
const username = values.username;
const modeArg = values.mode ?? "incremental";
const maxPages = values["max-pages"] ? Number(values["max-pages"]) : 20;

if (!slug) die("--tenant <slug> is required");
if (!igUserId) die("--ig-user-id <17841...> is required");
if (modeArg !== "full" && modeArg !== "incremental") {
  die(`--mode must be 'full' or 'incremental', got '${modeArg}'`);
}
if (!Number.isFinite(maxPages) || maxPages < 1) die("--max-pages must be a positive integer");

const token = process.env.IG_LONG_LIVED_TOKEN;
if (!token || token.length < 20) {
  die("IG_LONG_LIVED_TOKEN env var is required (long-lived Facebook user/page token)");
}

async function main(): Promise<void> {
  const tenant = await prisma.integrationTenant.findUnique({
    where: { slug: slug! },
    include: { instagramAccount: true },
  });
  if (!tenant) die(`Tenant '${slug}' not found. Provision it first.`);

  if (!tenant.instagramAccount) {
    await prisma.instagramAccount.create({
      data: {
        tenantId: tenant.id,
        igUserId: igUserId!,
        ...(username ? { username } : {}),
      },
    });
    console.log(`[instagram-dump] created InstagramAccount for ${slug} (${igUserId})`);
  } else if (tenant.instagramAccount.igUserId !== igUserId) {
    die(
      `Tenant '${slug}' already has InstagramAccount with igUserId=${tenant.instagramAccount.igUserId}, refusing to overwrite with ${igUserId}.`,
    );
  } else if (username && tenant.instagramAccount.username !== username) {
    await prisma.instagramAccount.update({
      where: { tenantId: tenant.id },
      data: { username },
    });
  }

  const client = buildInstagramClient(token!);

  const result = await ingestInstagramPosts({
    tenantId: tenant.id,
    prisma,
    client,
    mode: modeArg as "full" | "incremental",
    maxPages,
  });

  console.log("[instagram-dump] done");
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err: unknown) => {
    console.error("[instagram-dump] failed:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
