import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/prisma.js", () => ({
  prisma: {
    brandToneHypothesis: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { prisma } from "../../db/prisma.js";
import {
  acceptHypothesis,
  listAcceptedHypotheses,
  listPendingHypotheses,
  makeBatchId,
  rejectHypothesis,
} from "./service.js";

const findManyMock = vi.mocked(prisma.brandToneHypothesis.findMany);
const updateManyMock = vi.mocked(prisma.brandToneHypothesis.updateMany);

const TENANT_ID = "t_gebeauty";

function row(overrides: {
  id?: string;
  confidence?: number;
  status?: string;
  category?: string;
  evidence?: unknown;
} = {}) {
  // Using `in` (not `??`) so the override can be the literal value `null` —
  // we need that to test the non-array-evidence guardrail.
  const evidence =
    "evidence" in overrides
      ? overrides.evidence
      : [{ sourceType: "meta_ig", sourceId: "m_1", snippet: "..." }];
  return {
    id: overrides.id ?? "h_1",
    tenantId: TENANT_ID,
    batchId: "batch_20260521120000_abc123",
    category: overrides.category ?? "voice",
    statement: "Cúmplice em vez de professora.",
    evidence,
    confidence: overrides.confidence ?? 0.8,
    status: overrides.status ?? "pending_review",
    createdAt: new Date("2026-05-21T12:00:00Z"),
    reviewedAt: null,
  };
}

beforeEach(() => {
  findManyMock.mockReset();
  updateManyMock.mockReset();
});

describe("listPendingHypotheses", () => {
  it("queries pending_review for the supplied tenantId", async () => {
    findManyMock.mockResolvedValue([] as never);
    await listPendingHypotheses(TENANT_ID);

    const args = findManyMock.mock.calls[0]?.[0];
    expect(args?.where).toEqual({
      tenantId: TENANT_ID,
      status: "pending_review",
    });
    expect(args?.orderBy).toEqual([
      { confidence: "desc" },
      { createdAt: "desc" },
    ]);
  });

  it("filters by minConfidence after the DB read", async () => {
    findManyMock.mockResolvedValue([
      row({ id: "high", confidence: 0.9 }),
      row({ id: "mid", confidence: 0.5 }),
      row({ id: "low", confidence: 0.2 }),
    ] as never);

    const result = await listPendingHypotheses(TENANT_ID, {
      minConfidence: 0.6,
    });

    expect(result.map((r) => r.id)).toEqual(["high"]);
  });

  it("threads optional batchId into the where clause", async () => {
    findManyMock.mockResolvedValue([] as never);
    await listPendingHypotheses(TENANT_ID, { batchId: "batch_x" });

    expect(findManyMock.mock.calls[0]?.[0]?.where).toMatchObject({
      batchId: "batch_x",
    });
  });

  it("passes limit through as `take`", async () => {
    findManyMock.mockResolvedValue([] as never);
    await listPendingHypotheses(TENANT_ID, { limit: 25 });

    expect(findManyMock.mock.calls[0]?.[0]?.take).toBe(25);
  });

  it("omits `take` when no limit is supplied", async () => {
    findManyMock.mockResolvedValue([] as never);
    await listPendingHypotheses(TENANT_ID);

    expect(findManyMock.mock.calls[0]?.[0]).not.toHaveProperty("take");
  });

  it("returns an empty evidence array when the JSON column isn't an array", async () => {
    findManyMock.mockResolvedValue([
      row({ evidence: null }),
      row({ id: "h_2", evidence: "not-an-array" }),
    ] as never);

    const result = await listPendingHypotheses(TENANT_ID);
    expect(result[0]?.evidence).toEqual([]);
    expect(result[1]?.evidence).toEqual([]);
  });
});

describe("listAcceptedHypotheses", () => {
  it("queries accepted only, ordered by reviewedAt desc, default limit 50", async () => {
    findManyMock.mockResolvedValue([] as never);
    await listAcceptedHypotheses(TENANT_ID);

    const args = findManyMock.mock.calls[0]?.[0];
    expect(args?.where).toEqual({ tenantId: TENANT_ID, status: "accepted" });
    expect(args?.orderBy).toEqual({ reviewedAt: "desc" });
    expect(args?.take).toBe(50);
  });

  it("honors a custom limit", async () => {
    findManyMock.mockResolvedValue([] as never);
    await listAcceptedHypotheses(TENANT_ID, 10);
    expect(findManyMock.mock.calls[0]?.[0]?.take).toBe(10);
  });
});

describe("acceptHypothesis", () => {
  it("scopes updateMany by both id and tenantId (no cross-tenant write)", async () => {
    updateManyMock.mockResolvedValue({ count: 1 } as never);

    await acceptHypothesis({
      tenantId: TENANT_ID,
      tenantSlug: "gebeauty",
      hypothesisId: "h_42",
    });

    const args = updateManyMock.mock.calls[0]?.[0];
    expect(args?.where).toEqual({ id: "h_42", tenantId: TENANT_ID });
    expect(args?.data).toMatchObject({ status: "accepted" });
    expect(args?.data?.reviewedAt).toBeInstanceOf(Date);
  });
});

describe("rejectHypothesis", () => {
  it("scopes updateMany by both id and tenantId", async () => {
    updateManyMock.mockResolvedValue({ count: 1 } as never);

    await rejectHypothesis({
      tenantId: TENANT_ID,
      tenantSlug: "gebeauty",
      hypothesisId: "h_99",
    });

    const args = updateManyMock.mock.calls[0]?.[0];
    expect(args?.where).toEqual({ id: "h_99", tenantId: TENANT_ID });
    expect(args?.data).toMatchObject({ status: "rejected" });
  });
});

describe("makeBatchId", () => {
  it("produces a value with the batch_<timestamp>_<random> shape", () => {
    const id = makeBatchId();
    expect(id).toMatch(/^batch_\d{14}_[a-z0-9]{6}$/);
  });

  it("returns unique ids across rapid successive calls", () => {
    const ids = new Set([
      makeBatchId(),
      makeBatchId(),
      makeBatchId(),
      makeBatchId(),
      makeBatchId(),
    ]);
    expect(ids.size).toBe(5);
  });
});
