import { createHash, timingSafeEqual } from "node:crypto";
import type { Brand, IntegrationTenant } from "@prisma/client-connector";
import { prisma as defaultPrisma } from "../db/prisma.js";
import { verifyAccessToken } from "../oauth/jwt.js";

export type TenantContext = {
  id: string;
  slug: string;
  displayName: string;
  brand: Brand;
  shopifyShop: string | null;
  ssmPrefix: string;
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
  // through the JWT verifier; legacy bearers are pure base64url with no dots.
  if (looksLikeJwt(presented)) {
    const claims = await verifyAccessToken(presented);
    if (!claims) return UNAUTHORIZED;
    if (claims.tenant !== input.slug) return UNAUTHORIZED;

    let tenant: IntegrationTenant | null;
    try {
      tenant = await db.integrationTenant.findUnique({
        where: { slug: input.slug },
      });
    } catch {
      return BACKEND_DOWN;
    }
    if (!tenant || tenant.status !== "active") return UNAUTHORIZED;
    return {
      ok: true,
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        displayName: tenant.displayName,
        brand: tenant.brand,
        shopifyShop: tenant.shopifyShop,
        ssmPrefix: tenant.ssmPrefix,
      },
    };
  }

  // Path 2: legacy raw bearer (direct curl, Claude Desktop with manual config,
  // and the OAuth consent step itself). Constant-time hash compare.
  let tenant: IntegrationTenant | null;
  try {
    tenant = await db.integrationTenant.findUnique({
      where: { slug: input.slug },
    });
  } catch {
    return BACKEND_DOWN;
  }

  const candidateHash = sha256Hex(presented);
  const storedHash = tenant?.bearerTokenHash ?? DECOY_HASH;
  const matches = safeEqualHex(candidateHash, storedHash);

  if (!tenant || !matches) return UNAUTHORIZED;
  if (tenant.status !== "active") return UNAUTHORIZED;

  return {
    ok: true,
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      displayName: tenant.displayName,
      brand: tenant.brand,
      shopifyShop: tenant.shopifyShop,
      ssmPrefix: tenant.ssmPrefix,
    },
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
