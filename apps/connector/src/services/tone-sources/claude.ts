import Anthropic from "@anthropic-ai/sdk";
import { rootLogger } from "../../lib/logger.js";

// Claude calls for the tone-of-voice pipeline. Two responsibilities:
// (1) inferToneTraits — the trait-extraction prompt that turns raw
//     BrandToneSource excerpts into BrandToneHypothesis rows. The prompt is
//     the product; port verbatim from cpg-labs (no "improvements" on
//     migration — see docs/tov-migration-decisions.md follow-up #1).
// (2) extractTextFromImage + extractTextFromPdfBuffer — Claude vision OCR
//     used by the Meta + manual-upload adapters to read text rendered in
//     promo graphics and uploaded PDFs.

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

export type ToneInferenceSample = {
  sourceType: string;
  sourceId: string;
  excerpt: string;
};

export type ToneTraitHypothesis = {
  category: string;
  statement: string;
  evidence: Array<{
    sourceType: string;
    sourceId: string;
    snippet: string;
  }>;
  confidence: number;
};

export async function inferToneTraits(input: {
  tenantSlug: string;
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

  const log = rootLogger.child({
    tenant: input.tenantSlug,
    component: "tone-infer",
  });

  const language = input.contentLanguage || "en_US";
  const systemText = [
    `You are analyzing brand voice samples from ${input.brandName ?? input.tenantSlug}.`,
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
  ].join("\n");

  const samplesBlob = input.samples
    .map(
      (s, i) =>
        `[Sample ${i + 1}] sourceType=${s.sourceType} sourceId=${s.sourceId}\n${s.excerpt}`,
    )
    .join("\n\n---\n\n");

  try {
    log.info({ samples: input.samples.length }, "tone-infer START");
    const response = await client.messages.create({
      model: TEXT_MODEL,
      max_tokens: 4000,
      system: systemText,
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
    log.info({ hypotheses: hypotheses.length }, "tone-infer OK");
    return { hypotheses };
  } catch (err) {
    log.error({ err }, "tone-infer FAILED");
    return {
      error: err instanceof Error ? err.message : "Claude call failed.",
    };
  }
}

export async function extractTextFromImage(input: {
  tenantSlug: string;
  imageUrl: string;
}): Promise<{ text: string } | { error: string }> {
  const client = getClient();
  if (!client) return { error: "ANTHROPIC_API_KEY not configured." };

  const log = rootLogger.child({
    tenant: input.tenantSlug,
    component: "claude-image-ocr",
  });

  try {
    log.info({ url: input.imageUrl.slice(0, 80) }, "image-ocr START");
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
    log.info({ chars: text.length }, "image-ocr OK");
    return { text };
  } catch (err) {
    log.error({ err }, "image-ocr FAILED");
    return {
      error: err instanceof Error ? err.message : "Claude OCR failed.",
    };
  }
}

// Claude's `document` content type caps PDFs at 32MB base64-encoded. Base64
// expands raw bytes by ~33%, so the practical raw-byte ceiling is ~24MB. The
// upload-side cap is 30MB to let DOCX/TXT/MD use the full envelope, so we
// guard PDFs here.
const CLAUDE_PDF_BASE64_MAX = 32 * 1024 * 1024;

export async function extractTextFromPdfBuffer(input: {
  tenantSlug: string;
  pdfBase64: string;
  filename: string;
}): Promise<{ text: string } | { error: string }> {
  const client = getClient();
  if (!client) return { error: "ANTHROPIC_API_KEY not configured." };

  const log = rootLogger.child({
    tenant: input.tenantSlug,
    component: "claude-pdf-extract",
  });

  if (input.pdfBase64.length > CLAUDE_PDF_BASE64_MAX) {
    log.warn(
      { filename: input.filename, base64: input.pdfBase64.length },
      "pdf-extract SKIP oversize",
    );
    return {
      error:
        "PDF too large for AI extraction (>24MB after encoding). Try a smaller file, split it into sections, or paste the URL of an online version instead.",
    };
  }

  try {
    log.info({ filename: input.filename }, "pdf-extract START");
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
            {
              type: "text",
              text: "Extract the full readable text from this PDF.",
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text") as
      | { type: "text"; text: string }
      | undefined;
    const text = textBlock?.text?.trim() ?? "";
    if (!text) return { error: "Claude returned no extracted text." };
    log.info({ chars: text.length }, "pdf-extract OK");
    return { text };
  } catch (err) {
    log.error({ err }, "pdf-extract FAILED");
    return {
      error: err instanceof Error ? err.message : "Claude PDF extract failed.",
    };
  }
}
