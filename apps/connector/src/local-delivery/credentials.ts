import { getSecret } from "../secrets/ssm.js";
import type { LalamoveCredentials } from "./vendored/lalamove-quote.js";

const DEFAULT_TTL_MS = 5 * 60 * 1000;

type CacheEntry = { credentials: LalamoveCredentials; expiresAt: number };
const cache = new Map<string, CacheEntry>();

export type LalamoveCredentialsArgs = { ssmPrefix: string };

export async function getLalamoveCredentials(
  args: LalamoveCredentialsArgs,
): Promise<LalamoveCredentials> {
  const key = args.ssmPrefix;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.credentials;

  const [apiKey, apiSecret] = await Promise.all([
    getSecret(`${args.ssmPrefix}/lalamove/api_key`),
    getSecret(`${args.ssmPrefix}/lalamove/api_secret`),
  ]);

  if (apiKey === "REPLACE_ME" || apiSecret === "REPLACE_ME") {
    throw new Error(
      `Lalamove credentials for ${args.ssmPrefix} are placeholder values. Run \`aws ssm put-parameter --overwrite\` against ${args.ssmPrefix}/lalamove/api_key and ${args.ssmPrefix}/lalamove/api_secret with the tenant's real Lalamove API credentials.`,
    );
  }

  const credentials: LalamoveCredentials = { apiKey, apiSecret };
  cache.set(key, { credentials, expiresAt: now + DEFAULT_TTL_MS });
  return credentials;
}

export function __clearLalamoveCredentialsCacheForTesting(): void {
  cache.clear();
}
