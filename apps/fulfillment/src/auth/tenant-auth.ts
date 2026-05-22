import { createHash, timingSafeEqual } from "node:crypto";
import type { FulfillmentTenant } from "@prisma/client-fulfillment";
import { prisma as defaultPrisma } from "../db/prisma.js";

export type TenantContext = {
  id: string;
  slug: string;
  displayName: string;
  cnpj: string;
  ssmPrefix: string;
  ldShop: string;
  ldControlTokenSsmKey: string;
  pickupLocationId: string;
};

export type TenantAuthSuccess = { ok: true; tenant: TenantContext };
export type TenantAuthFailure = { ok: false; status: 401 | 503; error: string };
export type TenantAuthResult = TenantAuthSuccess | TenantAuthFailure;

export type TenantLookup = {
  fulfillmentTenant: {
    findUnique: (args: {
      where: { slug: string };
    }) => Promise<FulfillmentTenant | null>;
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

// Decoy hash so timingSafeEqual runs in both branches — prevents a caller
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
  let tenant: FulfillmentTenant | null;
  try {
    tenant = await db.fulfillmentTenant.findUnique({
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
      cnpj: tenant.cnpj,
      ssmPrefix: tenant.ssmPrefix,
      ldShop: tenant.ldShop,
      ldControlTokenSsmKey: tenant.ldControlTokenSsmKey,
      pickupLocationId: tenant.pickupLocationId,
    },
  };
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
