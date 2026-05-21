import { z } from "zod";
import { Prisma } from "@prisma/client-connector";
import { prisma } from "../../db/prisma.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const MEDIA_TYPES = ["IMAGE", "VIDEO", "CAROUSEL_ALBUM"] as const;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export async function topPostsHandler(
  args: {
    limit?: number | undefined;
    mediaType?: (typeof MEDIA_TYPES)[number] | undefined;
    since?: string | undefined;
    until?: string | undefined;
    metric?: "likes" | "comments" | "engagement" | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);
  const metric = args.metric ?? "engagement";

  const where: Prisma.InstagramPostWhereInput = { tenantId: ctx.tenant.id };
  if (args.mediaType) where.mediaType = args.mediaType;
  if (args.since || args.until) {
    where.postedAt = {};
    if (args.since) where.postedAt.gte = new Date(args.since);
    if (args.until) where.postedAt.lte = new Date(args.until);
  }

  // Prisma can't order by a computed sum, so for "engagement" we fetch a
  // generous superset (top by likes), sort in memory, then slice. For pure
  // likes/comments rankings, the DB does it directly.
  const fetchSize = metric === "engagement" ? Math.min(limit * 5, 500) : limit;

  const posts = await prisma.instagramPost.findMany({
    where,
    orderBy: metric === "comments" ? { commentsCount: "desc" } : { likeCount: "desc" },
    take: fetchSize,
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

  const ranked =
    metric === "engagement"
      ? [...posts]
          .sort(
            (a, b) =>
              ((b.likeCount ?? 0) + (b.commentsCount ?? 0)) -
              ((a.likeCount ?? 0) + (a.commentsCount ?? 0)),
          )
          .slice(0, limit)
      : posts;

  if (ranked.length === 0) {
    return {
      content: [
        { type: "text", text: `No Instagram posts found for tenant ${ctx.tenant.slug} matching the filters.` },
      ],
    };
  }

  const rows = ranked.map((p, idx) => {
    const date = p.postedAt.toISOString().slice(0, 10);
    const eng = `❤️${p.likeCount ?? "?"} 💬${p.commentsCount ?? "?"}`;
    const caption = p.caption ? truncate(p.caption.replace(/\n+/g, " ⏎ "), 180) : "(no caption)";
    const link = p.permalink ? ` ${p.permalink}` : "";
    return `#${idx + 1} [${date}] [${p.mediaType}] ${eng}${link}\n  ${caption}`;
  });

  const windowDesc =
    args.since || args.until
      ? ` (${args.since ?? "…"} → ${args.until ?? "…"})`
      : "";
  const header = `Top ${ranked.length} posts by ${metric} for ${ctx.tenant.slug}${windowDesc}${args.mediaType ? ` [${args.mediaType}]` : ""}:`;
  return { content: [{ type: "text", text: `${header}\n\n${rows.join("\n\n")}` }] };
}

registerToolDefinition({
  name: "instagram_top_posts",
  description:
    "Ranks the tenant's ingested Instagram posts by engagement (likes + comments by default) and returns the top N. Useful for finding what resonated, sampling few-shots for drafting, or spotting outliers. Filterable by media type and date range.",
  inputSchema: {
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("How many top posts to return (default 10, max 50)."),
    mediaType: z
      .enum(MEDIA_TYPES)
      .optional()
      .describe("Filter by media type: IMAGE, VIDEO, or CAROUSEL_ALBUM."),
    since: z.string().optional().describe("ISO date (YYYY-MM-DD)."),
    until: z.string().optional().describe("ISO date (YYYY-MM-DD)."),
    metric: z
      .enum(["likes", "comments", "engagement"])
      .optional()
      .describe(
        "Ranking metric. 'engagement' (default) = likes + comments. 'likes' or 'comments' for single-signal sorts.",
      ),
  },
  handler: topPostsHandler,
});
