import { getSecret } from "../secrets/ssm.js";

/**
 * Omie JSON-RPC client (per-tenant).
 *
 * Pattern, mirrored from `..\cpg-labs\gebeauty-workspace\scripts\omie_*.py`:
 * - POST https://app.omie.com.br/api/v1/<resource>/
 * - Body: { app_key, app_secret, call: <method>, param: [<param>] }
 * - Headers: Content-Type: application/json (no signing — credentials in body)
 * - Retry on 425/429/5xx with exponential backoff (2s/4s/8s/16s/32s, max 5)
 * - Omie returns HTTP 200 even on logical faults; the JSON body carries
 *   `faultstring` + `faultcode` in that case. Treat fault as failure.
 */

const OMIE_BASE_URL =
  process.env.OMIE_BASE_URL ?? "https://app.omie.com.br/api/v1";
const CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;
const RETRYABLE_STATUS = new Set([425, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 5;

export type OmieCallSuccess<TResponse> = { ok: true; data: TResponse };
export type OmieCallFailure = {
  ok: false;
  status: number;
  faultstring: string;
  faultcode?: string;
};
export type OmieCallResult<TResponse> =
  | OmieCallSuccess<TResponse>
  | OmieCallFailure;

export type OmieCallArgs<TParam> = {
  resource: string;
  method: string;
  param: TParam;
};

export type OmieClient = {
  call: <TParam, TResponse>(
    args: OmieCallArgs<TParam>,
  ) => Promise<OmieCallResult<TResponse>>;
};

type CacheEntry = { client: OmieClient; expiresAt: number };
const cache = new Map<string, CacheEntry>();

function defaultBackoff(attempt: number): Promise<void> {
  const ms = 2 ** attempt * 1000;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type BuildClientOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  backoff?: (attempt: number) => Promise<void>;
};

export function buildOmieClient(
  appKey: string,
  appSecret: string,
  opts: BuildClientOptions = {},
): OmieClient {
  const baseUrl = opts.baseUrl ?? OMIE_BASE_URL;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.backoff ?? defaultBackoff;

  return {
    async call<TParam, TResponse>(
      args: OmieCallArgs<TParam>,
    ): Promise<OmieCallResult<TResponse>> {
      const url = `${baseUrl}/${args.resource.replace(/^\/+|\/+$/g, "")}/`;
      const body = JSON.stringify({
        app_key: appKey,
        app_secret: appSecret,
        call: args.method,
        param: [args.param],
      });

      let lastFailure: OmieCallFailure | null = null;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
        let res: Response;
        try {
          res = await fetchImpl(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          });
        } catch (err) {
          lastFailure = {
            ok: false,
            status: 0,
            faultstring:
              err instanceof Error ? err.message : String(err),
          };
          if (attempt < MAX_RETRIES) {
            await sleep(attempt);
            continue;
          }
          return lastFailure;
        }

        if (res.ok) {
          const json = (await res.json()) as
            | TResponse
            | { faultstring?: unknown; faultcode?: unknown };
          const fs = (json as { faultstring?: unknown }).faultstring;
          if (typeof fs === "string") {
            const fc = (json as { faultcode?: unknown }).faultcode;
            return {
              ok: false,
              status: 200,
              faultstring: fs,
              ...(typeof fc === "string" ? { faultcode: fc } : {}),
            };
          }
          return { ok: true, data: json as TResponse };
        }

        const text = await res.text().catch(() => "");
        lastFailure = {
          ok: false,
          status: res.status,
          faultstring: text || `HTTP ${res.status}`,
        };

        if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_RETRIES) {
          await sleep(attempt);
          continue;
        }
        return lastFailure;
      }
      return (
        lastFailure ?? {
          ok: false,
          status: 0,
          faultstring: "max retries exceeded",
        }
      );
    },
  };
}

export type OmieClientArgs = { ssmPrefix: string };

export async function getOmieClient(args: OmieClientArgs): Promise<OmieClient> {
  const key = args.ssmPrefix;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.client;

  const [appKey, appSecret] = await Promise.all([
    getSecret(`${args.ssmPrefix}/omie/app_key`),
    getSecret(`${args.ssmPrefix}/omie/app_secret`),
  ]);

  if (appKey === "REPLACE_ME" || appSecret === "REPLACE_ME") {
    throw new Error(
      `Omie credentials for ${args.ssmPrefix} are placeholder values. Run \`aws ssm put-parameter --overwrite\` against ${args.ssmPrefix}/omie/app_key and ${args.ssmPrefix}/omie/app_secret with the tenant's real Omie API credentials before invoking Omie tools.`,
    );
  }

  const client = buildOmieClient(appKey, appSecret);
  cache.set(key, { client, expiresAt: now + CLIENT_CACHE_TTL_MS });
  return client;
}

export function __clearOmieClientCacheForTesting(): void {
  cache.clear();
}
