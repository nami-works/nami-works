import { z } from "zod";
import { Prisma } from "@prisma/client-connector";
import { prisma } from "../../db/prisma.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";
import { listAcceptedTraitsForContext } from "../../services/tone-sources/inference.js";

/**
 * brand_tone_current — single-call BRAND VOICE GUIDE for the tenant.
 *
 * Assembles, at request time, a prompt-binding guide block from three
 * inputs that together form "what does this brand sound like":
 *   1. Accepted BrandToneHypothesis rows (grouped by category — voice,
 *      vocabulary, do, dont, register, structure). These are the
 *      merchant-curated truths produced by the tone-sources review loop.
 *   2. Manual TenantBrand fields (brandName, about, toneOfVoice override,
 *      editorialGuidelines, benchmarks). Optional, but when set they take
 *      precedence over inferred traits for stylistic decisions.
 *   3. Stratified high-engagement InstagramPost exemplars across
 *      VIDEO / CAROUSEL_ALBUM / IMAGE — real captions the brand has
 *      published, used as concrete examples to mimic.
 *
 * Output is intentionally formatted as a prompt-like guidance block so the
 * reading model (Claude.ai's Claude) treats the response as BINDING spec
 * rather than data to summarize.
 *
 * No derived "voice card" artifact — the hypothesis-driven pipeline is the
 * source of truth; this tool assembles its guide on the fly.
 */

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
  const all = [...videos, ...carousels, ...images].filter(
    (p): p is ExemplarPost => p.caption !== null,
  );
  return all
    .sort(
      (a, b) =>
        (b.likeCount ?? 0) + (b.commentsCount ?? 0) -
        ((a.likeCount ?? 0) + (a.commentsCount ?? 0)),
    )
    .slice(0, count);
}

const CATEGORY_HEADINGS: Record<string, string> = {
  voice: "Voice — overall personality, formality, POV",
  vocabulary: "Vocabulary — words & phrases this brand uses",
  register: "Register — emotional tone (warm, clinical, playful, formal)",
  structure: "Structure — recurring shape of the writing",
  do: "DO — explicit positive guidelines",
  dont: "DON'T — explicit negative guidelines",
};

const CATEGORY_ORDER = ["voice", "vocabulary", "register", "structure", "do", "dont"];

function renderTraitsByCategory(
  traits: Array<{ category: string; statement: string }>,
): string {
  if (traits.length === 0) {
    return "_(no merchant-accepted traits yet — run a tone refresh and review the resulting hypotheses)_";
  }
  const byCategory = new Map<string, string[]>();
  for (const t of traits) {
    const cat = t.category.toLowerCase();
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(t.statement);
  }
  const out: string[] = [];
  for (const cat of CATEGORY_ORDER) {
    const items = byCategory.get(cat);
    if (!items || items.length === 0) continue;
    out.push(`### ${CATEGORY_HEADINGS[cat] ?? cat}`);
    for (const s of items) out.push(`  • ${s}`);
    out.push("");
  }
  return out.join("\n").trim();
}

function renderGuide(args: {
  tenantDisplay: string;
  contentLanguage: string | null;
  brandName: string | null;
  about: string | null;
  manualToneOverride: string | null;
  editorialGuidelines: string | null;
  benchmarks: string | null;
  traits: Array<{ category: string; statement: string }>;
  exemplars: ExemplarPost[];
}): string {
  const out: string[] = [];
  const display = args.brandName ?? args.tenantDisplay;

  out.push(`# BRAND VOICE GUIDE — ${display}`);
  out.push("");
  out.push(
    "Apply this guide as a BINDING spec when drafting any brand-facing copy",
  );
  out.push(
    "(captions, pop-ups, emails, SMS, product blurbs, ad copy). Respect every",
  );
  out.push("DON'T. Match the DO patterns. Mimic the exemplar shape.");
  out.push("");
  out.push("---");
  out.push("");

  if (args.contentLanguage || args.about) {
    out.push("## About this brand");
    if (args.contentLanguage) out.push(`- Language: ${args.contentLanguage}`);
    if (args.about) {
      out.push("");
      out.push(args.about.trim());
    }
    out.push("");
  }

  if (args.manualToneOverride) {
    out.push("## Manual tone override (takes precedence)");
    out.push(args.manualToneOverride.trim());
    out.push("");
  }

  out.push("## Merchant-accepted tone traits");
  out.push(renderTraitsByCategory(args.traits));
  out.push("");

  if (args.editorialGuidelines) {
    out.push("## Editorial guidelines");
    out.push(args.editorialGuidelines.trim());
    out.push("");
  }

  if (args.benchmarks) {
    out.push("## Benchmark references");
    out.push(args.benchmarks.trim());
    out.push("");
  }

  if (args.exemplars.length > 0) {
    out.push("---");
    out.push("");
    out.push(
      `## Real high-engagement examples (${args.exemplars.length}, stratified across video/carousel/image)`,
    );
    out.push(
      "Actual captions the brand published. Mimic the pattern, not the substance.",
    );
    out.push("");
    for (const p of args.exemplars) {
      const date = p.postedAt.toISOString().slice(0, 10);
      const eng = `❤️${p.likeCount ?? "?"} 💬${p.commentsCount ?? "?"}`;
      out.push(`### [${date}] [${p.mediaType}] ${eng}`);
      out.push("");
      out.push(p.caption.trim());
      out.push("");
    }
  }

  return out.join("\n");
}

export async function brandToneCurrentHandler(
  args: {
    exemplarCount?: number | undefined;
    includeRawTraits?: boolean | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const exemplarCount = Math.min(Math.max(args.exemplarCount ?? 8, 0), 15);

  const [tenant, traits, exemplars] = await Promise.all([
    prisma.integrationTenant.findUnique({
      where: { id: ctx.tenant.id },
      include: { brandSettings: true },
    }),
    listAcceptedTraitsForContext(ctx.tenant.id, 100),
    exemplarCount > 0 ? pickExemplars(ctx.tenant.id, exemplarCount) : Promise.resolve([]),
  ]);

  const guide = renderGuide({
    tenantDisplay: ctx.tenant.displayName,
    contentLanguage: tenant?.contentLanguage ?? null,
    brandName: tenant?.brandSettings?.brandName ?? null,
    about: tenant?.brandSettings?.about ?? null,
    manualToneOverride: tenant?.brandSettings?.toneOfVoice ?? null,
    editorialGuidelines: tenant?.brandSettings?.editorialGuidelines ?? null,
    benchmarks: tenant?.brandSettings?.benchmarks ?? null,
    traits,
    exemplars,
  });

  if (args.includeRawTraits) {
    return {
      content: [
        {
          type: "text",
          text:
            `${guide}\n\n---\n\n## Raw accepted-trait list\n\n` +
            "```json\n" +
            JSON.stringify(traits, null, 2) +
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
    "Returns the tenant's complete BRAND VOICE GUIDE in one call: merchant-accepted tone traits grouped by category (voice/vocabulary/do/dont/register/structure), the brand's manual settings (brandName, about, editorial guidelines, benchmarks), plus stratified high-engagement Instagram exemplars. Use BEFORE drafting any brand-facing copy (captions, pop-ups, emails, SMS, product blurbs, ad copy).",
  inputSchema: {
    exemplarCount: z
      .number()
      .int()
      .min(0)
      .max(15)
      .optional()
      .describe(
        "How many real-caption exemplars to include alongside the trait list (default 8, max 15, 0 to skip).",
      ),
    includeRawTraits: z
      .boolean()
      .optional()
      .describe(
        "If true, appends the raw accepted-trait JSON after the formatted guide. Useful for downstream tools that need structured access.",
      ),
  },
  handler: brandToneCurrentHandler,
});
