import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { Prisma } from "@prisma/client-connector";
import { prisma } from "../../db/prisma.js";
import { getSecret } from "../../secrets/ssm.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";
import { listAcceptedTraitsForContext } from "../../services/tone-sources/inference.js";

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

function renderTraitsBlock(
  traits: Array<{ category: string; statement: string }>,
): string {
  if (traits.length === 0) return "(no merchant-accepted traits yet)";
  const byCat = new Map<string, string[]>();
  for (const t of traits) {
    const cat = t.category.toLowerCase();
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat)!.push(t.statement);
  }
  const order = ["voice", "vocabulary", "register", "structure", "do", "dont"];
  const out: string[] = [];
  for (const cat of order) {
    const items = byCat.get(cat);
    if (!items || items.length === 0) continue;
    out.push(`[${cat.toUpperCase()}]`);
    for (const s of items) out.push(`  - ${s}`);
  }
  return out.join("\n");
}

export async function draftCaptionHandler(
  args: {
    brief: string;
    mediaType?: (typeof MEDIA_TYPES)[number] | undefined;
    topic?: string | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const [tenant, traits] = await Promise.all([
    prisma.integrationTenant.findUnique({
      where: { id: ctx.tenant.id },
      include: { brandSettings: true },
    }),
    listAcceptedTraitsForContext(ctx.tenant.id, 100),
  ]);

  if (traits.length === 0 && !tenant?.brandSettings?.toneOfVoice) {
    return {
      content: [
        {
          type: "text",
          text: `No accepted tone traits or manual brand voice override on file for tenant ${ctx.tenant.slug}. Run a tone refresh + review hypotheses (or set TenantBrand.toneOfVoice) before drafting captions.`,
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

  const traitsBlock = renderTraitsBlock(traits);
  const fewShotBlock = renderFewShots(fewShots);
  const manualOverride = tenant?.brandSettings?.toneOfVoice?.trim();
  const editorial = tenant?.brandSettings?.editorialGuidelines?.trim();
  const language = tenant?.contentLanguage ?? null;

  const voiceSpec = [
    language ? `Language: ${language}` : null,
    manualOverride ? `\nMANUAL VOICE OVERRIDE (binding, takes precedence):\n${manualOverride}` : null,
    `\nMERCHANT-ACCEPTED TRAITS (treat as binding):\n${traitsBlock}`,
    editorial ? `\nEDITORIAL GUIDELINES:\n${editorial}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const userMessage =
    `Draft ${NUM_VARIANTS} Instagram caption variants for the brief below, in the brand's voice.\n\n` +
    `BRIEF:\n${args.brief}\n\n` +
    (args.mediaType ? `MEDIA TYPE: ${args.mediaType}\n` : "") +
    (args.topic ? `TOPIC HINT: ${args.topic}\n` : "") +
    `\nBRAND VOICE SPEC:\n${voiceSpec}\n\n` +
    `EXAMPLES FROM THE BRAND (highest-engagement matches):\n${fewShotBlock}\n\n` +
    `Now output exactly ${NUM_VARIANTS} caption variants. Format:\n\n` +
    `VARIANT 1:\n<full caption>\n\nVARIANT 2:\n<full caption>\n\nVARIANT 3:\n<full caption>\n\n` +
    `Each variant must:\n` +
    `- Follow every DO trait, respect every DON'T trait, use the vocabulary patterns above.\n` +
    `- Match the brand's typical length and structure for this media type, as evidenced by the examples.\n` +
    `- Differ from each other in hook angle so the user has real options to pick from.`;

  const response = await anthropic.messages.create({
    model: MODEL_ID,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    system:
      "You are a brand copywriter. You write Instagram captions that sound indistinguishable from the brand's own team. " +
      "You ground every decision in the supplied voice spec and few-shot examples. " +
      "You do not invent product specs, prices, dates, or campaign names. If the brief lacks a detail, leave it as a clear placeholder in [BRACKETS] for the user to fill.",
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  const draftText = textBlock?.text ?? "(no text returned)";

  const footer = `\n\n— drafted by ${MODEL_ID} · ${traits.length} accepted traits · ${fewShots.length} few-shot examples · tokens in=${response.usage.input_tokens} out=${response.usage.output_tokens}`;
  return { content: [{ type: "text", text: `${draftText}${footer}` }] };
}

registerToolDefinition({
  name: "instagram_draft_caption",
  description:
    "Generates 3 Instagram caption variants in the tenant's brand voice. Reads the merchant-accepted tone traits + any manual voice override on TenantBrand, plus top-engagement few-shot examples from past posts. Does NOT post to Instagram — output is for human review. Calls Claude (costs tokens).",
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
