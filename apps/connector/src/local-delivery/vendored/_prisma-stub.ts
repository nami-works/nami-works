/**
 * Stub Prisma client for vendored cpg-labs files.
 *
 * The vendored optimizer / adapter / geocode files (sourced from cpg-labs)
 * use Prisma to look up:
 *   - `lalamoveLocationConfig` rows (per-shop pickup configs)
 *   - `routePolylineCache` rows (Google Routes API polyline cache)
 *   - `geocodeCacheEntry` rows (Google Geocoding cache)
 *
 * We don't replicate those tables in nami-works's schema — instead:
 *   - `lalamoveLocationConfig` → replaced by in-memory `src/local-delivery/config.ts`
 *   - `routePolylineCache` → skipped entirely (we don't render polylines; Leaflet
 *     draws straight-line route lines, which is fine for clustering judgment)
 *   - `geocodeCacheEntry` → optionally backed by `LdSimGeocache` Prisma model
 *     in our schema. For v1, falls through to in-memory cache.
 *
 * This stub returns "cache miss" semantics for every read (null / []) and
 * accepts any write as a no-op. The vendored code's cache-miss paths then
 * exercise the live Google / Lalamove APIs as expected.
 */

type AnyArgs = (...args: unknown[]) => Promise<unknown>;

const noopNull: AnyArgs = async () => null;
const noopArr: AnyArgs = async () => [];

// Use `any` here so the vendored files' calls — which reference Prisma's
// generated row types — don't need exact-shape matching against the stub.
// The methods are no-ops; TS won't flag the cache-miss paths.
const prisma: any = {
  routePolylineCache: {
    upsert: noopNull,
    findMany: noopArr,
  },
  lalamoveLocationConfig: {
    findFirst: noopNull,
    findMany: noopArr,
  },
  geocodeCacheEntry: {
    findUnique: noopNull,
    upsert: noopNull,
  },
};

export default prisma;
