import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

/**
 * Links an Instagram Business Account to a NAMI Works tenant.
 *
 * One-time setup action per tenant. Once linked, instagram_refresh_ingest
 * can pull the tenant's media, and the rest of the Instagram tool surface
 * (voice card, posts browsing, drafting) has data to work against.
 *
 * Two-step confirm: first call returns a preview, second call with
 * confirm=true executes the upsert. Refuses to overwrite an existing
 * InstagramAccount that has a different igUserId — that almost certainly
 * means the operator meant a different tenant.
 */

const IG_USER_ID_RE = /^17841\d{8,15}$/;

export async function instagramLinkAccountHandler(
  args: {
    igUserId: string;
    username?: string | undefined;
    confirm?: boolean | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const igUserId = args.igUserId.trim();
  const username = args.username?.trim();

  if (!IG_USER_ID_RE.test(igUserId)) {
    return {
      content: [
        {
          type: "text",
          text: `igUserId "${igUserId}" doesn't match the Instagram Business Account format (17841 followed by 8-15 digits). Verify the value from the Graph API Explorer: GET /{page_id}?fields=instagram_business_account.`,
        },
      ],
      isError: true,
    };
  }

  const existing = await prisma.instagramAccount.findUnique({
    where: { tenantId: ctx.tenant.id },
    select: { igUserId: true, username: true, lastSyncedAt: true, createdAt: true },
  });

  // Refuse to overwrite a row whose igUserId disagrees with the input — that
  // points at operator confusion (wrong tenant, wrong handle, copy-paste error)
  // and silently swapping IDs would orphan all the historical posts.
  if (existing && existing.igUserId !== igUserId) {
    return {
      content: [
        {
          type: "text",
          text:
            `Tenant ${ctx.tenant.slug} already has an InstagramAccount linked to a different igUserId.\n\n` +
            `  current: ${existing.igUserId}${existing.username ? ` (@${existing.username})` : ""}\n` +
            `  proposed: ${igUserId}${username ? ` (@${username})` : ""}\n\n` +
            `Refusing to overwrite. If you genuinely need to swap accounts, ask NAMI Works to handle this manually — historical InstagramPosts attached to the current account would otherwise be orphaned.`,
        },
      ],
      isError: true,
    };
  }

  const isCreate = !existing;
  const isUsernameUpdate =
    !!existing && !!username && existing.username !== username;
  const isNoop = !!existing && !isUsernameUpdate;

  if (isNoop) {
    return {
      content: [
        {
          type: "text",
          text:
            `Tenant ${ctx.tenant.slug} is already linked to igUserId ${igUserId}` +
            `${existing.username ? ` (@${existing.username})` : ""}. ` +
            `Linked since ${existing.createdAt.toISOString().slice(0, 10)}; ` +
            `last synced ${existing.lastSyncedAt?.toISOString().slice(0, 10) ?? "never"}. ` +
            `Nothing to do.`,
        },
      ],
    };
  }

  // First call — return preview.
  if (!args.confirm) {
    const preview: string[] = [];
    preview.push(`PREVIEW — instagram_link_account for tenant ${ctx.tenant.slug}`);
    preview.push("");
    if (isCreate) {
      preview.push(`Will CREATE a new InstagramAccount row:`);
      preview.push(`  tenant:   ${ctx.tenant.slug} (${ctx.tenant.id})`);
      preview.push(`  igUserId: ${igUserId}`);
      preview.push(`  username: ${username ?? "(not set)"}`);
    } else if (isUsernameUpdate) {
      preview.push(`Will UPDATE the existing InstagramAccount row's username:`);
      preview.push(`  tenant:   ${ctx.tenant.slug}`);
      preview.push(`  igUserId: ${igUserId} (unchanged)`);
      preview.push(`  username: ${existing.username ?? "(not set)"} → ${username}`);
    }
    preview.push("");
    preview.push(`Re-call with confirm=true to apply.`);
    return { content: [{ type: "text", text: preview.join("\n") }] };
  }

  // Second call — execute.
  if (isCreate) {
    await prisma.instagramAccount.create({
      data: {
        tenantId: ctx.tenant.id,
        igUserId,
        ...(username ? { username } : {}),
      },
    });
    return {
      content: [
        {
          type: "text",
          text:
            `✓ Linked Instagram account ${igUserId}${username ? ` (@${username})` : ""} to tenant ${ctx.tenant.slug}.\n\n` +
            `Next step: call instagram_refresh_ingest with mode="full" and maxPages=5 to pull the tenant's media into the gateway. Requires the long-lived FB token to be in SSM at \`${ctx.tenant.ssmPrefix}/instagram/long_lived_token\`.`,
        },
      ],
    };
  }

  // isUsernameUpdate
  await prisma.instagramAccount.update({
    where: { tenantId: ctx.tenant.id },
    data: { username: username ?? null },
  });
  return {
    content: [
      {
        type: "text",
        text: `✓ Updated username for tenant ${ctx.tenant.slug} to "${username}".`,
      },
    ],
  };
}

registerToolDefinition({
  name: "instagram_link_account",
  description:
    "Links an Instagram Business Account to the tenant — a one-time setup action required before any other Instagram tool can do anything. Pass the igUserId from the Meta Graph API (the 17841... numeric ID), optionally the username. Two-step confirm: first call returns a preview, second call with confirm=true executes. Refuses to overwrite an existing link to a different igUserId.",
  inputSchema: {
    igUserId: z
      .string()
      .min(13)
      .describe(
        "Instagram Business Account ID (17841 followed by 8-15 digits). Retrieve via Graph API: GET /{page_id}?fields=instagram_business_account.",
      ),
    username: z
      .string()
      .min(1)
      .max(60)
      .optional()
      .describe("Optional Instagram handle (without @). Stored for display only."),
    confirm: z
      .boolean()
      .optional()
      .describe("Set to true on the second call to execute. Without it, returns a preview."),
  },
  handler: instagramLinkAccountHandler,
});
