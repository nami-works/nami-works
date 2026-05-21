import { createHash } from "node:crypto";
import type { IntegrationTenant } from "@prisma/client-connector";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetSigningKeyForTesting,
  signAccessToken,
} from "../oauth/jwt.js";
import { authorizeTenantRequest, type TenantLookup } from "./tenant-auth.js";

const BEARER = "the-raw-bearer-value-for-tests";
const BEARER_HASH = createHash("sha256").update(BEARER).digest("hex");

function tenantRow(
  overrides: Partial<IntegrationTenant> = {},
): IntegrationTenant {
  return {
    id: "t_gebeauty",
    slug: "gebeauty",
    displayName: "GE Beauty",
    brand: "cpg_labs",
    shopifyShop: "gebeauty.myshopify.com",
    bearerTokenHash: BEARER_HASH,
    ssmPrefix: "/nami-works/tenants/gebeauty",
    status: "active",
    contactEmail: "ops@gebeauty.com.br",
    notes: null,
    createdAt: new Date("2026-04-20T00:00:00Z"),
    updatedAt: new Date("2026-04-20T00:00:00Z"),
    ...overrides,
  };
}

function stub(
  row: IntegrationTenant | null,
  opts: { throws?: boolean } = {},
): TenantLookup {
  return {
    integrationTenant: {
      findUnique: async () => {
        if (opts.throws) throw new Error("simulated DB failure");
        return row;
      },
    },
  };
}

describe("authorizeTenantRequest", () => {
  it("returns 401 when the Authorization header is missing", async () => {
    const result = await authorizeTenantRequest({
      slug: "gebeauty",
      authorizationHeader: undefined,
      prisma: stub(tenantRow()),
    });
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: "Unauthorized.",
    });
  });

  it("returns 401 when the Authorization header is malformed", async () => {
    const result = await authorizeTenantRequest({
      slug: "gebeauty",
      authorizationHeader: "Basic abc",
      prisma: stub(tenantRow()),
    });
    expect(result.ok).toBe(false);
  });

  it("returns 401 when the tenant slug does not exist", async () => {
    const result = await authorizeTenantRequest({
      slug: "nonexistent",
      authorizationHeader: `Bearer ${BEARER}`,
      prisma: stub(null),
    });
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: "Unauthorized.",
    });
  });

  it("returns 401 when the bearer token does not match", async () => {
    const result = await authorizeTenantRequest({
      slug: "gebeauty",
      authorizationHeader: "Bearer wrong-token-value",
      prisma: stub(tenantRow()),
    });
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: "Unauthorized.",
    });
  });

  it("returns 401 when the tenant is suspended (kill switch)", async () => {
    const result = await authorizeTenantRequest({
      slug: "gebeauty",
      authorizationHeader: `Bearer ${BEARER}`,
      prisma: stub(tenantRow({ status: "suspended" })),
    });
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: "Unauthorized.",
    });
  });

  it("returns 503 when the database throws", async () => {
    const result = await authorizeTenantRequest({
      slug: "gebeauty",
      authorizationHeader: `Bearer ${BEARER}`,
      prisma: stub(null, { throws: true }),
    });
    expect(result).toEqual({
      ok: false,
      status: 503,
      error: "Auth backend unavailable.",
    });
  });

  it("returns the tenant context on a valid, active tenant + matching bearer", async () => {
    const result = await authorizeTenantRequest({
      slug: "gebeauty",
      authorizationHeader: `Bearer ${BEARER}`,
      prisma: stub(tenantRow()),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tenant.slug).toBe("gebeauty");
      expect(result.tenant.displayName).toBe("GE Beauty");
      expect(result.tenant.brand).toBe("cpg_labs");
      expect(result.tenant.ssmPrefix).toBe("/nami-works/tenants/gebeauty");
      expect(result.tenant.shopifyShop).toBe("gebeauty.myshopify.com");
    }
  });
});

describe("authorizeTenantRequest — JWT (OAuth-issued) path", () => {
  beforeEach(() => {
    __resetSigningKeyForTesting("test-jwt-key-for-tenant-auth-tests-12345");
  });
  afterEach(() => {
    __resetSigningKeyForTesting();
  });

  it("accepts a valid JWT whose tenant claim matches the URL slug", async () => {
    const jwt = await signAccessToken({ tenantSlug: "gebeauty" });
    const result = await authorizeTenantRequest({
      slug: "gebeauty",
      authorizationHeader: `Bearer ${jwt}`,
      prisma: stub(tenantRow()),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tenant.slug).toBe("gebeauty");
  });

  it("rejects a JWT whose tenant claim does not match the URL slug", async () => {
    const jwt = await signAccessToken({ tenantSlug: "acme" });
    const result = await authorizeTenantRequest({
      slug: "gebeauty",
      authorizationHeader: `Bearer ${jwt}`,
      prisma: stub(tenantRow()),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a JWT signed with a different key", async () => {
    const jwt = await signAccessToken({ tenantSlug: "gebeauty" });
    __resetSigningKeyForTesting("a-totally-different-key-987654321zyxwvut");
    const result = await authorizeTenantRequest({
      slug: "gebeauty",
      authorizationHeader: `Bearer ${jwt}`,
      prisma: stub(tenantRow()),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a valid JWT when the tenant has been suspended", async () => {
    const jwt = await signAccessToken({ tenantSlug: "gebeauty" });
    const result = await authorizeTenantRequest({
      slug: "gebeauty",
      authorizationHeader: `Bearer ${jwt}`,
      prisma: stub(tenantRow({ status: "suspended" })),
    });
    expect(result.ok).toBe(false);
  });
});
