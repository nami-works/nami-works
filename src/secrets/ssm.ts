import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

const DEFAULT_TTL_MS = 5 * 60 * 1000;

let defaultClient: SSMClient | undefined;
function getDefaultClient(): SSMClient {
  defaultClient ??= new SSMClient({
    ...(process.env.AWS_REGION ? { region: process.env.AWS_REGION } : {}),
  });
  return defaultClient;
}

type CacheEntry = { value: string; expiresAt: number };
const cache = new Map<string, CacheEntry>();

export type GetSecretOptions = {
  client?: SSMClient;
  ttlMs?: number;
  now?: () => number;
};

export async function getSecret(
  path: string,
  opts: GetSecretOptions = {},
): Promise<string> {
  const now = opts.now ? opts.now() : Date.now();
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;

  const hit = cache.get(path);
  if (hit && hit.expiresAt > now) return hit.value;

  const client = opts.client ?? getDefaultClient();
  const res = await client.send(
    new GetParameterCommand({ Name: path, WithDecryption: true }),
  );
  const value = res.Parameter?.Value;
  if (!value) {
    throw new Error(`SSM parameter not found or empty: ${path}`);
  }

  cache.set(path, { value, expiresAt: now + ttlMs });
  return value;
}

export function __clearSecretsCacheForTesting(): void {
  cache.clear();
  defaultClient = undefined;
}
