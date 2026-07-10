import { z } from "zod";
import { Prisma } from "@prisma/client-connector";
import { prisma } from "../../db/prisma.js";
import { ensureFreshInstagram } from "../../services/instagram/ingest.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const MEDIA_TYPES = ["IMAGE", "VIDEO", "CAROUSEL_ALBUM"] as const;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export async function recentPostsHandler(
  args: {
    limit?: number | undefined;
    mediaType?: (typeof MEDIA_TYPES)[number] | undefined;
    since?: string | undefined;
    until?: string | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);

  await ensureFreshInstagram({ tenantId: ctx.tenant.id, prisma, logger: ctx.logger });

  const where: Prisma.InstagramPostWhereInput = { tenantId: ctx.tenant.id };
  if (args.mediaType) where.mediaType = args.mediaType;
  if (args.since || args.until) {
    where.postedAt = {};
    if (args.since) where.postedAt.gte = new Date(args.since);
    if (args.until) where.postedAt.lte = new Date(args.until);
  }

  const posts = await prisma.instagramPost.findMany({
    where,
    orderBy: { postedAt: "desc" },
    take: limit,
    select: {
      igMediaId: true,
      mediaType: true,
      caption: true,
      permalink: true,
      postedAt: true,
      likeCount: true,
      commentsCount: true,
    },
  });

  if (posts.length === 0) {
    return {
      content: [
        { type: "text", text: `No Instagram posts found for tenant ${ctx.tenant.slug} matching the filters.` },
      ],
    };
  }

  const rows = posts.map((p) => {
    const date = p.postedAt.toISOString().slice(0, 10);
    const eng = `❤️${p.likeCount ?? "?"} 💬${p.commentsCount ?? "?"}`;
    const caption = p.caption ? truncate(p.caption.replace(/\n+/g, " ⏎ "), 180) : "(no caption)";
    const link = p.permalink ? ` ${p.permalink}` : "";
    return `[${date}] [${p.mediaType}] ${eng}${link}\n  ${caption}`;
  });

  const header = `Last ${posts.length} Instagram posts for ${ctx.tenant.slug}${args.mediaType ? ` (mediaType=${args.mediaType})` : ""}:`;
  return { content: [{ type: "text", text: `${header}\n\n${rows.join("\n\n")}` }] };
}

registerToolDefinition({
  name: "instagram_recent_posts",
  description:
    "Lists the tenant's most recent ingested Instagram posts with captions, engagement counts, and permalinks. Filterable by media type and date range. Read-only — auto-refreshes the corpus from Instagram if it's stale (older than ~6h) before answering.",
  inputSchema: {
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("How many posts to return (default 20, max 100)."),
    mediaType: z
      .enum(MEDIA_TYPES)
      .optional()
      .describe("Filter by media type: IMAGE, VIDEO, or CAROUSEL_ALBUM."),
    since: z
      .string()
      .optional()
      .describe("ISO date (YYYY-MM-DD) — only posts on or after this date."),
    until: z
      .string()
      .optional()
      .describe("ISO date (YYYY-MM-DD) — only posts on or before this date."),
  },
  handler: recentPostsHandler,
});
