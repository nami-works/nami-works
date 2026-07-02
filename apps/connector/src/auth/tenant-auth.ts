import { createHash, timingSafeEqual } from "node:crypto";
import type {
  Brand,
  IntegrationTenant,
  PrincipalRole,
  TenantPrincipal,
} from "@prisma/client-connector";
import { prisma as defaultPrisma } from "../db/prisma.js";
import { verifyAccessToken } from "../oauth/jwt.js";

export type TenantContext = {
  id: string;
  slug: string;
  displayName: string;
  brand: Brand;
  shopifyShop: string | null;
  ssmPrefix: string;
  // Who is acting, and with what authority. `role` gates canonical tools;
  // principalId/actorLabel drive per-person attribution in the audit log.
  // For the legacy tenant-level break-glass bearer, role is "owner" and the
  // principal fields are null.
  role: PrincipalRole;
  principalId: string | null;
  actorLabel: string | null;
};

export type PrincipalWithTenant = TenantPrincipal & {
  tenant: IntegrationTenant;
};

export type TenantAuthSuccess = { ok: true; tenant: TenantContext };
export type TenantAuthFailure = { ok: false; status: 401 | 503; error: string };
export type TenantAuthResult = TenantAuthSuccess | TenantAuthFailure;

export type TenantLookup = {
  integrationTenant: {
    findUnique: (args: {
      where: { slug: string };
    }) => Promise<IntegrationTenant | null>;
  };
  // Optional so test stubs and the legacy tenant-bearer path keep working
  // without a principal table. In production the real Prisma client always
  // provides this, so raw/JWT bearers resolve to a principal first.
  tenantPrincipal?: {
    findUnique: (args: {
      where: { bearerTokenHash: string } | { id: string };
      include?: { tenant: true };
    }) => Promise<PrincipalWithTenant | null>;
  };
};

const UNAUTHORIZED: TenantAuthFailure = {
  ok: false,
  status: 401,
  error: "Unauthorized.",
};

const BACKEND_DOWN: TenantAuthFailure = {
  ok: false,
  status: 503,
  error: "Auth backend unavailable.",
};

// SHA-256 of 64 zero bytes. Used as a decoy when the tenant row is absent so
// the timingSafeEqual work is done in either branch, preventing a caller from
// distinguishing unknown-slug from wrong-token via response latency.
const DECOY_HASH = sha256Hex("\0".repeat(64));

export async function authorizeTenantRequest(input: {
  slug: string;
  authorizationHeader: string | undefined;
  prisma?: TenantLookup;
}): Promise<TenantAuthResult> {
  const presented = extractBearer(input.authorizationHeader);
  if (!presented) return UNAUTHORIZED;

  const db = input.prisma ?? defaultPrisma;

  // Path 1: JWT (the OAuth-issued access token). Tokens shaped like
  // `xxx.yyy.zzz` (3 dot-separated base64url segments) are only attempted
  // through the JWT verifier; raw bearers are pure base64url with no dots.
  if (looksLikeJwt(presented)) {
    const claims = await verifyAccessToken(presented);
    if (!claims) return UNAUTHORIZED;
    if (claims.tenant !== input.slug) return UNAUTHORIZED;

    // Per-user token: re-resolve the principal live so a revoked or demoted
    // person can't keep acting on a still-valid 24h token. Role comes from the
    // DB, never trusted from the token body.
    if (claims.pid && db.tenantPrincipal) {
      let principal: PrincipalWithTenant | null;
      try {
        principal = await db.tenantPrincipal.findUnique({
          where: { id: claims.pid },
          include: { tenant: true },
        });
      } catch {
        return BACKEND_DOWN;
      }
      if (
        !principal ||
        principal.status !== "active" ||
        principal.tenant.slug !== input.slug ||
        principal.tenant.status !== "active"
      ) {
        return UNAUTHORIZED;
      }
      return { ok: true, tenant: contextFromPrincipal(principal) };
    }

    // Legacy tenant-scoped token (no principal) → owner break-glass.
    let tenant: IntegrationTenant | null;
    try {
      tenant = await db.integrationTenant.findUnique({
        where: { slug: input.slug },
      });
    } catch {
      return BACKEND_DOWN;
    }
    if (!tenant || tenant.status !== "active") return UNAUTHORIZED;
    return { ok: true, tenant: contextFromTenant(tenant, "owner") };
  }

  // Path 2: raw bearer (direct curl, Claude Desktop manual config, and the
  // OAuth consent step).
  const candidateHash = sha256Hex(presented);

  // 2a: per-principal bearer — the primary model. Lookup by hash (indexed).
  if (db.tenantPrincipal) {
    let principal: PrincipalWithTenant | null;
    try {
      principal = await db.tenantPrincipal.findUnique({
        where: { bearerTokenHash: candidateHash },
        include: { tenant: true },
      });
    } catch {
      return BACKEND_DOWN;
    }
    if (principal) {
      if (
        principal.status !== "active" ||
        principal.tenant.slug !== input.slug ||
        principal.tenant.status !== "active"
      ) {
        return UNAUTHORIZED;
      }
      return { ok: true, tenant: contextFromPrincipal(principal) };
    }
  }

  // 2b: legacy tenant-level bearer (owner break-glass, Lucas only). Decoy hash
  // keeps latency uniform when the tenant row is absent so the response time
  // doesn't leak unknown-slug vs wrong-token.
  let tenant: IntegrationTenant | null;
  try {
    tenant = await db.integrationTenant.findUnique({
      where: { slug: input.slug },
    });
  } catch {
    return BACKEND_DOWN;
  }
  const storedHash = tenant?.bearerTokenHash ?? DECOY_HASH;
  const matches = safeEqualHex(candidateHash, storedHash);
  if (!tenant || !matches) return UNAUTHORIZED;
  if (tenant.status !== "active") return UNAUTHORIZED;
  return { ok: true, tenant: contextFromTenant(tenant, "owner") };
}

function contextFromPrincipal(p: PrincipalWithTenant): TenantContext {
  return {
    id: p.tenant.id,
    slug: p.tenant.slug,
    displayName: p.tenant.displayName,
    brand: p.tenant.brand,
    shopifyShop: p.tenant.shopifyShop,
    ssmPrefix: p.tenant.ssmPrefix,
    role: p.role,
    principalId: p.id,
    actorLabel: p.label,
  };
}

function contextFromTenant(
  t: IntegrationTenant,
  role: PrincipalRole,
): TenantContext {
  return {
    id: t.id,
    slug: t.slug,
    displayName: t.displayName,
    brand: t.brand,
    shopifyShop: t.shopifyShop,
    ssmPrefix: t.ssmPrefix,
    role,
    principalId: null,
    actorLabel: null,
  };
}

function looksLikeJwt(token: string): boolean {
  const parts = token.split(".");
  return (
    parts.length === 3 &&
    parts.every((p) => p.length > 0 && /^[A-Za-z0-9_-]+$/.test(p))
  );
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
