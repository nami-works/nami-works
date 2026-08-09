import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { ingestInstagramPosts } from "../../services/instagram/ingest.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

export async function refreshIngestHandler(
  args: {
    mode?: "incremental" | "full" | undefined;
    maxPages?: number | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const mode = args.mode ?? "incremental";
  const maxPages = Math.min(Math.max(args.maxPages ?? 5, 1), 20);

  const account = await prisma.instagramAccount.findUnique({
    where: { tenantId: ctx.tenant.id },
    select: { igUserId: true, username: true, lastSyncedAt: true },
  });
  if (!account) {
    return {
      content: [
        {
          type: "text",
          text: `Tenant ${ctx.tenant.slug} has no linked Instagram account. An admin needs to insert an InstagramAccount row before refresh is possible.`,
        },
      ],
      isError: true,
    };
  }

  try {
    const result = await ingestInstagramPosts({
      tenantId: ctx.tenant.id,
      prisma,
      mode,
      maxPages,
      logger: ctx.logger,
    });

    const tokenLine =
      result.tokenExpiresInDays === null
        ? "Token expiry: unknown (no token_expires_at in SSM)."
        : result.tokenExpiresInDays <= 7
          ? `⚠️  Token expires in ${result.tokenExpiresInDays} days — refresh soon.`
          : `Token expires in ${result.tokenExpiresInDays} days.`;

    const body = [
      `Instagram refresh complete for ${result.tenantSlug} (${result.username ?? result.igUserId}).`,
      ``,
      `Mode: ${mode}`,
      `Pages fetched: ${result.pagesFetched} (cap=${maxPages})`,
      `Inserted: ${result.postsInserted}`,
      `Updated: ${result.postsUpdated}`,
      result.oldestPostedAt
        ? `Window: ${result.oldestPostedAt.toISOString().slice(0, 10)} → ${result.newestPostedAt?.toISOString().slice(0, 10) ?? "?"}`
        : `No posts returned (corpus already up to date).`,
      ``,
      tokenLine,
    ].join("\n");

    return { content: [{ type: "text", text: body }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("placeholder") || message.includes("long_lived_token")) {
      return {
        content: [
          {
            type: "text",
            text: `Instagram token for ${ctx.tenant.slug} is not yet configured in SSM. An admin needs to put the long-lived token at \`${ctx.tenant.ssmPrefix}/instagram/long_lived_token\` before refresh works in production. (Dev-mode env-var ingest still works via \`npm run instagram-dump\`.)`,
          },
        ],
        isError: true,
      };
    }
    throw err;
  }
}

registerToolDefinition({
  name: "instagram_refresh_ingest",
  description:
    "Triggers an incremental (default) or full ingest of the tenant's Instagram media into the InstagramPost table. Read-only on the Meta side — only fetches the tenant's own posts. Requires the long-lived token to be in SSM (see error message for path).",
  inputSchema: {
    mode: z
      .enum(["incremental", "full"])
      .optional()
      .describe(
        "'incremental' (default) pulls only posts newer than the latest stored. 'full' rewalks the 10k-item window for backfill.",
      ),
    maxPages: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe(
        "Safety cap on pages fetched per run (50 posts/page). Default 5 (≈250 posts), max 20 (≈1000).",
      ),
  },
  handler: refreshIngestHandler,
});
