import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

/**
 * brand_tone_current — single-call brand-voice guide for the tenant.
 *
 * Bundles the latest VoiceCard + stratified exemplar captions + ready-to-apply
 * guidance into one tool response. The point is to short-circuit the
 * multi-tool-chain that Claude.ai would otherwise run when an operator asks
 * "match the brand voice" — voice card lookup + top posts + caption search —
 * so the gateway returns everything needed in one shot.
 *
 * Output is intentionally formatted as a prompt-like guidance block so the
 * reading model (Claude.ai's Claude) treats the response as binding spec
 * rather than as data to summarize.
 *
 * Stratification: exemplars are pulled per media type (VIDEO / CAROUSEL_ALBUM
 * / IMAGE) to surface format diversity. Top engagement within each type.
 */

type VoiceCardData = {
  language?: string;
  register?: string;
  formality?: string;
  signature_phrases?: string[];
  banned_constructions?: string[];
  hooks?: Array<{ pattern: string; example: string }>;
  ctas?: Array<{ template: string; usage: string }>;
  emoji_palette?: Array<{ emoji: string; usage: string }>;
  emoji_density?: string;
  hashtag_policy?: string;
  people_pattern?: string;
  segmentation_pattern?: string;
  tech_spec_pattern?: string;
  engagement_pattern?: string;
  do_examples?: string[];
  dont_examples?: string[];
  notes?: string;
};

type ExemplarPost = {
  igMediaId: string;
  postedAt: Date;
  mediaType: string;
  caption: string;
  likeCount: number | null;
  commentsCount: number | null;
};

async function pickExemplars(
  tenantId: string,
  count: number,
): Promise<ExemplarPost[]> {
  const perType = Math.ceil(count / 3);
  const baseWhere: Prisma.InstagramPostWhereInput = {
    tenantId,
    caption: { not: null },
  };
  const select = {
    igMediaId: true,
    postedAt: true,
    mediaType: true,
    caption: true,
    likeCount: true,
    commentsCount: true,
  } as const;
  const orderBy: Prisma.InstagramPostOrderByWithRelationInput[] = [
    { likeCount: "desc" },
    { commentsCount: "desc" },
  ];
  const [videos, carousels, images] = await Promise.all([
    prisma.instagramPost.findMany({
      where: { ...baseWhere, mediaType: "VIDEO" },
      orderBy,
      take: perType,
      select,
    }),
    prisma.instagramPost.findMany({
      where: { ...baseWhere, mediaType: "CAROUSEL_ALBUM" },
      orderBy,
      take: perType,
      select,
    }),
    prisma.instagramPost.findMany({
      where: { ...baseWhere, mediaType: "IMAGE" },
      orderBy,
      take: perType,
      select,
    }),
  ]);
  // Filter the nullable-caption type guard.
  const all = [...videos, ...carousels, ...images].filter(
    (p): p is ExemplarPost => p.caption !== null,
  );
  // Engagement-sort the combined pool and take the requested count.
  return all
    .sort(
      (a, b) =>
        (b.likeCount ?? 0) + (b.commentsCount ?? 0) -
        ((a.likeCount ?? 0) + (a.commentsCount ?? 0)),
    )
    .slice(0, count);
}

function fmtList(items: string[] | undefined, max = 12): string {
  if (!items || items.length === 0) return "(none recorded)";
  const slice = items.slice(0, max);
  const more =
    items.length > max ? `\n  …and ${items.length - max} more` : "";
  return slice.map((s) => `  • ${s}`).join("\n") + more;
}

function fmtKVList(
  items: Array<{ [k: string]: string }> | undefined,
  keyA: string,
  keyB: string,
  max = 8,
): string {
  if (!items || items.length === 0) return "(none recorded)";
  const slice = items.slice(0, max);
  return slice
    .map((it) => {
      const a = it[keyA] ?? "";
      const b = it[keyB] ?? "";
      return `  • ${a}${b ? `  — ${b}` : ""}`;
    })
    .join("\n");
}

function renderGuide(args: {
  card: VoiceCardData;
  tenantDisplay: string;
  generatedAt: Date;
  modelId: string;
  corpusSize: number;
  exemplars: ExemplarPost[];
}): string {
  const { card, tenantDisplay, generatedAt, modelId, corpusSize, exemplars } =
    args;

  const out: string[] = [];

  out.push(`# BRAND VOICE GUIDE — ${tenantDisplay}`);
  out.push("");
  out.push(
    "Apply this guide as a BINDING spec when drafting any brand-facing copy",
  );
  out.push(
    "(captions, pop-ups, emails, SMS, product blurbs, ad copy). Do not paraphrase",
  );
  out.push(
    "the signature phrases or CTAs — use them verbatim or near-verbatim. Respect",
  );
  out.push("every banned construction.");
  out.push("");
  out.push("---");
  out.push("");

  out.push("## Language & register");
  if (card.language) out.push(`- Language: ${card.language}`);
  if (card.register) out.push(`- Register: ${card.register}`);
  if (card.formality) out.push(`- Formality: ${card.formality}`);
  if (card.emoji_density) out.push(`- Emoji density: ${card.emoji_density}`);
  if (card.hashtag_policy) out.push(`- Hashtag policy: ${card.hashtag_policy}`);
  out.push("");

  out.push("## NEVER use (banned constructions)");
  out.push(fmtList(card.banned_constructions, 20));
  out.push("");

  out.push("## Signature phrases — use verbatim or near-verbatim");
  out.push(fmtList(card.signature_phrases, 20));
  out.push("");

  out.push("## Default CTAs");
  out.push(fmtKVList(card.ctas as Array<{ [k: string]: string }> | undefined, "template", "usage", 8));
  out.push("");

  out.push("## Opening hooks (patterns + canonical example)");
  out.push(fmtKVList(card.hooks as Array<{ [k: string]: string }> | undefined, "pattern", "example", 10));
  out.push("");

  out.push("## Emoji palette (use with intent, not decoratively)");
  out.push(fmtKVList(card.emoji_palette as Array<{ [k: string]: string }> | undefined, "emoji", "usage", 25));
  out.push("");

  if (card.people_pattern) {
    out.push("## How the brand surfaces people");
    out.push(`  ${card.people_pattern}`);
    out.push("");
  }
  if (card.segmentation_pattern) {
    out.push("## How the brand addresses sub-audiences");
    out.push(`  ${card.segmentation_pattern}`);
    out.push("");
  }
  if (card.tech_spec_pattern) {
    out.push("## How the brand presents technical specs");
    out.push(`  ${card.tech_spec_pattern}`);
    out.push("");
  }
  if (card.engagement_pattern) {
    out.push("## How the brand invites engagement");
    out.push(`  ${card.engagement_pattern}`);
    out.push("");
  }

  out.push("## DO — example sentences a drafter should emulate");
  out.push(fmtList(card.do_examples, 12));
  out.push("");

  out.push("## DON'T — sentences that would feel off-brand");
  out.push(fmtList(card.dont_examples, 12));
  out.push("");

  if (exemplars.length > 0) {
    out.push("---");
    out.push("");
    out.push(
      `## Real high-engagement examples (${exemplars.length}, stratified across video/carousel/image)`,
    );
    out.push(
      "These are actual captions the brand published. Mimic the pattern, not the substance.",
    );
    out.push("");
    for (const p of exemplars) {
      const date = p.postedAt.toISOString().slice(0, 10);
      const eng = `❤️${p.likeCount ?? "?"} 💬${p.commentsCount ?? "?"}`;
      out.push(`### [${date}] [${p.mediaType}] ${eng}`);
      out.push("");
      out.push(p.caption.trim());
      out.push("");
    }
  }

  if (card.notes) {
    out.push("---");
    out.push("");
    out.push("## Additional notes (caveats, drift signals, outlier patterns)");
    out.push(card.notes);
    out.push("");
  }

  out.push("---");
  out.push(
    `_voice card generated ${generatedAt.toISOString().slice(0, 10)} from a corpus of ${corpusSize} posts using ${modelId}_`,
  );

  return out.join("\n");
}

export async function brandToneCurrentHandler(
  args: {
    exemplarCount?: number | undefined;
    includeRawCard?: boolean | undefined;
    source?: string | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const exemplarCount = Math.min(Math.max(args.exemplarCount ?? 8, 3), 15);
  const source = args.source ?? "instagram";

  const voiceCard = await prisma.voiceCard.findFirst({
    where: { tenantId: ctx.tenant.id, source },
    orderBy: { generatedAt: "desc" },
  });

  if (!voiceCard) {
    return {
      content: [
        {
          type: "text",
          text:
            `No brand voice card exists for tenant ${ctx.tenant.slug} (source=${source}). ` +
            `Run instagram_refresh_ingest to populate posts, then ask NAMI Works to ` +
            `generate the voice card. Until then, fall back to instagram_top_posts ` +
            `and instagram_search_captions to assemble voice context manually.`,
        },
      ],
    };
  }

  const exemplars =
    source === "instagram" ? await pickExemplars(ctx.tenant.id, exemplarCount) : [];

  const guide = renderGuide({
    card: voiceCard.card as VoiceCardData,
    tenantDisplay: ctx.tenant.displayName,
    generatedAt: voiceCard.generatedAt,
    modelId: voiceCard.modelId,
    corpusSize: voiceCard.corpusSize,
    exemplars,
  });

  if (args.includeRawCard) {
    return {
      content: [
        {
          type: "text",
          text:
            `${guide}\n\n---\n\n## Raw VoiceCard JSON\n\n` +
            "```json\n" +
            JSON.stringify(voiceCard.card, null, 2) +
            "\n```",
        },
      ],
    };
  }

  return { content: [{ type: "text", text: guide }] };
}

registerToolDefinition({
  name: "brand_tone_current",
  description:
    "Returns the tenant's complete BRAND VOICE GUIDE in one call: the latest VoiceCard distilled into a prompt-ready format, plus stratified high-engagement exemplar captions (across video/carousel/image), plus do/don't examples. Use BEFORE drafting any brand-facing copy (captions, pop-ups, emails, SMS, product blurbs, ad copy). Single call replaces voice_card_current + top_posts + caption_search chains.",
  inputSchema: {
    exemplarCount: z
      .number()
      .int()
      .min(3)
      .max(15)
      .optional()
      .describe(
        "How many real-caption exemplars to include alongside the voice card (default 8, max 15).",
      ),
    includeRawCard: z
      .boolean()
      .optional()
      .describe(
        "If true, appends the raw VoiceCard JSON after the formatted guide. Useful for downstream tools that need structured fields.",
      ),
    source: z
      .string()
      .optional()
      .describe(
        "Voice source to load (default 'instagram'). Future: 'email', 'pdp', etc.",
      ),
  },
  handler: brandToneCurrentHandler,
});
