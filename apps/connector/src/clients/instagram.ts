import { getSecret } from "../secrets/ssm.js";

/**
 * Instagram Graph API client (per-tenant, read-only).
 *
 * Mirrors the `buildXClient` + `getXClient({ ssmPrefix })` shape used by
 * `omie.ts`. Read-only on purpose: this v0 only fetches the
 * brand's own media for tone-of-voice extraction. Posting / commenting /
 * any write surface is deliberately out of scope — wire up a separate
 * client when that lands so the read path can't accidentally mutate.
 *
 * Auth model: the `long_lived_token` in SSM is a Facebook user/page token
 * with `instagram_basic` + `pages_read_engagement` (or `pages_show_list`).
 * Long-lived tokens last ~60 days; ingest job warns when expiry < 7 days.
 */

const GRAPH_BASE_URL =
  process.env.INSTAGRAM_GRAPH_BASE_URL ?? "https://graph.facebook.com/v21.0";
const CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 4;

const MEDIA_FIELDS = [
  "id",
  "caption",
  "media_type",
  "media_url",
  "thumbnail_url",
  "permalink",
  "timestamp",
  "like_count",
  "comments_count",
  "children{id,media_type,media_url,thumbnail_url}",
].join(",");

export type IgMediaChild = {
  id: string;
  media_type: "IMAGE" | "VIDEO";
  media_url?: string;
  thumbnail_url?: string;
};

export type IgMedia = {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp: string; // ISO 8601
  like_count?: number;
  comments_count?: number;
  children?: { data: IgMediaChild[] };
};

export type IgMediaPage = {
  data: IgMedia[];
  paging?: {
    cursors?: { before?: string; after?: string };
    next?: string;
  };
};

export type IgAccountInfo = {
  id: string;
  username?: string;
};

export type ListMediaArgs = {
  igUserId: string;
  /** Cursor returned by a prior page (`paging.cursors.after`). */
  after?: string;
  /** Max items per page (Graph API caps around 100; default 50). */
  limit?: number;
  /** Unix timestamp; only return media newer than this. */
  since?: number;
};

export type InstagramClient = {
  getAccountInfo(igUserId: string): Promise<IgAccountInfo>;
  listMedia(args: ListMediaArgs): Promise<IgMediaPage>;
};

function defaultBackoff(attempt: number): Promise<void> {
  const ms = 2 ** attempt * 500;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type BuildInstagramClientOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  backoff?: (attempt: number) => Promise<void>;
};

export function buildInstagramClient(
  accessToken: string,
  opts: BuildInstagramClientOptions = {},
): InstagramClient {
  const baseUrl = (opts.baseUrl ?? GRAPH_BASE_URL).replace(/\/+$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.backoff ?? defaultBackoff;

  async function request<T>(path: string, params: Record<string, string>): Promise<T> {
    const qs = new URLSearchParams({ ...params, access_token: accessToken });
    const url = `${baseUrl}/${path.replace(/^\/+/, "")}?${qs.toString()}`;

    let lastErr = "";
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      const res = await fetchImpl(url, { method: "GET" });
      if (res.ok) return (await res.json()) as T;

      const text = await res.text().catch(() => "");
      lastErr = `HTTP ${res.status}: ${text || res.statusText}`;

      if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_RETRIES) {
        await sleep(attempt);
        continue;
      }
      break;
    }
    throw new Error(`Instagram Graph API request failed: ${lastErr}`);
  }

  return {
    async getAccountInfo(igUserId: string) {
      return request<IgAccountInfo>(igUserId, { fields: "id,username" });
    },

    async listMedia(args: ListMediaArgs) {
      const params: Record<string, string> = {
        fields: MEDIA_FIELDS,
        limit: String(args.limit ?? 50),
      };
      if (args.after) params["after"] = args.after;
      if (args.since) params["since"] = String(args.since);
      return request<IgMediaPage>(`${args.igUserId}/media`, params);
    },
  };
}

type CacheEntry = { client: InstagramClient; expiresAt: number };
const cache = new Map<string, CacheEntry>();

export type InstagramClientArgs = { ssmPrefix: string };

export async function getInstagramClient(
  args: InstagramClientArgs,
): Promise<InstagramClient> {
  const key = args.ssmPrefix;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.client;

  const token = await getSecret(`${args.ssmPrefix}/instagram/long_lived_token`);

  if (token === "REPLACE_ME" || token.length < 20) {
    throw new Error(
      `Instagram token for ${args.ssmPrefix} is a placeholder. Run \`aws ssm put-parameter --overwrite\` against ${args.ssmPrefix}/instagram/long_lived_token with a long-lived Facebook token before invoking Instagram tools.`,
    );
  }

  const client = buildInstagramClient(token);
  cache.set(key, { client, expiresAt: now + CLIENT_CACHE_TTL_MS });
  return client;
}

export function __clearInstagramClientCacheForTesting(): void {
  cache.clear();
}
