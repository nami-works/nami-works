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

// One Omie legal entity (empresa) the tenant operates, with its own API client.
export type OmieCompany = { code: string; label?: string; client: OmieClient };

type CompaniesCacheEntry = { companies: OmieCompany[]; expiresAt: number };
const companiesCache = new Map<string, CompaniesCacheEntry>();

type CompanyManifestEntry = {
  code: string;
  label?: string;
  appKey: string;
  appSecret: string;
};

/**
 * All Omie companies configured for a tenant. GE runs several Omie legal
 * entities, so the Omie tools query every configured company and aggregate.
 *
 * Source of truth is a JSON manifest at `${ssmPrefix}/omie/companies`:
 *   [{ "code": "000174", "label": "…", "appKey": "…", "appSecret": "…" }, …]
 * When the manifest is absent (or placeholder), we fall back to the legacy
 * single-company pair `${ssmPrefix}/omie/app_key` + `/app_secret` as one
 * company keyed "principal", so older provisioning keeps working.
 */
export async function getOmieCompanies(
  args: OmieClientArgs,
): Promise<OmieCompany[]> {
  const now = Date.now();
  const hit = companiesCache.get(args.ssmPrefix);
  if (hit && hit.expiresAt > now) return hit.companies;

  const manifestRaw = await getSecret(
    `${args.ssmPrefix}/omie/companies`,
  ).catch(() => null);

  let companies: OmieCompany[];
  if (manifestRaw && manifestRaw !== "REPLACE_ME") {
    let parsed: CompanyManifestEntry[];
    try {
      parsed = JSON.parse(manifestRaw) as CompanyManifestEntry[];
    } catch {
      throw new Error(
        `Omie companies manifest at ${args.ssmPrefix}/omie/companies is not valid JSON.`,
      );
    }
    companies = parsed
      .filter(
        (c) =>
          c.appKey &&
          c.appSecret &&
          c.appKey !== "REPLACE_ME" &&
          c.appSecret !== "REPLACE_ME",
      )
      .map((c) => ({
        code: c.code,
        ...(c.label ? { label: c.label } : {}),
        client: buildOmieClient(c.appKey, c.appSecret),
      }));
    if (companies.length === 0) {
      throw new Error(
        `Omie companies manifest at ${args.ssmPrefix}/omie/companies has no usable entries (all missing or placeholder credentials).`,
      );
    }
  } else {
    // Legacy single-company fallback (throws on placeholder, as before).
    const client = await getOmieClient({ ssmPrefix: args.ssmPrefix });
    companies = [{ code: "principal", client }];
  }

  companiesCache.set(args.ssmPrefix, {
    companies,
    expiresAt: now + CLIENT_CACHE_TTL_MS,
  });
  return companies;
}

export type CompanyResolution =
  | { kind: "one"; company: OmieCompany }
  | { kind: "ambiguous"; companies: OmieCompany[] }
  | { kind: "notfound"; requested: string; companies: OmieCompany[] };

// Pick the Omie company to query. If the caller named one (`empresa` = code),
// resolve it; if there's only one company, use it; otherwise signal ambiguity so
// the tool can ask the user which company (app) they mean.
export function resolveOmieCompany(
  companies: OmieCompany[],
  requested?: string,
): CompanyResolution {
  if (requested && requested.length > 0) {
    const match = companies.find((c) => c.code === requested);
    return match
      ? { kind: "one", company: match }
      : { kind: "notfound", requested, companies };
  }
  if (companies.length === 1) return { kind: "one", company: companies[0]! };
  return { kind: "ambiguous", companies };
}

// One-line listing of the configured companies, for disambiguation prompts.
export function describeOmieCompanies(companies: OmieCompany[]): string {
  return companies
    .map((c) => `- ${c.code}${c.label ? ` (${c.label})` : ""}`)
    .join("\n");
}

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
  companiesCache.clear();
}
