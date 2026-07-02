import { z } from "zod";
import { Prisma } from "@prisma/client-connector";
import { prisma } from "../../db/prisma.js";
import { ensureFreshInstagram } from "../../services/instagram/ingest.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export async function searchCaptionsHandler(
  args: {
    query: string;
    limit?: number | undefined;
    caseSensitive?: boolean | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
  const caseSensitive = args.caseSensitive ?? false;

  await ensureFreshInstagram({ tenantId: ctx.tenant.id, prisma, logger: ctx.logger });

  const posts = await prisma.instagramPost.findMany({
    where: {
      tenantId: ctx.tenant.id,
      caption: {
        contains: args.query,
        mode: caseSensitive ? Prisma.QueryMode.default : Prisma.QueryMode.insensitive,
      },
    },
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
        {
          type: "text",
          text: `No Instagram posts mention "${args.query}" for tenant ${ctx.tenant.slug}.`,
        },
      ],
    };
  }

  const rows = posts.map((p) => {
    const date = p.postedAt.toISOString().slice(0, 10);
    const eng = `❤️${p.likeCount ?? "?"} 💬${p.commentsCount ?? "?"}`;
    const caption = p.caption ? truncate(p.caption.replace(/\n+/g, " ⏎ "), 220) : "(no caption)";
    const link = p.permalink ? ` ${p.permalink}` : "";
    return `[${date}] [${p.mediaType}] ${eng}${link}\n  ${caption}`;
  });

  const header = `${posts.length} posts mentioning "${args.query}" for ${ctx.tenant.slug}${caseSensitive ? " (case-sensitive)" : ""}:`;
  return { content: [{ type: "text", text: `${header}\n\n${rows.join("\n\n")}` }] };
}

registerToolDefinition({
  name: "instagram_search_captions",
  description:
    "Searches the tenant's ingested Instagram captions for a substring (case-insensitive by default). Returns matching posts with date, engagement, and permalinks. Useful for finding precedent posts on a product/campaign/topic before drafting new copy.",
  inputSchema: {
    query: z
      .string()
      .min(1)
      .describe("Substring to search for in captions, e.g. 'Melon Mood' or 'PRIMEIRACOMPRA20'."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Max matches to return (default 20, max 100)."),
    caseSensitive: z
      .boolean()
      .optional()
      .describe("If true, search is case-sensitive. Default false."),
  },
  handler: searchCaptionsHandler,
});
