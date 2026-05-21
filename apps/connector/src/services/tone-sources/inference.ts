import { prisma } from "../../db/prisma.js";
import { rootLogger } from "../../lib/logger.js";
import { inferToneTraits } from "./claude.js";
import type { ToneSourceType } from "./types.js";

// Inference engine. Reads a batch of BrandToneSource rows for a tenant,
// asks Claude to extract trait hypotheses, writes them as
// BrandToneHypothesis rows in pending_review for the merchant to triage.

const MAX_SAMPLES_PER_BATCH = 30;
const MAX_EXCERPT_CHARS = 4000;

export async function runInferenceForBatch(input: {
  tenantId: string;
  tenantSlug: string;
  batchId: string;
}): Promise<{ created: number } | { error: string }> {
  const { tenantId, tenantSlug, batchId } = input;
  const log = rootLogger.child({
    tenant: tenantSlug,
    component: "tone-inference",
  });
  log.info({ batchId }, "START");

  const sources = await prisma.brandToneSource.findMany({
    where: { tenantId, batchId },
    orderBy: { capturedAt: "desc" },
  });
  if (sources.length === 0) {
    log.warn("SKIP no_sources");
    return { created: 0 };
  }

  const sortedByLength = [...sources].sort(
    (a, b) => b.rawText.length - a.rawText.length,
  );
  const selected = sortedByLength.slice(0, MAX_SAMPLES_PER_BATCH);

  const tenant = await prisma.integrationTenant.findUnique({
    where: { id: tenantId },
    include: { brandSettings: true },
  });
  const contentLanguage = tenant?.contentLanguage ?? "en_US";
  const brandName = tenant?.brandSettings?.brandName ?? tenant?.displayName ?? null;

  const samples = selected.map((s) => ({
    sourceType: s.sourceType,
    sourceId: s.sourceId,
    excerpt: s.rawText.slice(0, MAX_EXCERPT_CHARS),
  }));

  const result = await inferToneTraits({
    tenantSlug,
    contentLanguage,
    brandName,
    samples,
  });
  if ("error" in result) {
    log.error({ reason: result.error }, "FAILED");
    return { error: result.error };
  }

  if (result.hypotheses.length === 0) {
    log.info({ batchId }, "OK hypotheses=0");
    return { created: 0 };
  }

  let created = 0;
  for (const h of result.hypotheses) {
    const evidence = Array.isArray(h.evidence) ? h.evidence.slice(0, 5) : [];
    await prisma.brandToneHypothesis.create({
      data: {
        tenantId,
        batchId,
        category: h.category,
        statement: h.statement.trim().slice(0, 500),
        evidence: evidence as unknown as object,
        confidence:
          typeof h.confidence === "number"
            ? Math.max(0, Math.min(1, h.confidence))
            : 0.5,
        status: "pending_review",
      },
    });
    created += 1;
  }

  log.info({ batchId, created }, "OK");
  return { created };
}

export async function listAcceptedTraitsForContext(
  tenantId: string,
  limit = 50,
): Promise<
  Array<{
    category: string;
    statement: string;
    sourceTypes: ToneSourceType[];
  }>
> {
  const rows = await prisma.brandToneHypothesis.findMany({
    where: { tenantId, status: "accepted" },
    orderBy: { reviewedAt: "desc" },
    take: limit,
  });

  return rows.map((row) => {
    const evidence = Array.isArray(row.evidence)
      ? (row.evidence as Array<{ sourceType: string }>)
      : [];
    const sourceTypes = Array.from(
      new Set(evidence.map((e) => e.sourceType as ToneSourceType)),
    );
    return {
      category: row.category,
      statement: row.statement,
      sourceTypes,
    };
  });
}
