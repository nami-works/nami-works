import { createHash } from "node:crypto";
import type { IntegrationTenant } from "@prisma/client-connector";
import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantLookup } from "../../auth/tenant-auth.js";

vi.mock("../../db/prisma.js", () => ({
  prisma: {
    brandToneHypothesis: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "../../db/prisma.js";
import { mountToneRoutes } from "./routes.js";

const BEARER = "tone-test-bearer-abcdef";
const BEARER_HASH = createHash("sha256").update(BEARER).digest("hex");

function tenantRow(
  overrides: Partial<IntegrationTenant> = {},
): IntegrationTenant {
  return {
    id: "t_test",
    slug: "test",
    displayName: "Test Tenant",
    brand: "cpg_labs",
    shopifyShop: null,
    bearerTokenHash: BEARER_HASH,
    ssmPrefix: "/nami-works/tenants/test",
    status: "active",
    contactEmail: "test@test.local",
    notes: null,
    contentLanguage: null,
    createdAt: new Date("2026-04-20T00:00:00Z"),
    updatedAt: new Date("2026-04-20T00:00:00Z"),
    ...overrides,
  };
}

function stubLookup(row: IntegrationTenant | null): TenantLookup {
  return {
    integrationTenant: { findUnique: async () => row },
  };
}

function buildApp(lookup: TenantLookup): FastifyInstance {
  const app = Fastify({ logger: false });
  mountToneRoutes(app, { prisma: lookup });
  return app;
}

const findManyMock = vi.mocked(prisma.brandToneHypothesis.findMany);

beforeEach(() => {
  findManyMock.mockReset();
  findManyMock.mockResolvedValue([] as never);
});

describe("GET /:tenant/api/tone/hypotheses — auth gate", () => {
  it("returns 401 when the Authorization header is missing", async () => {
    const app = buildApp(stubLookup(tenantRow()));
    const response = await app.inject({
      method: "GET",
      url: "/test/api/tone/hypotheses",
    });
    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      ok: false,
      error: "Unauthorized.",
    });
    expect(findManyMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 401 when the bearer is wrong", async () => {
    const app = buildApp(stubLookup(tenantRow()));
    const response = await app.inject({
      method: "GET",
      url: "/test/api/tone/hypotheses",
      headers: { authorization: "Bearer not-the-right-token" },
    });
    expect(response.statusCode).toBe(401);
    expect(findManyMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 401 when the tenant slug is unknown", async () => {
    const app = buildApp(stubLookup(null));
    const response = await app.inject({
      method: "GET",
      url: "/nope/api/tone/hypotheses",
      headers: { authorization: `Bearer ${BEARER}` },
    });
    expect(response.statusCode).toBe(401);
    expect(findManyMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 401 when the tenant is suspended", async () => {
    const app = buildApp(stubLookup(tenantRow({ status: "suspended" })));
    const response = await app.inject({
      method: "GET",
      url: "/test/api/tone/hypotheses",
      headers: { authorization: `Bearer ${BEARER}` },
    });
    expect(response.statusCode).toBe(401);
    expect(findManyMock).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("GET /:tenant/api/tone/hypotheses — happy path", () => {
  it("returns the wrapped envelope with iso-string createdAt", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "h_1",
        tenantId: "t_test",
        batchId: "batch_abc",
        category: "voice",
        statement: "Warm-expert register.",
        evidence: [
          { sourceType: "meta_ig", sourceId: "p_1", snippet: "..." },
        ],
        confidence: 0.82,
        status: "pending_review",
        createdAt: new Date("2026-05-21T12:00:00Z"),
        reviewedAt: null,
      },
    ] as never);

    const app = buildApp(stubLookup(tenantRow()));
    const response = await app.inject({
      method: "GET",
      url: "/test/api/tone/hypotheses",
      headers: { authorization: `Bearer ${BEARER}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toEqual({
      ok: true,
      tenant: "test",
      count: 1,
      hypotheses: [
        {
          id: "h_1",
          batchId: "batch_abc",
          category: "voice",
          statement: "Warm-expert register.",
          evidence: [
            { sourceType: "meta_ig", sourceId: "p_1", snippet: "..." },
          ],
          confidence: 0.82,
          status: "pending_review",
          createdAt: "2026-05-21T12:00:00.000Z",
        },
      ],
    });
    await app.close();
  });

  it("scopes the DB read to the authenticated tenant's id", async () => {
    const app = buildApp(stubLookup(tenantRow({ id: "t_test" })));
    await app.inject({
      method: "GET",
      url: "/test/api/tone/hypotheses",
      headers: { authorization: `Bearer ${BEARER}` },
    });

    expect(findManyMock.mock.calls[0]?.[0]?.where).toMatchObject({
      tenantId: "t_test",
      status: "pending_review",
    });
    await app.close();
  });
});

describe("GET /:tenant/api/tone/hypotheses — query validation", () => {
  it("rejects status filters other than pending_review with 400", async () => {
    const app = buildApp(stubLookup(tenantRow()));
    const response = await app.inject({
      method: "GET",
      url: "/test/api/tone/hypotheses?status=accepted",
      headers: { authorization: `Bearer ${BEARER}` },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toMatch(/pending_review/);
    expect(findManyMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("clamps an over-large limit to 200", async () => {
    const app = buildApp(stubLookup(tenantRow()));
    await app.inject({
      method: "GET",
      url: "/test/api/tone/hypotheses?limit=999999",
      headers: { authorization: `Bearer ${BEARER}` },
    });
    expect(findManyMock.mock.calls[0]?.[0]?.take).toBe(200);
    await app.close();
  });

  it("clamps a zero/negative limit up to 1", async () => {
    const app = buildApp(stubLookup(tenantRow()));
    await app.inject({
      method: "GET",
      url: "/test/api/tone/hypotheses?limit=-5",
      headers: { authorization: `Bearer ${BEARER}` },
    });
    expect(findManyMock.mock.calls[0]?.[0]?.take).toBe(1);
    await app.close();
  });

  it("honors a valid in-range limit verbatim", async () => {
    const app = buildApp(stubLookup(tenantRow()));
    await app.inject({
      method: "GET",
      url: "/test/api/tone/hypotheses?limit=25",
      headers: { authorization: `Bearer ${BEARER}` },
    });
    expect(findManyMock.mock.calls[0]?.[0]?.take).toBe(25);
    await app.close();
  });

  it("drops a NaN limit (no `take` argument)", async () => {
    const app = buildApp(stubLookup(tenantRow()));
    await app.inject({
      method: "GET",
      url: "/test/api/tone/hypotheses?limit=banana",
      headers: { authorization: `Bearer ${BEARER}` },
    });
    expect(findManyMock.mock.calls[0]?.[0]).not.toHaveProperty("take");
    await app.close();
  });

  it("threads a batch_id query param into the where clause", async () => {
    const app = buildApp(stubLookup(tenantRow()));
    await app.inject({
      method: "GET",
      url: "/test/api/tone/hypotheses?batch_id=batch_xyz",
      headers: { authorization: `Bearer ${BEARER}` },
    });
    expect(findManyMock.mock.calls[0]?.[0]?.where).toMatchObject({
      batchId: "batch_xyz",
    });
    await app.close();
  });

  it("filters by min_confidence (post-DB filter)", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "h_high",
        tenantId: "t_test",
        batchId: "b",
        category: "voice",
        statement: "...",
        evidence: [],
        confidence: 0.9,
        status: "pending_review",
        createdAt: new Date(),
        reviewedAt: null,
      },
      {
        id: "h_low",
        tenantId: "t_test",
        batchId: "b",
        category: "voice",
        statement: "...",
        evidence: [],
        confidence: 0.2,
        status: "pending_review",
        createdAt: new Date(),
        reviewedAt: null,
      },
    ] as never);

    const app = buildApp(stubLookup(tenantRow()));
    const response = await app.inject({
      method: "GET",
      url: "/test/api/tone/hypotheses?min_confidence=0.5",
      headers: { authorization: `Bearer ${BEARER}` },
    });
    const body = JSON.parse(response.body);
    expect(body.count).toBe(1);
    expect(body.hypotheses[0].id).toBe("h_high");
    await app.close();
  });
});
