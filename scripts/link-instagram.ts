import "dotenv/config";
import { parseArgs } from "node:util";
import { prisma } from "../src/db/prisma.js";

/**
 * Admin one-off: links an Instagram Business Account to a tenant in the DB.
 *
 * Usage:
 *   DATABASE_URL=<prod> npm run link-instagram -- \
 *     --slug gebeauty \
 *     --ig-user-id 17841423297702015 \
 *     [--username gebeauty]
 *
 * Idempotent. Refuses to overwrite an existing link to a different igUserId
 * (orphaning historical posts is worse than the operator having to confirm).
 *
 * Replaces the operator-facing instagram_link_account MCP tool for tenant
 * onboarding — setup actions belong here, not in chat.
 *
 * Future tenants: this is folded into scripts/provision-tenant.ts via
 * --ig-user-id / --ig-username flags so the link is created atomically with
 * the tenant row. Use this script ONLY when retrofitting an already-provisioned
 * tenant that was created before the flags existed.
 */

const IG_USER_ID_RE = /^17841\d{8,15}$/;

function die(message: string, code = 1): never {
  console.error(`[link-instagram] ${message}`);
  process.exit(code);
}

const { values } = parseArgs({
  options: {
    slug: { type: "string" },
    "ig-user-id": { type: "string" },
    username: { type: "string" },
  },
  strict: true,
});

const slug = values.slug;
const igUserId = values["ig-user-id"];
const username = values.username;

if (!slug) die("--slug <tenant-slug> is required");
if (!igUserId) die("--ig-user-id <17841...> is required");
if (!IG_USER_ID_RE.test(igUserId)) {
  die(
    `--ig-user-id "${igUserId}" doesn't match Instagram Business Account format (17841 + 8-15 digits)`,
  );
}

async function main(): Promise<void> {
  const tenant = await prisma.integrationTenant.findUnique({
    where: { slug: slug! },
    include: { instagramAccount: true },
  });
  if (!tenant) die(`Tenant '${slug}' not found.`);

  if (tenant.instagramAccount) {
    if (tenant.instagramAccount.igUserId !== igUserId) {
      die(
        `Tenant '${slug}' already linked to igUserId ${tenant.instagramAccount.igUserId}. Refusing to overwrite — historical posts would be orphaned. If you genuinely need to swap accounts, manually migrate or delete InstagramPost rows first.`,
      );
    }
    if (username && tenant.instagramAccount.username !== username) {
      await prisma.instagramAccount.update({
        where: { tenantId: tenant.id },
        data: { username },
      });
      console.log(
        `[link-instagram] updated username for ${slug}: ${tenant.instagramAccount.username ?? "(none)"} → ${username}`,
      );
    } else {
      console.log(
        `[link-instagram] tenant '${slug}' already linked to ${igUserId}${tenant.instagramAccount.username ? ` (@${tenant.instagramAccount.username})` : ""}. No-op.`,
      );
    }
    return;
  }

  const created = await prisma.instagramAccount.create({
    data: {
      tenantId: tenant.id,
      igUserId: igUserId!,
      ...(username ? { username } : {}),
    },
    select: { id: true, igUserId: true, username: true },
  });
  console.log(
    `[link-instagram] created InstagramAccount for tenant '${slug}': igUserId=${created.igUserId}${created.username ? ` username=@${created.username}` : ""}`,
  );
  console.log(
    `[link-instagram] next step: ensure /nami-works/tenants/${slug}/instagram/long_lived_token is set in SSM, then run instagram-dump (or call instagram_refresh_ingest from the deployed gateway).`,
  );
}

main()
  .catch((err: unknown) => {
    console.error("[link-instagram] failed:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
