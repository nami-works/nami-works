import { createHash } from "node:crypto";
import type { IntegrationTenant } from "@prisma/client-connector";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TenantLookup } from "../auth/tenant-auth.js";
import { __resetToolsForTesting } from "./registry.js";
import { mountTenantRoute } from "./transport.js";

const BEARER = "test-bearer-value-abcdef";
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
  mountTenantRoute(app, { prisma: lookup });
  return app;
}

beforeEach(() => {
  __resetToolsForTesting();
});

afterEach(() => {
  __resetToolsForTesting();
});

describe("POST /:tenant auth gate", () => {
  it("returns 401 when the Authorization header is missing", async () => {
    const app = buildApp(stubLookup(tenantRow()));
    const response = await app.inject({
      method: "POST",
      url: "/test",
      payload: { jsonrpc: "2.0", id: 1, method: "initialize" },
      headers: { "content-type": "application/json" },
    });
    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      ok: false,
      error: "Unauthorized.",
    });
    await app.close();
  });

  it("returns 401 when the bearer is wrong", async () => {
    const app = buildApp(stubLookup(tenantRow()));
    const response = await app.inject({
      method: "POST",
      url: "/test",
      payload: { jsonrpc: "2.0", id: 1, method: "initialize" },
      headers: {
        authorization: "Bearer not-the-right-token",
        "content-type": "application/json",
      },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("returns 401 when the tenant slug is unknown", async () => {
    const app = buildApp(stubLookup(null));
    const response = await app.inject({
      method: "POST",
      url: "/nope",
      payload: { jsonrpc: "2.0", id: 1, method: "initialize" },
      headers: {
        authorization: `Bearer ${BEARER}`,
        "content-type": "application/json",
      },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("returns 401 when the tenant is suspended", async () => {
    const app = buildApp(stubLookup(tenantRow({ status: "suspended" })));
    const response = await app.inject({
      method: "POST",
      url: "/test",
      payload: { jsonrpc: "2.0", id: 1, method: "initialize" },
      headers: {
        authorization: `Bearer ${BEARER}`,
        "content-type": "application/json",
      },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
