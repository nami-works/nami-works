import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { Prisma } from "@prisma/client-connector";
import { prisma } from "../../db/prisma.js";
import { getSecret } from "../../secrets/ssm.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const MEDIA_TYPES = ["IMAGE", "VIDEO", "CAROUSEL_ALBUM"] as const;
const MODEL_ID = "claude-opus-4-7";
const NUM_VARIANTS = 3;
const FEW_SHOT_COUNT = 8;

type SampledPost = {
  postedAt: Date;
  mediaType: string;
  caption: string | null;
  likeCount: number | null;
  commentsCount: number | null;
};

function renderFewShots(posts: SampledPost[]): string {
  return posts
    .filter((p): p is SampledPost & { caption: string } => p.caption !== null)
    .map((p, i) => {
      const date = p.postedAt.toISOString().slice(0, 10);
      const eng = `likes=${p.likeCount ?? "?"} comments=${p.commentsCount ?? "?"}`;
      return `Example ${i + 1} [${date}] [${p.mediaType}] [${eng}]\n${p.caption}`;
    })
    .join("\n\n---\n\n");
}

export async function draftCaptionHandler(
  args: {
    brief: string;
    mediaType?: (typeof MEDIA_TYPES)[number] | undefined;
    topic?: string | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const voiceCard = await prisma.voiceCard.findFirst({
    where: { tenantId: ctx.tenant.id, source: "instagram" },
    orderBy: { generatedAt: "desc" },
  });

  if (!voiceCard) {
    return {
      content: [
        {
          type: "text",
          text: `No Instagram voice card exists for tenant ${ctx.tenant.slug}. Generate one before drafting captions.`,
        },
      ],
      isError: true,
    };
  }

  const fewShotWhere: Prisma.InstagramPostWhereInput = {
    tenantId: ctx.tenant.id,
    caption: { not: null },
  };
  if (args.mediaType) fewShotWhere.mediaType = args.mediaType;
  if (args.topic) {
    fewShotWhere.caption = {
      contains: args.topic,
      mode: Prisma.QueryMode.insensitive,
    };
  }

  let fewShots = await prisma.instagramPost.findMany({
    where: fewShotWhere,
    orderBy: { likeCount: "desc" },
    take: FEW_SHOT_COUNT,
    select: {
      postedAt: true,
      mediaType: true,
      caption: true,
      likeCount: true,
      commentsCount: true,
    },
  });

  // If filters were too tight, widen to all-time top by engagement.
  if (fewShots.length < 3) {
    fewShots = await prisma.instagramPost.findMany({
      where: { tenantId: ctx.tenant.id, caption: { not: null } },
      orderBy: { likeCount: "desc" },
      take: FEW_SHOT_COUNT,
      select: {
        postedAt: true,
        mediaType: true,
        caption: true,
        likeCount: true,
        commentsCount: true,
      },
    });
  }

  const apiKey = await getSecret(`${ctx.tenant.ssmPrefix}/anthropic/api_key`);
  if (apiKey === "REPLACE_ME" || apiKey.length < 10) {
    return {
      content: [
        {
          type: "text",
          text: `Anthropic API key for ${ctx.tenant.slug} is a placeholder. NAMI Works needs to put a real key at \`${ctx.tenant.ssmPrefix}/anthropic/api_key\` before drafting.`,
        },
      ],
      isError: true,
    };
  }
  const anthropic = new Anthropic({ apiKey });

  const cardJson = JSON.stringify(voiceCard.card, null, 2);
  const fewShotBlock = renderFewShots(fewShots);

  const userMessage =
    `Draft ${NUM_VARIANTS} Instagram caption variants for the brief below, in the brand's voice.\n\n` +
    `BRIEF:\n${args.brief}\n\n` +
    (args.mediaType ? `MEDIA TYPE: ${args.mediaType}\n` : "") +
    (args.topic ? `TOPIC HINT: ${args.topic}\n` : "") +
    `\nVOICE CARD (treat as binding spec):\n${cardJson}\n\n` +
    `EXAMPLES FROM THE BRAND (highest-engagement matches):\n${fewShotBlock}\n\n` +
    `Now output exactly ${NUM_VARIANTS} caption variants. Format:\n\n` +
    `VARIANT 1:\n<full caption>\n\nVARIANT 2:\n<full caption>\n\nVARIANT 3:\n<full caption>\n\n` +
    `Each variant must:\n` +
    `- Use the brand's signature CTAs and emoji palette where appropriate.\n` +
    `- Respect every entry in banned_constructions.\n` +
    `- Match the brand's typical length and emoji density for this media type.\n` +
    `- Differ from each other in hook angle so the user has real options to pick from.`;

  const response = await anthropic.messages.create({
    model: MODEL_ID,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    system:
      "You are a brand copywriter. You write Instagram captions that sound indistinguishable from the brand's own team. " +
      "You ground every decision in the supplied voice card and few-shot examples. " +
      "You do not invent product specs, prices, dates, or campaign names. If the brief lacks a detail, leave it as a clear placeholder in [BRACKETS] for the user to fill.",
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  const draftText = textBlock?.text ?? "(no text returned)";

  const footer = `\n\n— drafted by ${MODEL_ID} · voice card from ${voiceCard.generatedAt.toISOString().slice(0, 10)} · ${fewShots.length} few-shot examples · tokens in=${response.usage.input_tokens} out=${response.usage.output_tokens}`;
  return { content: [{ type: "text", text: `${draftText}${footer}` }] };
}

registerToolDefinition({
  name: "instagram_draft_caption",
  description:
    "Generates 3 Instagram caption variants in the tenant's brand voice. Uses the latest VoiceCard as a binding spec plus top-engagement few-shot examples from past posts. Does NOT post to Instagram — output is for human review. Calls Claude (costs tokens).",
  inputSchema: {
    brief: z
      .string()
      .min(10)
      .describe(
        "What the post is about — product, campaign, hook, or message. The model fills in voice; you supply the substance.",
      ),
    mediaType: z
      .enum(MEDIA_TYPES)
      .optional()
      .describe(
        "Planned media type. Biases few-shot selection — reel captions read different from carousel captions.",
      ),
    topic: z
      .string()
      .optional()
      .describe(
        "Topic keyword to bias few-shot retrieval (e.g. 'Melon Mood', 'Primer Cachos'). Falls back to all-time top posts if too narrow.",
      ),
  },
  handler: draftCaptionHandler,
});
