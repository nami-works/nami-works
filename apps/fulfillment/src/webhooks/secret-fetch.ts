import {
  SSMClient,
  GetParameterCommand,
  type GetParameterCommandOutput,
} from "@aws-sdk/client-ssm";

const ssm = new SSMClient({ region: process.env.AWS_REGION ?? "us-east-1" });

// Per-process cache. SSM SecureString reads are billable + add ~50ms latency
// per call. For a worker tick that fires every 10s, cache the resolved value
// for the lifetime of the process. Tenant secret rotation requires a redeploy
// or a restart-based rotation flow — acceptable for v0.
const cache = new Map<string, string>();

export async function fetchSsmSecret(key: string): Promise<string> {
  // Local-dev escape hatch: if FULFILLMENT_SECRET_<KEY-AS-ENV-NAME> is set,
  // use it instead of hitting SSM. Lets the worker run locally with no AWS
  // creds. The env-var name strips slashes/dashes and uppercases the SSM key.
  const envName = `FULFILLMENT_SECRET_${key
    .replace(/^\//, "")
    .replace(/[/-]/g, "_")
    .toUpperCase()}`;
  const fromEnv = process.env[envName];
  if (fromEnv) return fromEnv;

  const cached = cache.get(key);
  if (cached) return cached;

  let result: GetParameterCommandOutput;
  try {
    result = await ssm.send(
      new GetParameterCommand({ Name: key, WithDecryption: true }),
    );
  } catch (err) {
    throw new Error(
      `SSM fetch failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const value = result.Parameter?.Value;
  if (!value) {
    throw new Error(`SSM parameter ${key} returned no value`);
  }
  cache.set(key, value);
  return value;
}

export function __clearSsmCacheForTesting(): void {
  cache.clear();
}
