import prisma from "../../db.server";
import { inferToneTraits } from "../claude/client.server";
import type { ToneSourceType } from "./types";

const MAX_SAMPLES_PER_BATCH = 30;
const MAX_EXCERPT_CHARS = 4000;

export async function runInferenceForBatch(input: {
  shop: string;
  batchId: string;
}): Promise<{ created: number } | { error: string }> {
  const { shop, batchId } = input;
  console.info(
    `[tone-sources:inference] START shop=${shop} batchId=${batchId}`,
  );

  const sources = await prisma.brandToneSource.findMany({
    where: { shop, batchId },
    orderBy: { capturedAt: "desc" },
  });
  if (sources.length === 0) {
    console.warn(
      `[tone-sources:inference] SKIP shop=${shop} reason=no_sources`,
    );
    return { created: 0 };
  }

  const sortedByLength = [...sources].sort(
    (a, b) => b.rawText.length - a.rawText.length,
  );
  const selected = sortedByLength.slice(0, MAX_SAMPLES_PER_BATCH);

  const assets = await prisma.brandAssets.findUnique({ where: { shop } });
  const contentLanguage = assets?.contentLanguage ?? "en_US";
  const brandName = assets?.brandName ?? null;

  const samples = selected.map((s) => ({
    sourceType: s.sourceType,
    sourceId: s.sourceId,
    excerpt: s.rawText.slice(0, MAX_EXCERPT_CHARS),
  }));

  const result = await inferToneTraits({
    shop,
    contentLanguage,
    brandName,
    samples,
  });
  if ("error" in result) {
    console.error(
      `[tone-sources:inference] FAILED shop=${shop} reason=${result.error}`,
    );
    return { error: result.error };
  }

  if (result.hypotheses.length === 0) {
    console.info(
      `[tone-sources:inference] OK shop=${shop} hypotheses=0 batchId=${batchId}`,
    );
    return { created: 0 };
  }

  let created = 0;
  for (const h of result.hypotheses) {
    const evidence = Array.isArray(h.evidence) ? h.evidence.slice(0, 5) : [];
    await prisma.brandToneHypothesis.create({
      data: {
        shop,
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

  console.info(
    `[tone-sources:inference] OK shop=${shop} hypotheses=${created} batchId=${batchId}`,
  );
  return { created };
}

export async function listAcceptedTraitsForContext(
  shop: string,
  limit = 50,
): Promise<
  Array<{
    category: string;
    statement: string;
    sourceTypes: ToneSourceType[];
  }>
> {
  const rows = await prisma.brandToneHypothesis.findMany({
    where: { shop, status: "accepted" },
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
