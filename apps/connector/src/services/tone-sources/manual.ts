import { prisma } from "../../db/prisma.js";
import { rootLogger } from "../../lib/logger.js";
import { extractTextFromPdfBuffer } from "./claude.js";
import { deleteToneFile, downloadToneFile, uploadToneFile } from "./s3.js";

// Manual reference adapter — files (PDF / DOCX / TXT / MD) and URLs. Binary
// payloads go to S3 under tenants/<slug>/tone-uploads/<sourceId>; extracted
// text goes into BrandToneSource.rawText. PDFs route through Claude vision
// for text extraction; DOCX through `mammoth`; HTML via stripHtml.

const MAX_RAW_TEXT_CHARS = 80_000;
const MAX_FETCHED_BYTES = 30 * 1024 * 1024;

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

type ExtractResult = { text: string; mediaType: string } | { error: string };

export async function extractFromBuffer(input: {
  tenantSlug: string;
  buffer: Buffer;
  filename: string;
  mimeType: string;
}): Promise<ExtractResult> {
  const { tenantSlug, buffer, filename, mimeType } = input;
  const lower = filename.toLowerCase();
  const log = rootLogger.child({
    tenant: tenantSlug,
    component: "tone-manual",
  });

  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) {
    const result = await extractTextFromPdfBuffer({
      tenantSlug,
      pdfBase64: buffer.toString("base64"),
      filename,
    });
    if ("error" in result) return result;
    return { text: result.text, mediaType: "application/pdf" };
  }

  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  ) {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      const text = result.value.trim();
      if (!text) return { error: "DOCX contained no extractable text." };
      return { text, mediaType: "docx" };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "DOCX parse failed.";
      log.error({ err }, "docx FAILED");
      return { error: message };
    }
  }

  if (
    mimeType.startsWith("text/") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md")
  ) {
    const text = buffer.toString("utf-8").trim();
    if (!text) return { error: "Text file is empty." };
    return { text, mediaType: "text/plain" };
  }

  return { error: `Unsupported file type: ${mimeType || "unknown"}` };
}

export async function extractFromUrl(input: {
  tenantSlug: string;
  url: string;
}): Promise<ExtractResult> {
  const { tenantSlug, url } = input;
  const log = rootLogger.child({
    tenant: tenantSlug,
    component: "tone-manual",
  });
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "Invalid URL." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { error: "Only http and https URLs are supported." };
  }

  log.info({ url }, "fetch START");
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "NAMI-Works/tone-source-ingest" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fetch failed.";
    return { error: message };
  }
  if (!response.ok) {
    return {
      error: `Fetch failed: ${response.status} ${response.statusText}`,
    };
  }

  const contentType = response.headers.get("content-type") ?? "";
  const contentLength = parseInt(
    response.headers.get("content-length") ?? "0",
    10,
  );
  if (contentLength > 0 && contentLength > MAX_FETCHED_BYTES) {
    return { error: "Resource too large (>30MB)." };
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_FETCHED_BYTES) {
    return { error: "Resource too large (>30MB)." };
  }
  const buffer = Buffer.from(arrayBuffer);

  if (
    contentType.includes("application/pdf") ||
    url.toLowerCase().endsWith(".pdf")
  ) {
    const result = await extractTextFromPdfBuffer({
      tenantSlug,
      pdfBase64: buffer.toString("base64"),
      filename: parsed.pathname,
    });
    if ("error" in result) return result;
    return { text: result.text, mediaType: "application/pdf" };
  }

  if (contentType.includes("text/html")) {
    const html = buffer.toString("utf-8");
    const text = stripHtml(html);
    if (!text) return { error: "HTML had no extractable text." };
    return { text, mediaType: "text/html" };
  }

  if (contentType.startsWith("text/")) {
    const text = buffer.toString("utf-8").trim();
    if (!text) return { error: "Resource is empty." };
    return { text, mediaType: "text/plain" };
  }

  return { error: `Unsupported content type: ${contentType}` };
}

export async function persistManualSource(input: {
  tenantId: string;
  tenantSlug: string;
  batchId: string;
  sourceType: "manual_upload" | "manual_url";
  sourceId: string;
  sourceUrl: string | null;
  rawText: string;
  metaJson: Record<string, unknown>;
}) {
  const log = rootLogger.child({
    tenant: input.tenantSlug,
    component: "tone-manual",
  });
  const text = input.rawText.slice(0, MAX_RAW_TEXT_CHARS);
  if (text.trim().length < 50) {
    log.warn({ chars: text.length }, "persist SKIP too_short");
    return null;
  }

  return prisma.brandToneSource.upsert({
    where: {
      tenantId_sourceType_sourceId: {
        tenantId: input.tenantId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
    },
    create: {
      tenantId: input.tenantId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceUrl: input.sourceUrl,
      rawText: text,
      metaJson: input.metaJson as object,
      batchId: input.batchId,
    },
    update: {
      rawText: text,
      capturedAt: new Date(),
      batchId: input.batchId,
      metaJson: input.metaJson as object,
    },
  });
}

export async function listManualReferences(tenantId: string) {
  return prisma.brandToneSource.findMany({
    where: {
      tenantId,
      sourceType: { in: ["manual_upload", "manual_url"] },
    },
    orderBy: { capturedAt: "desc" },
    take: 50,
  });
}

export async function deleteManualReference(input: {
  tenantId: string;
  tenantSlug: string;
  sourceId: string;
}) {
  const log = rootLogger.child({
    tenant: input.tenantSlug,
    component: "tone-manual",
  });
  const existing = await prisma.brandToneSource.findFirst({
    where: {
      tenantId: input.tenantId,
      sourceId: input.sourceId,
      sourceType: { in: ["manual_upload", "manual_url"] },
    },
  });

  if (existing) {
    const s3Key = (existing.metaJson as { s3Key?: string } | null)?.s3Key;
    if (s3Key) {
      const result = await deleteToneFile({
        tenantSlug: input.tenantSlug,
        key: s3Key,
      });
      if ("error" in result) {
        log.warn(
          { sourceId: input.sourceId, reason: result.error },
          "s3 delete SKIP",
        );
      }
    }
  }

  return prisma.brandToneSource.deleteMany({
    where: {
      tenantId: input.tenantId,
      sourceId: input.sourceId,
      sourceType: { in: ["manual_upload", "manual_url"] },
    },
  });
}

// Persist a manual upload's binary to S3 + extracted text to DB. If S3 fails,
// the row is still saved with text-only (graceful degradation).
export async function persistManualUploadWithBinary(input: {
  tenantId: string;
  tenantSlug: string;
  batchId: string;
  sourceId: string;
  rawText: string;
  buffer: Buffer;
  contentType: string;
  filename: string;
  mediaType: string;
}) {
  const log = rootLogger.child({
    tenant: input.tenantSlug,
    component: "tone-manual",
  });
  const upload = await uploadToneFile({
    tenantSlug: input.tenantSlug,
    sourceId: input.sourceId,
    body: input.buffer,
    contentType: input.contentType,
    filename: input.filename,
  });

  const baseMeta: Record<string, unknown> = {
    filename: input.filename,
    mediaType: input.mediaType,
    sizeBytes: input.buffer.length,
    contentType: input.contentType,
  };

  if (!("error" in upload)) {
    baseMeta.s3Key = upload.key;
    baseMeta.s3Bucket =
      process.env.TONE_UPLOADS_S3_BUCKET ?? "nami-works-tone-uploads";
  } else {
    log.warn(
      { sourceId: input.sourceId, reason: upload.error },
      "s3 upload SKIP",
    );
  }

  return persistManualSource({
    tenantId: input.tenantId,
    tenantSlug: input.tenantSlug,
    batchId: input.batchId,
    sourceType: "manual_upload",
    sourceId: input.sourceId,
    sourceUrl: null,
    rawText: input.rawText,
    metaJson: baseMeta,
  });
}

// Re-fetch a previously uploaded file from S3 and re-run text extraction with
// the current Claude pipeline. Useful when Claude improves and the merchant
// wants a fresher pass without re-uploading.
export async function reExtractFromS3(input: {
  tenantId: string;
  tenantSlug: string;
  sourceId: string;
}): Promise<{ rawText: string } | { error: string }> {
  const row = await prisma.brandToneSource.findFirst({
    where: {
      tenantId: input.tenantId,
      sourceId: input.sourceId,
      sourceType: "manual_upload",
    },
  });
  if (!row) return { error: "Manual upload not found." };

  const meta = (row.metaJson ?? {}) as {
    s3Key?: string;
    contentType?: string;
    filename?: string;
  };
  if (!meta.s3Key) {
    return { error: "No S3 binary recorded for this upload." };
  }

  const download = await downloadToneFile({
    tenantSlug: input.tenantSlug,
    key: meta.s3Key,
  });
  if ("error" in download) return { error: download.error };

  const extracted = await extractFromBuffer({
    tenantSlug: input.tenantSlug,
    buffer: download.body,
    filename: meta.filename ?? "(unknown)",
    mimeType: meta.contentType ?? download.contentType ?? "",
  });
  if ("error" in extracted) return { error: extracted.error };

  await prisma.brandToneSource.update({
    where: { id: row.id },
    data: {
      rawText: extracted.text.slice(0, 80_000),
      capturedAt: new Date(),
    },
  });

  return { rawText: extracted.text };
}
