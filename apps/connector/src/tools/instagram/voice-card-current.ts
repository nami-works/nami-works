import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

type VoiceCardData = {
  language?: string;
  register?: string;
  formality?: string;
  signature_phrases?: string[];
  banned_constructions?: string[];
  hooks?: { pattern: string; example: string }[];
  ctas?: { template: string; usage: string }[];
  emoji_palette?: { emoji: string; usage: string }[];
  emoji_density?: string;
  hashtag_policy?: string;
  people_pattern?: string;
  segmentation_pattern?: string;
  tech_spec_pattern?: string;
  engagement_pattern?: string;
  topical_buckets?: { bucket: string; share_estimate: string; notes: string }[];
  do_examples?: string[];
  dont_examples?: string[];
  notes?: string;
};

function renderCompact(card: VoiceCardData): string {
  const lines: string[] = [];
  if (card.language) lines.push(`Language: ${card.language}`);
  if (card.register) lines.push(`Register: ${card.register}`);
  if (card.formality) lines.push(`Formality: ${card.formality}`);
  lines.push("");

  if (card.banned_constructions?.length) {
    lines.push("Banned constructions:");
    for (const b of card.banned_constructions) lines.push(`  - ${b}`);
    lines.push("");
  }

  if (card.signature_phrases?.length) {
    lines.push("Signature phrases (use verbatim or near-verbatim):");
    for (const p of card.signature_phrases.slice(0, 10)) lines.push(`  - ${p}`);
    if (card.signature_phrases.length > 10) {
      lines.push(`  ... and ${card.signature_phrases.length - 10} more`);
    }
    lines.push("");
  }

  if (card.ctas?.length) {
    lines.push("Default CTAs:");
    for (const c of card.ctas) lines.push(`  - "${c.template}" — ${c.usage}`);
    lines.push("");
  }

  if (card.hooks?.length) {
    lines.push("Opening hooks:");
    for (const h of card.hooks) lines.push(`  - ${h.pattern} → "${h.example}"`);
    lines.push("");
  }

  if (card.emoji_density) lines.push(`Emoji density: ${card.emoji_density}`);
  if (card.hashtag_policy) lines.push(`Hashtag policy: ${card.hashtag_policy}`);
  if (card.engagement_pattern) lines.push(`Engagement: ${card.engagement_pattern}`);
  if (card.notes) {
    lines.push("");
    lines.push(`Notes: ${card.notes}`);
  }

  return lines.join("\n");
}

export async function voiceCardCurrentHandler(
  args: { format?: "compact" | "full" | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const latest = await prisma.voiceCard.findFirst({
    where: { tenantId: ctx.tenant.id, source: "instagram" },
    orderBy: { generatedAt: "desc" },
  });

  if (!latest) {
    return {
      content: [
        {
          type: "text",
          text: `No Instagram voice card exists for tenant ${ctx.tenant.slug}. Run instagram_refresh_ingest first to populate posts, then ask the team to generate the voice card.`,
        },
      ],
    };
  }

  const format = args.format ?? "compact";
  const header = `Instagram voice card · tenant=${ctx.tenant.slug} · generated=${latest.generatedAt.toISOString()} · corpus=${latest.corpusSize} posts · model=${latest.modelId}`;

  if (format === "full") {
    return {
      content: [
        { type: "text", text: `${header}\n\n${JSON.stringify(latest.card, null, 2)}` },
      ],
    };
  }

  const compact = renderCompact(latest.card as VoiceCardData);
  return { content: [{ type: "text", text: `${header}\n\n${compact}` }] };
}

registerToolDefinition({
  name: "instagram_voice_card_current",
  description:
    "Returns the tenant's most recent Instagram voice-of-brand card — the patterns a drafting tool should follow to sound like the brand (lexicon, hooks, CTAs, emoji palette, register, banned constructions). Use 'compact' for a readable summary or 'full' for the raw JSON.",
  inputSchema: {
    format: z
      .enum(["compact", "full"])
      .optional()
      .describe(
        "'compact' (default) returns a readable summary. 'full' returns the raw structured JSON.",
      ),
  },
  handler: voiceCardCurrentHandler,
});
