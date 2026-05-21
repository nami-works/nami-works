/**
 * Warehouse-carrier aggregator — single entry point for the rest of the app.
 *
 * Responsibilities:
 *   - Look up the configured WarehouseCarrierCredential for a shop.
 *   - Decrypt credentials via app/services/security/encryption.server.ts.
 *   - Dispatch to the right adapter.
 *   - Emit [ld-analytics:warehouse-carrier] logs.
 *
 * Never logs API keys, secrets, postal codes, customer addresses, or other PII.
 * See docs/plans/local-delivery-analytics.md §4.2 and §9.
 */

import prisma from "../../db.server";
import { decryptSecret } from "../security/encryption.server";
import { IntelipostAdapter } from "./adapters/intelipost.server";
import type {
  WarehouseCarrierAdapter,
  WarehouseCarrierCredentials,
  WarehouseProviderId,
  WarehouseQuoteError,
  WarehouseQuoteRequest,
  WarehouseQuoteResult,
  WarehouseValidateResult,
} from "./types";

const ADAPTERS: Record<WarehouseProviderId, WarehouseCarrierAdapter> = {
  intelipost: IntelipostAdapter,
  // v2+: frenet, melhor_envio
  frenet: IntelipostAdapter, // placeholder; never selected because no creds will exist
  melhor_envio: IntelipostAdapter, // placeholder
};

export function getAdapter(provider: WarehouseProviderId): WarehouseCarrierAdapter {
  return ADAPTERS[provider];
}

export type ShopCredentialRow = {
  provider: WarehouseProviderId;
  credentials: WarehouseCarrierCredentials;
  lastValidatedAt: Date | null;
};

/** Returns the (single) configured warehouse carrier for a shop, or null. */
export async function getActiveCredentialForShop(
  shop: string,
): Promise<ShopCredentialRow | null> {
  const row = await prisma.warehouseCarrierCredential.findFirst({
    where: { shop },
    orderBy: { updatedAt: "desc" },
  });
  if (!row) {
    return null;
  }
  const provider = row.provider as WarehouseProviderId;
  if (!ADAPTERS[provider]) {
    console.warn(
      `[ld-analytics:warehouse-carrier] unknown provider stored shop=${shop} provider=${provider}`,
    );
    return null;
  }
  return {
    provider,
    credentials: {
      apiKey: decryptSecret(row.apiKeyCiphertext),
      apiSecret: row.apiSecretCiphertext ? decryptSecret(row.apiSecretCiphertext) : undefined,
      endpoint: row.apiEndpoint ?? undefined,
    },
    lastValidatedAt: row.lastValidatedAt,
  };
}

/**
 * Quote a single order for a shop's configured warehouse carrier.
 * Returns:
 *   - WarehouseQuoteResult — success
 *   - WarehouseQuoteError  — provider returned an error (auth, rate-limit, etc.)
 *   - null                 — no warehouse carrier configured for this shop
 */
export async function quoteForShop(
  shop: string,
  req: WarehouseQuoteRequest,
): Promise<WarehouseQuoteResult | WarehouseQuoteError | null> {
  const cred = await getActiveCredentialForShop(shop);
  if (!cred) {
    return null;
  }
  const adapter = getAdapter(cred.provider);
  console.info(
    `[ld-analytics:warehouse-carrier] quote START shop=${shop} provider=${cred.provider}`,
  );
  const startedAt = Date.now();
  try {
    const result = await adapter.quote(cred.credentials, req);
    const elapsed = Date.now() - startedAt;
    if ("priceSubunits" in result) {
      console.info(
        `[ld-analytics:warehouse-carrier] quote OK shop=${shop} provider=${cred.provider} priceSubunits=${result.priceSubunits} durationMs=${elapsed}`,
      );
    } else {
      console.warn(
        `[ld-analytics:warehouse-carrier] quote FAILED shop=${shop} provider=${cred.provider} errorCode=${result.errorCode} retryable=${result.retryable} durationMs=${elapsed}`,
      );
    }
    return result;
  } catch (error) {
    const elapsed = Date.now() - startedAt;
    console.error(
      `[ld-analytics:warehouse-carrier] quote THREW shop=${shop} provider=${cred.provider} durationMs=${elapsed}`,
      error,
    );
    return {
      provider: cred.provider,
      errorCode: "unknown",
      message: error instanceof Error ? error.message : "unknown error",
      retryable: true,
    };
  }
}

/** Validate stored credentials for a shop's configured provider. */
export async function validateCredentialsForShop(
  shop: string,
  provider: WarehouseProviderId,
): Promise<WarehouseValidateResult> {
  const cred = await getActiveCredentialForShop(shop);
  if (!cred || cred.provider !== provider) {
    return { ok: false, reason: "no_credentials" };
  }
  const adapter = getAdapter(provider);
  console.info(
    `[ld-analytics:credentials] validate START shop=${shop} provider=${provider}`,
  );
  try {
    const result = await adapter.validateCredentials(cred.credentials);
    if (result.ok) {
      console.info(
        `[ld-analytics:credentials] validate OK shop=${shop} provider=${provider}`,
      );
    } else {
      console.warn(
        `[ld-analytics:credentials] validate FAILED shop=${shop} provider=${provider} reason=${result.reason}`,
      );
    }
    return result;
  } catch (error) {
    console.error(
      `[ld-analytics:credentials] validate THREW shop=${shop} provider=${provider}`,
      error,
    );
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "unknown error",
    };
  }
}
