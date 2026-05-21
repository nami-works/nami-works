/**
 * Per-shop Intelipost credential CRUD.
 * Mirrors the shape of app/services/lalamove-credentials.server.ts.
 *
 * - apiKey is encrypted at rest via AES-256-GCM (encryption.server.ts).
 * - Optional `apiEndpoint` lets a merchant point at sandbox vs prod.
 * - validate() calls IntelipostAdapter.validateCredentials and updates
 *   `lastValidatedAt` on success.
 *
 * See docs/plans/local-delivery-analytics.md §6.3 + §8.
 */

import prisma from "../../db.server";
import { decryptSecret, encryptSecret } from "../security/encryption.server";
import { IntelipostAdapter } from "../warehouse-carrier/adapters/intelipost.server";
import type { WarehouseProviderId } from "../warehouse-carrier/types";

const PROVIDER: WarehouseProviderId = "intelipost";
const MAX_LEN = 512;
const KEY_PATTERN = /^[A-Za-z0-9._:\-/+=]+$/;

export type IntelipostCredentialInput = {
  apiKey: string;
  apiEndpoint?: string;
};

export type IntelipostCredentialStatus = {
  configured: boolean;
  lastValidatedAt: string | null;
  apiEndpoint: string | null;
  apiKeyMask: string;
};

const trim = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function validateInput(
  apiKeyRaw: unknown,
  apiEndpointRaw?: unknown,
): { ok: true; apiKey: string; apiEndpoint?: string } | { ok: false; reason: string } {
  const apiKey = trim(apiKeyRaw);
  if (!apiKey) return { ok: false, reason: "missing_api_key" };
  if (apiKey.length > MAX_LEN) return { ok: false, reason: "api_key_too_long" };
  if (!KEY_PATTERN.test(apiKey)) return { ok: false, reason: "api_key_invalid_format" };

  const endpointRaw = apiEndpointRaw === undefined ? "" : trim(apiEndpointRaw);
  if (!endpointRaw) {
    return { ok: true, apiKey };
  }
  let parsed: URL;
  try {
    parsed = new URL(endpointRaw);
  } catch {
    return { ok: false, reason: "endpoint_invalid_url" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "endpoint_protocol_must_be_http_or_https" };
  }
  return { ok: true, apiKey, apiEndpoint: endpointRaw };
}

export async function saveCredentials(
  shop: string,
  input: IntelipostCredentialInput,
): Promise<void> {
  console.info(`[ld-analytics:credentials] save START shop=${shop} provider=${PROVIDER}`);
  const enc = encryptSecret(input.apiKey);
  await prisma.warehouseCarrierCredential.upsert({
    where: { shop_provider: { shop, provider: PROVIDER } },
    create: {
      shop,
      provider: PROVIDER,
      apiKeyCiphertext: enc.ciphertext,
      apiSecretCiphertext: null,
      apiEndpoint: input.apiEndpoint ?? null,
      keyVersion: enc.keyVersion,
    },
    update: {
      apiKeyCiphertext: enc.ciphertext,
      apiEndpoint: input.apiEndpoint ?? null,
      keyVersion: enc.keyVersion,
    },
  });
  console.info(`[ld-analytics:credentials] save OK shop=${shop} provider=${PROVIDER}`);
}

export async function deleteCredentials(shop: string): Promise<void> {
  console.info(`[ld-analytics:credentials] delete START shop=${shop} provider=${PROVIDER}`);
  await prisma.warehouseCarrierCredential.deleteMany({
    where: { shop, provider: PROVIDER },
  });
  console.info(`[ld-analytics:credentials] delete OK shop=${shop} provider=${PROVIDER}`);
}

export async function getStatus(shop: string): Promise<IntelipostCredentialStatus> {
  const row = await prisma.warehouseCarrierCredential.findUnique({
    where: { shop_provider: { shop, provider: PROVIDER } },
    select: {
      apiKeyCiphertext: true,
      apiEndpoint: true,
      lastValidatedAt: true,
    },
  });
  if (!row) {
    return { configured: false, lastValidatedAt: null, apiEndpoint: null, apiKeyMask: "" };
  }
  let apiKeyMask = "";
  try {
    const apiKey = decryptSecret(row.apiKeyCiphertext);
    apiKeyMask = apiKey.length > 4 ? `***********${apiKey.slice(-4)}` : "******";
  } catch (error) {
    console.warn(`[ld-analytics:credentials] decrypt FAILED shop=${shop}`, error);
    apiKeyMask = "******";
  }
  return {
    configured: true,
    lastValidatedAt: row.lastValidatedAt?.toISOString() ?? null,
    apiEndpoint: row.apiEndpoint ?? null,
    apiKeyMask,
  };
}

/** Validate stored creds against the Intelipost API; mark validated on success. */
export async function validate(
  shop: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  console.info(`[ld-analytics:credentials] validate START shop=${shop} provider=${PROVIDER}`);
  const row = await prisma.warehouseCarrierCredential.findUnique({
    where: { shop_provider: { shop, provider: PROVIDER } },
  });
  if (!row) {
    console.warn(`[ld-analytics:credentials] validate FAILED shop=${shop} reason=no_credentials`);
    return { ok: false, reason: "no_credentials" };
  }
  let apiKey: string;
  try {
    apiKey = decryptSecret(row.apiKeyCiphertext);
  } catch (error) {
    console.warn(
      `[ld-analytics:credentials] validate FAILED shop=${shop} reason=decrypt_failed`,
      error,
    );
    return { ok: false, reason: "decrypt_failed" };
  }
  const result = await IntelipostAdapter.validateCredentials({
    apiKey,
    endpoint: row.apiEndpoint ?? undefined,
  });
  if (result.ok) {
    await prisma.warehouseCarrierCredential.updateMany({
      where: { shop, provider: PROVIDER },
      data: { lastValidatedAt: new Date() },
    });
    console.info(`[ld-analytics:credentials] validate OK shop=${shop}`);
    return { ok: true };
  }
  console.warn(
    `[ld-analytics:credentials] validate FAILED shop=${shop} reason=${result.reason}`,
  );
  return { ok: false, reason: result.reason };
}
