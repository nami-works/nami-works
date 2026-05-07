import Anthropic from "@anthropic-ai/sdk";
import type { ContentGenBrandContext } from "../content-gen/client.server";

const TEXT_MODEL = "claude-sonnet-4-5";
const VISION_MODEL = "claude-sonnet-4-5";

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!cachedClient) cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function brandContextBlock(brandContext: ContentGenBrandContext): string {
  const lines: string[] = ["You are writing on behalf of this brand:"];
  if (brandContext.brandName) lines.push(`Brand name: ${brandContext.brandName}`);
  if (brandContext.brandCategory) lines.push(`Category: ${brandContext.brandCategory}`);
  if (brandContext.about) lines.push(`About: ${brandContext.about}`);
  if (brandContext.toneOfVoice) lines.push(`Tone of voice: ${brandContext.toneOfVoice}`);
  if (brandContext.editorialGuidelines)
    lines.push(`Editorial guidelines: ${brandContext.editorialGuidelines}`);
  if (brandContext.benchmarks) lines.push(`Benchmarks: ${brandContext.benchmarks}`);

  if (brandContext.toneTraits && brandContext.toneTraits.length > 0) {
    lines.push("");
    lines.push(
      `Validated tone traits from ${brandContext.toneTraits.length} merchant-approved samples (follow these):`,
    );
    for (const t of brandContext.toneTraits) {
      lines.push(`- [${t.category}] ${t.statement}`);
    }
  }

  if (brandContext.learnings && brandContext.learnings.length > 0) {
    lines.push("");
    lines.push("Past corrections from the merchant (follow these):");
    for (const l of brandContext.learnings) {
      lines.push(`- [${l.category}] ${l.interpretation}`);
    }
  }

  return lines.join("\n");
}

export type AltTextSuggestion = {
  suggestion: string;
  detectedLanguage: string;
};

/**
 * Generate an SEO-friendly alt-text suggestion for a product image.
 * Uses Claude vision with a cached brand-context system prompt so many
 * images for the same shop share the prompt cache and save tokens.
 */
export async function generateAltTextSuggestion(input: {
  shop: string;
  imageUrl: string;
  productTitle: string | null;
  productDescription: string | null;
  brandContext: ContentGenBrandContext;
}): Promise<AltTextSuggestion | { error: string }> {
  const client = getClient();
  if (!client) {
    return { error: "ANTHROPIC_API_KEY not configured." };
  }

  const language = input.brandContext.contentLanguage ?? "en_US";
  const systemPrompt = [
    {
      type: "text" as const,
      text: brandContextBlock(input.brandContext),
      cache_control: { type: "ephemeral" as const },
    },
    {
      type: "text" as const,
      text: [
        "Task: write one alt-text string for the attached product image.",
        "Rules:",
        "- Describe what is visually in the image, not marketing claims.",
        "- 8-16 words.",
        "- Include the product type or distinctive feature.",
        "- No trailing period, no quotes, no markdown.",
        `- Respond in ${language}.`,
        "Respond with ONLY the alt text, nothing else.",
      ].join("\n"),
    },
  ];

  try {
    console.info(
      `[claude:alt-text] generate START shop=${input.shop} imageUrl=${input.imageUrl.slice(0, 80)}`,
    );
    const response = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: 200,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "url", url: input.imageUrl },
            },
            {
              type: "text",
              text: [
                input.productTitle ? `Product: ${input.productTitle}` : null,
                input.productDescription
                  ? `Description: ${input.productDescription.slice(0, 300)}`
                  : null,
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text") as
      | { type: "text"; text: string }
      | undefined;
    const suggestion = textBlock?.text?.trim() ?? "";
    if (!suggestion) {
      return { error: "Claude returned no suggestion." };
    }

    console.info(`[claude:alt-text] generate OK shop=${input.shop}`);
    return { suggestion, detectedLanguage: language };
  } catch (err) {
    console.error(`[claude:alt-text] generate FAILED shop=${input.shop}`, err);
    return {
      error: err instanceof Error ? err.message : "Claude call failed.",
    };
  }
}

export type DiffHypothesis = {
  category: "tone" | "structure" | "vocabulary" | "product_mentions" | "other";
  beforeSnippet: string;
  afterSnippet: string;
  interpretation: string;
};

/**
 * Interpret a draft-vs-published diff into validated hypotheses about the
 * merchant's editorial preferences. Response language follows brand context.
 */
export async function interpretDiff(input: {
  shop: string;
  beforeHtml: string;
  afterHtml: string;
  brandContext: ContentGenBrandContext;
}): Promise<{ hypotheses: DiffHypothesis[] } | { error: string }> {
  const client = getClient();
  if (!client) {
    return { error: "ANTHROPIC_API_KEY not configured." };
  }

  const language = input.brandContext.contentLanguage ?? "en_US";
  const systemPrompt = [
    {
      type: "text" as const,
      text: brandContextBlock(input.brandContext),
      cache_control: { type: "ephemeral" as const },
    },
    {
      type: "text" as const,
      text: [
        "You are analysing a merchant's edits to an AI-generated blog post.",
        "Compare the BEFORE (AI draft) against the AFTER (published version)",
        "and extract up to 5 non-trivial editorial preferences.",
        "",
        "For each hypothesis, output JSON with these fields:",
        "  category: one of tone | structure | vocabulary | product_mentions | other",
        "  beforeSnippet: a short quote from the draft (≤200 chars)",
        "  afterSnippet:  a short quote from the edit  (≤200 chars)",
        "  interpretation: one sentence explaining the inferred preference",
        `    (respond in ${language})`,
        "",
        "Skip trivial fixes like typos, punctuation, HTML tag changes.",
        'Respond with ONLY a JSON object: {"hypotheses": [ ... ]}',
        "No prose before or after the JSON.",
      ].join("\n"),
    },
  ];

  try {
    console.info(`[claude:diff] interpret START shop=${input.shop}`);
    const response = await client.messages.create({
      model: TEXT_MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "BEFORE (AI draft, HTML):",
                input.beforeHtml.slice(0, 8000),
                "",
                "AFTER (published, HTML):",
                input.afterHtml.slice(0, 8000),
              ].join("\n"),
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text") as
      | { type: "text"; text: string }
      | undefined;
    const raw = textBlock?.text?.trim() ?? "";
    if (!raw) return { error: "Claude returned no text." };

    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) {
      return { error: "Claude response missing JSON." };
    }
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as {
      hypotheses?: DiffHypothesis[];
    };
    const hypotheses = Array.isArray(parsed.hypotheses) ? parsed.hypotheses : [];
    console.info(
      `[claude:diff] interpret OK shop=${input.shop} hypotheses=${hypotheses.length}`,
    );
    return { hypotheses };
  } catch (err) {
    console.error(`[claude:diff] interpret FAILED shop=${input.shop}`, err);
    return {
      error: err instanceof Error ? err.message : "Claude call failed.",
    };
  }
}

export async function extractTextFromImage(input: {
  shop: string;
  imageUrl: string;
  maxDimension?: number;
}): Promise<{ text: string } | { error: string }> {
  const client = getClient();
  if (!client) return { error: "ANTHROPIC_API_KEY not configured." };

  try {
    console.info(
      `[claude:image-ocr] START shop=${input.shop} url=${input.imageUrl.slice(0, 80)}`,
    );
    const response = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: 1500,
      system:
        "Extract any readable text rendered inside the image (overlay text, captions, signs, labels). If the image has no text, respond with the single word NONE. Return ONLY the extracted text, no preamble.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "url", url: input.imageUrl },
            },
            { type: "text", text: "Extract any text rendered in this image." },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text") as
      | { type: "text"; text: string }
      | undefined;
    const text = textBlock?.text?.trim() ?? "";
    if (!text || text === "NONE") {
      return { text: "" };
    }
    console.info(
      `[claude:image-ocr] OK shop=${input.shop} chars=${text.length}`,
    );
    return { text };
  } catch (err) {
    console.error(`[claude:image-ocr] FAILED shop=${input.shop}`, err);
    return {
      error: err instanceof Error ? err.message : "Claude OCR failed.",
    };
  }
}

export async function extractTextFromPdfBuffer(input: {
  shop: string;
  pdfBase64: string;
  filename: string;
}): Promise<{ text: string } | { error: string }> {
  const client = getClient();
  if (!client) return { error: "ANTHROPIC_API_KEY not configured." };

  try {
    console.info(
      `[claude:pdf-extract] START shop=${input.shop} filename=${input.filename}`,
    );
    const response = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: 8000,
      system:
        "Extract the full readable text from the attached PDF. Preserve paragraph breaks. Skip page numbers, headers, footers. Return ONLY the extracted text — no preamble, no commentary.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: input.pdfBase64,
              },
            },
            { type: "text", text: "Extract the text content." },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text") as
      | { type: "text"; text: string }
      | undefined;
    const text = textBlock?.text?.trim() ?? "";
    if (!text) return { error: "Claude returned no text." };
    console.info(
      `[claude:pdf-extract] OK shop=${input.shop} chars=${text.length}`,
    );
    return { text };
  } catch (err) {
    console.error(`[claude:pdf-extract] FAILED shop=${input.shop}`, err);
    return {
      error: err instanceof Error ? err.message : "Claude PDF extract failed.",
    };
  }
}

export type ToneTraitHypothesis = {
  category: "voice" | "vocabulary" | "do" | "dont" | "register" | "structure";
  statement: string;
  evidence: Array<{ sourceType: string; sourceId: string; snippet: string }>;
  confidence: number;
};

export type ToneInferenceSample = {
  sourceType: string;
  sourceId: string;
  excerpt: string;
};

export async function inferToneTraits(input: {
  shop: string;
  contentLanguage: string;
  brandName: string | null;
  samples: ToneInferenceSample[];
}): Promise<{ hypotheses: ToneTraitHypothesis[] } | { error: string }> {
  const client = getClient();
  if (!client) {
    return { error: "ANTHROPIC_API_KEY not configured." };
  }

  if (input.samples.length === 0) {
    return { hypotheses: [] };
  }

  const language = input.contentLanguage || "en_US";
  const systemPrompt = [
    {
      type: "text" as const,
      text: [
        `You are analyzing brand voice samples from ${input.brandName ?? input.shop}.`,
        `The samples come from multiple sources: existing blog posts, social captions,`,
        `internal copy guidelines, and merchant-uploaded reference documents.`,
        ``,
        `Extract up to 15 distinct tone-of-voice traits that capture how this brand`,
        `communicates. Each trait must have at least one piece of evidence pulled`,
        `directly from the samples.`,
        ``,
        `Categories:`,
        `  voice       — overall personality, formality, point-of-view`,
        `  vocabulary  — preferred or recurring word choices, phrases, terms`,
        `  do          — explicit positive guidelines (do this)`,
        `  dont        — explicit negative guidelines (avoid this)`,
        `  register    — emotional register (warm, clinical, playful, formal)`,
        `  structure   — recurring structural patterns (hook first, then heading; bullet-heavy; etc.)`,
        ``,
        `For each trait, output JSON with these fields:`,
        `  category:   one of the categories above`,
        `  statement:  one sentence describing the trait (respond in ${language})`,
        `  evidence:   array of up to 3 items, each { sourceType, sourceId, snippet (≤200 chars) }`,
        `  confidence: 0.0 to 1.0 — how strongly the samples support this trait`,
        ``,
        `Skip trivial observations (length, language detection, generic facts).`,
        `Skip duplicates — merge similar traits into one stronger statement.`,
        `Respond with ONLY a JSON object: {"hypotheses": [...]}.`,
        `No prose before or after the JSON.`,
      ].join("\n"),
    },
  ];

  const samplesBlob = input.samples
    .map(
      (s, i) =>
        `[Sample ${i + 1}] sourceType=${s.sourceType} sourceId=${s.sourceId}\n${s.excerpt}`,
    )
    .join("\n\n---\n\n");

  try {
    console.info(
      `[claude:tone-infer] START shop=${input.shop} samples=${input.samples.length}`,
    );
    const response = await client.messages.create({
      model: TEXT_MODEL,
      max_tokens: 4000,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: samplesBlob.slice(0, 80_000) }],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text") as
      | { type: "text"; text: string }
      | undefined;
    const raw = textBlock?.text?.trim() ?? "";
    if (!raw) return { error: "Claude returned no text." };

    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) {
      return { error: "Claude response missing JSON." };
    }
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as {
      hypotheses?: ToneTraitHypothesis[];
    };
    const hypotheses = Array.isArray(parsed.hypotheses) ? parsed.hypotheses : [];
    console.info(
      `[claude:tone-infer] OK shop=${input.shop} hypotheses=${hypotheses.length}`,
    );
    return { hypotheses };
  } catch (err) {
    console.error(`[claude:tone-infer] FAILED shop=${input.shop}`, err);
    return {
      error: err instanceof Error ? err.message : "Claude call failed.",
    };
  }
}
