import { prisma } from "../../db/prisma.js";
import { rootLogger } from "../../lib/logger.js";
import type {
  ToneEvidenceItem,
  ToneHypothesisCategory,
  ToneHypothesisStatus,
  ToneSourceConnectionStatus,
  ToneSourceType,
} from "./types.js";

// Aggregation/review layer for the tone-of-voice pipeline. Stateless reads
// against BrandToneSource + BrandToneHypothesis, plus the accept/reject
// transitions on hypotheses. The MCP tools + REST endpoints both wrap these.

export type ToneSourceSummary = {
  sourceType: ToneSourceType;
  status: ToneSourceConnectionStatus;
  sampleCount: number;
  lastSampledAt: Date | null;
  detail: string | null;
};

export type ToneHypothesisRow = {
  id: string;
  batchId: string;
  category: ToneHypothesisCategory;
  statement: string;
  evidence: ToneEvidenceItem[];
  confidence: number;
  status: ToneHypothesisStatus;
  createdAt: Date;
  reviewedAt: Date | null;
};

export type ToneBatchSummary = {
  batchId: string;
  createdAt: Date;
  totalSamples: number;
  pendingCount: number;
  acceptedCount: number;
  rejectedCount: number;
  sourceTypes: ToneSourceType[];
};

const ALL_SOURCE_TYPES: ToneSourceType[] = [
  "shopify_blog",
  "meta_ig",
  "meta_fb",
  "monday",
  "manual_upload",
  "manual_url",
];

export async function listSourceSummaries(
  tenantId: string,
): Promise<ToneSourceSummary[]> {
  const rows = await prisma.brandToneSource.findMany({
    where: { tenantId },
    orderBy: { capturedAt: "desc" },
  });

  const byType = new Map<ToneSourceType, typeof rows>();
  for (const row of rows) {
    const t = row.sourceType as ToneSourceType;
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(row);
  }

  return ALL_SOURCE_TYPES.map((sourceType) => {
    const typeRows = byType.get(sourceType) ?? [];
    if (typeRows.length === 0) {
      return {
        sourceType,
        status: "not_configured" as ToneSourceConnectionStatus,
        sampleCount: 0,
        lastSampledAt: null,
        detail: null,
      };
    }
    return {
      sourceType,
      status: "connected" as ToneSourceConnectionStatus,
      sampleCount: typeRows.length,
      lastSampledAt: typeRows[0]!.capturedAt,
      detail: summarizeRows(sourceType, typeRows),
    };
  });
}

function summarizeRows(
  sourceType: ToneSourceType,
  rows: { sourceUrl: string | null; metaJson: unknown }[],
): string {
  if (sourceType === "shopify_blog") {
    return `${rows.length} articles sampled`;
  }
  if (sourceType === "meta_ig" || sourceType === "meta_fb") {
    const handle = (rows[0]!.metaJson as { handle?: string } | null)?.handle;
    return handle ? `${handle} · ${rows.length} posts` : `${rows.length} posts`;
  }
  if (sourceType === "monday") {
    return `${rows.length} items across boards`;
  }
  if (sourceType === "manual_upload" || sourceType === "manual_url") {
    return `${rows.length} reference${rows.length === 1 ? "" : "s"}`;
  }
  return `${rows.length} samples`;
}

export async function listPendingHypotheses(
  tenantId: string,
  options: { minConfidence?: number; batchId?: string; limit?: number } = {},
): Promise<ToneHypothesisRow[]> {
  const rows = await prisma.brandToneHypothesis.findMany({
    where: {
      tenantId,
      status: "pending_review",
      ...(options.batchId ? { batchId: options.batchId } : {}),
    },
    orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
    ...(options.limit ? { take: options.limit } : {}),
  });

  const minConfidence = options.minConfidence ?? 0;
  return rows
    .filter((r) => r.confidence >= minConfidence)
    .map(toHypothesisRow);
}

export async function listRecentBatches(
  tenantId: string,
  limit = 10,
): Promise<ToneBatchSummary[]> {
  const sources = await prisma.brandToneSource.findMany({
    where: { tenantId },
    select: { batchId: true, sourceType: true, capturedAt: true },
  });
  const hypotheses = await prisma.brandToneHypothesis.findMany({
    where: { tenantId },
    select: { batchId: true, status: true, createdAt: true },
  });

  const byBatch = new Map<string, ToneBatchSummary>();
  for (const s of sources) {
    const summary = byBatch.get(s.batchId) ?? {
      batchId: s.batchId,
      createdAt: s.capturedAt,
      totalSamples: 0,
      pendingCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      sourceTypes: [] as ToneSourceType[],
    };
    summary.totalSamples += 1;
    if (s.capturedAt < summary.createdAt) summary.createdAt = s.capturedAt;
    if (!summary.sourceTypes.includes(s.sourceType as ToneSourceType)) {
      summary.sourceTypes.push(s.sourceType as ToneSourceType);
    }
    byBatch.set(s.batchId, summary);
  }
  for (const h of hypotheses) {
    const summary = byBatch.get(h.batchId);
    if (!summary) continue;
    if (h.status === "pending_review") summary.pendingCount += 1;
    else if (h.status === "accepted") summary.acceptedCount += 1;
    else if (h.status === "rejected") summary.rejectedCount += 1;
  }

  return Array.from(byBatch.values())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}

function toHypothesisRow(row: {
  id: string;
  batchId: string;
  category: string;
  statement: string;
  evidence: unknown;
  confidence: number;
  status: string;
  createdAt: Date;
  reviewedAt: Date | null;
}): ToneHypothesisRow {
  const evidence = Array.isArray(row.evidence)
    ? (row.evidence as ToneEvidenceItem[])
    : [];
  return {
    id: row.id,
    batchId: row.batchId,
    category: row.category as ToneHypothesisCategory,
    statement: row.statement,
    evidence,
    confidence: row.confidence,
    status: row.status as ToneHypothesisStatus,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
  };
}

export async function acceptHypothesis(input: {
  tenantId: string;
  tenantSlug: string;
  hypothesisId: string;
}) {
  rootLogger
    .child({ tenant: input.tenantSlug, component: "tone-service" })
    .info({ id: input.hypothesisId }, "hypothesis accept");
  return prisma.brandToneHypothesis.updateMany({
    where: { id: input.hypothesisId, tenantId: input.tenantId },
    data: { status: "accepted", reviewedAt: new Date() },
  });
}

export async function rejectHypothesis(input: {
  tenantId: string;
  tenantSlug: string;
  hypothesisId: string;
}) {
  rootLogger
    .child({ tenant: input.tenantSlug, component: "tone-service" })
    .info({ id: input.hypothesisId }, "hypothesis reject");
  return prisma.brandToneHypothesis.updateMany({
    where: { id: input.hypothesisId, tenantId: input.tenantId },
    data: { status: "rejected", reviewedAt: new Date() },
  });
}

export async function listAcceptedHypotheses(tenantId: string, limit = 50) {
  const rows = await prisma.brandToneHypothesis.findMany({
    where: { tenantId, status: "accepted" },
    orderBy: { reviewedAt: "desc" },
    take: limit,
  });
  return rows.map(toHypothesisRow);
}

export function makeBatchId(): string {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `batch_${ts}_${rnd}`;
}
