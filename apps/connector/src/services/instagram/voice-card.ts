import type Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient } from "@prisma/client-connector";
import type { Logger } from "pino";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { rootLogger } from "../../lib/logger.js";

/**
 * Voice-of-brand extraction.
 *
 * Reads `InstagramPost` rows for a tenant, samples them (top-engagement +
 * recent + random), and asks Claude to derive a structured "voice card" —
 * the set of patterns a copy-drafting tool needs to sound like the brand
 * (lexicon, hooks, CTAs, emoji palette, register, banned constructions).
 *
 * Single one-shot call against Opus 4.7 with adaptive thinking and
 * structured output via `messages.parse()`. The Zod schema is the contract
 * — when it's tightened, regenerate cards rather than migrating old JSON.
 *
 * Read-only on Instagram side; writes one `VoiceCard` row per run so we can
 * audit drift over time and roll back if a new card regresses.
 */

const VoiceCardSchema = z.object({
  language: z.string().describe("Primary language code (e.g. 'pt-BR', 'en-US')"),
  register: z.string().describe("Tone register: e.g. 'warm-expert', 'playful-formal'"),
  formality: z.enum(["informal", "neutral", "formal"]),
  signature_phrases: z
    .array(z.string())
    .describe("Recurring multi-word phrases the brand uses verbatim"),
  banned_constructions: z
    .array(z.string())
    .describe("Punctuation, words, or patterns the brand never uses"),
  hooks: z
    .array(
      z.object({
        pattern: z.string().describe("Abstract template, e.g. 'Verb-led plural-first-person opener'"),
        example: z.string().describe("Concrete example pulled or paraphrased from the corpus"),
      }),
    )
    .describe("Common opening-line patterns"),
  ctas: z
    .array(
      z.object({
        template: z.string(),
        usage: z.string().describe("When this CTA shape is used"),
      }),
    )
    .describe("Call-to-action templates, near-verbatim if reused across posts"),
  emoji_palette: z
    .array(
      z.object({
        emoji: z.string(),
        usage: z.string().describe("What this emoji signals when the brand uses it"),
      }),
    )
    .describe("Emojis that recur with intent, not the long tail"),
  emoji_density: z.string().describe("Typical emoji count per post and placement habits"),
  hashtag_policy: z.string().describe("Whether/how the brand uses hashtags"),
  people_pattern: z
    .string()
    .describe("How the brand surfaces people (founder, team, partners, customers)"),
  segmentation_pattern: z
    .string()
    .describe("How the brand addresses sub-audiences (e.g. hair types, skin types)"),
  tech_spec_pattern: z
    .string()
    .describe("How the brand presents technical specs and benefits"),
  engagement_pattern: z
    .string()
    .describe("How posts invite engagement (questions, polls, CTAs to comments)"),
  topical_buckets: z
    .array(
      z.object({
        bucket: z.string(),
        share_estimate: z.string().describe("Rough share of corpus, e.g. '~40%'"),
        notes: z.string(),
      }),
    )
    .describe("Content buckets observed in the corpus"),
  do_examples: z
    .array(z.string())
    .describe("Short example sentences a drafting tool could safely emulate"),
  dont_examples: z
    .array(z.string())
    .describe("Short sentences that would feel off-brand and should be avoided"),
  notes: z.string().describe("Anything important the schema didn't capture"),
});

export type VoiceCardData = z.infer<typeof VoiceCardSchema>;

type SampledPost = {
  igMediaId: string;
  postedAt: Date;
  mediaType: string;
  caption: string;
  likeCount: number | null;
  commentsCount: number | null;
};

export type ExtractArgs = {
  tenantId: string;
  prisma: PrismaClient;
  anthropic: Anthropic;
  modelId?: string;
  /** How many top-engagement posts to include in the corpus (default 30). */
  topN?: number;
  /** How many most-recent posts to include (default 50). */
  recentN?: number;
  /** How many random posts to include from the rest (default 30). */
  randomN?: number;
  logger?: Logger;
};

export type ExtractResult = {
  voiceCardId: string;
  card: VoiceCardData;
  corpusSize: number;
  inputTokens: number;
  outputTokens: number;
};

export async function extractInstagramVoiceCard(args: ExtractArgs): Promise<ExtractResult> {
  const { tenantId, prisma, anthropic } = args;
  const modelId = args.modelId ?? "claude-opus-4-7";
  const topN = args.topN ?? 30;
  const recentN = args.recentN ?? 50;
  const randomN = args.randomN ?? 30;

  const tenant = await prisma.integrationTenant.findUniqueOrThrow({
    where: { id: tenantId },
  });
  const log = (args.logger ?? rootLogger).child({
    tenant: tenant.slug,
    component: "voice-card-extract",
  });

  const allPosts = await prisma.instagramPost.findMany({
    where: { tenantId, caption: { not: null } },
    select: {
      igMediaId: true,
      postedAt: true,
      mediaType: true,
      caption: true,
      likeCount: true,
      commentsCount: true,
    },
  });

  if (allPosts.length === 0) {
    throw new Error(
      `No InstagramPost rows with captions for tenant ${tenant.slug}. Run instagram-dump first.`,
    );
  }

  const corpus = sampleCorpus(
    allPosts.filter((p): p is SampledPost & { caption: string } => p.caption !== null),
    { topN, recentN, randomN },
  );

  log.info(
    { totalPosts: allPosts.length, corpusSize: corpus.length, topN, recentN, randomN },
    "extracting voice card",
  );

  const corpusBlock = renderCorpus(corpus);

  const response = await anthropic.messages.parse({
    model: modelId,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { format: zodOutputFormat(VoiceCardSchema) },
    system:
      "You extract structured voice-of-brand cards from Instagram caption corpora. " +
      "You read the captions carefully, count what recurs, and ground every claim in the corpus. " +
      "When in doubt, prefer empirical observations from the data over plausible-sounding generalities. " +
      "Be specific and concrete — a copy-drafting tool will use this card to imitate the brand, " +
      "so abstract guidance like 'use a friendly tone' is useless. Quote real phrases.",
    messages: [
      {
        role: "user",
        content:
          `Extract a voice-of-brand card from the following Instagram caption corpus for "${tenant.displayName}".\n\n` +
          `The corpus is sampled in three slices to balance recency and signal:\n` +
          `- TOP ENGAGEMENT (${topN}): posts with the highest like/comment counts — captures what the audience responds to.\n` +
          `- RECENT (${recentN}): posts from the last weeks — captures current voice and active campaigns.\n` +
          `- RANDOM (${randomN}): random sample from the remainder — captures baseline voice.\n\n` +
          `Each post is annotated with its slice, posting date, media type, and engagement counts.\n\n` +
          `--- CORPUS START ---\n${corpusBlock}\n--- CORPUS END ---\n\n` +
          `Now produce the voice card. Be specific, ground every field in the corpus, and use the brand's actual words for examples.`,
      },
    ],
  });

  if (!response.parsed_output) {
    throw new Error(
      `Voice card extraction returned no parsed_output (stop_reason=${response.stop_reason}). ` +
        `Check the raw response for refusals or schema validation failures.`,
    );
  }

  const card = response.parsed_output;

  const saved = await prisma.voiceCard.create({
    data: {
      tenantId,
      source: "instagram",
      modelId,
      corpusSize: corpus.length,
      card: card as unknown as object,
    },
    select: { id: true },
  });

  log.info(
    {
      voiceCardId: saved.id,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    "voice card extracted",
  );

  return {
    voiceCardId: saved.id,
    card,
    corpusSize: corpus.length,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

type Slice = "TOP" | "RECENT" | "RANDOM";
type SampledWithSlice = SampledPost & { caption: string; slice: Slice };

function sampleCorpus(
  posts: (SampledPost & { caption: string })[],
  args: { topN: number; recentN: number; randomN: number },
): SampledWithSlice[] {
  const seen = new Set<string>();
  const out: SampledWithSlice[] = [];

  const byEngagement = [...posts].sort(
    (a, b) =>
      (b.likeCount ?? 0) + (b.commentsCount ?? 0) - ((a.likeCount ?? 0) + (a.commentsCount ?? 0)),
  );
  for (const p of byEngagement.slice(0, args.topN)) {
    if (seen.has(p.igMediaId)) continue;
    seen.add(p.igMediaId);
    out.push({ ...p, slice: "TOP" });
  }

  const byRecency = [...posts].sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());
  for (const p of byRecency) {
    if (out.length >= args.topN + args.recentN) break;
    if (seen.has(p.igMediaId)) continue;
    seen.add(p.igMediaId);
    out.push({ ...p, slice: "RECENT" });
  }

  const remaining = posts.filter((p) => !seen.has(p.igMediaId));
  shuffleInPlace(remaining);
  for (const p of remaining.slice(0, args.randomN)) {
    seen.add(p.igMediaId);
    out.push({ ...p, slice: "RANDOM" });
  }

  return out;
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

function renderCorpus(corpus: SampledWithSlice[]): string {
  return corpus
    .map((p) => {
      const date = p.postedAt.toISOString().slice(0, 10);
      const eng = `likes=${p.likeCount ?? "?"} comments=${p.commentsCount ?? "?"}`;
      return `[${p.slice}] [${date}] [${p.mediaType}] [${eng}]\n${p.caption}\n---`;
    })
    .join("\n");
}
