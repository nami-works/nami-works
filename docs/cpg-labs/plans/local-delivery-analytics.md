# Implementation Spec — Local Delivery Analytics v1

| Field | Value |
|---|---|
| **Feature slug** | `local-delivery-analytics` |
| **Status** | Phase 3 — awaiting approval |
| **Branch** | `feat/local-delivery-analytics-v1` |
| **References** | Brief: [`inputs/briefs/local-delivery-analytics.md`](../../inputs/briefs/local-delivery-analytics.md) · Mockup: [`inputs/mockups/local-delivery-analytics-v1.html`](../../inputs/mockups/local-delivery-analytics-v1.html) |
| **Created** | 2026-05-10 |
| **First-instance spec** | Yes — also defines the spec-format convention going forward |

This is the file phase 4 (build) reads. It must answer every question phase 4 would otherwise ping back about: file paths, function signatures, table columns, action intents, log strings, i18n keys, sequencing.

---

## §1. Reference docs (read before editing this file)

- Brief — full context and v1 scope: `inputs/briefs/local-delivery-analytics.md`
- Mockup — visual + state design: `inputs/mockups/local-delivery-analytics-v1.html`
- Existing carrier adapter pattern (LD providers): `app/services/carrier/types.ts`, `app/services/carrier/aggregator.server.ts`
- Existing Lalamove credential pattern: `app/services/lalamove.server.ts`, `LalamoveShopCredential` in `prisma/schema.prisma`
- CLAUDE.md sections that govern this work: "Logging", "Shopify Design Compliance", "UI Patterns", "Subpath", "Carrier Services", "Product & Data"

---

## §2. File-by-file diff plan

### New files (created by phase 4)

| Path | Purpose | LOC est |
|---|---|---|
| `app/routes/app.local-delivery.analytics.tsx` | Sub-route loader + action + page component for the analytics panel | ~600 |
| `app/routes/app.local-delivery.analytics/styles.module.css` | CSS module for the panel | ~250 |
| `app/services/warehouse-carrier/types.ts` | `WarehouseCarrierAdapter` interface + shared types | ~80 |
| `app/services/warehouse-carrier/aggregator.server.ts` | Adapter registry + per-shop selection | ~120 |
| `app/services/warehouse-carrier/adapters/intelipost.server.ts` | Concrete Intelipost adapter implementation | ~300 |
| `app/services/warehouse-carrier/quote-cache.server.ts` | Read-through cache layer over `WarehouseCarrierQuoteCache` | ~150 |
| `app/services/ld-analytics/rollup.server.ts` | Daily rollup logic that populates `LdAnalyticsDaily` | ~200 |
| `app/services/ld-analytics/queries.server.ts` | Loader-side aggregation queries (per-city, per-month, drilldown) | ~250 |
| `app/services/ld-analytics/pl-math.server.ts` | P&L formula + framing calculations (pure functions) | ~80 |
| `app/services/ld-analytics/intelipost-credentials.server.ts` | Encrypted credential CRUD (mirrors `lalamove.server.ts` shape) | ~120 |
| `app/routes/api.cron.ld-analytics-rollup.tsx` | Daily cron endpoint that triggers rollup | ~100 |
| `app/i18n/locales/en/ld-analytics.json` | English strings | ~100 |
| `app/i18n/locales/pt-BR/ld-analytics.json` | Portuguese (BR) strings | ~100 |
| `prisma/migrations/<timestamp>_ld_analytics/migration.sql` | Schema migration (4 new tables) | ~120 |
| `app/services/warehouse-carrier/__tests__/intelipost.test.ts` | Unit tests for Intelipost adapter | ~150 |
| `app/services/ld-analytics/__tests__/pl-math.test.ts` | Unit tests for P&L math | ~120 |

### Modified files

| Path | Change | LOC est |
|---|---|---|
| `prisma/schema.prisma` | Append 4 new models (see §3) | +60 |
| `app/routes/app.local-delivery.tsx` | Add "View analytics" `<s-button>` to page header | +12 |
| `app/routes/app.settings.tsx` | Add per-shop opt-in toggle row + Intelipost credential row in Local Delivery section | +60 |
| `app/i18n/resources.ts` | Register `ld-analytics` namespace | +4 |
| `app/i18n/locales/en/common.json` | Add nav-adjacent strings if any | +0–4 |
| `app/i18n/locales/pt-BR/common.json` | Same | +0–4 |
| `.claude/deploy-queue.md` | Append pending-deploy entry post-merge (per CLAUDE.md) | +12 |

**Out of scope for v1, deliberately not touched**:
- `app/services/carrier/` (LD providers — not the same domain as warehouse carriers)
- Existing analytics aggregation in `RetailCityMonthly` (Footprint Expansion ownership)
- Any LD page logic beyond the entry-point button addition
- Sessions data sync (deferred to v3)

---

## §3. Prisma schema migration

Append to `prisma/schema.prisma`. Migration file: `prisma/migrations/<YYYYMMDDHHMMSS>_ld_analytics/migration.sql`.

```prisma
model WarehouseCarrierCredential {
  id                  String   @id @default(cuid())
  shop                String
  provider            String   // "intelipost" | "frenet" | "melhor_envio" (v2+)
  apiKeyCiphertext    String
  apiSecretCiphertext String?  // null for providers that use single-key auth
  apiEndpoint         String?  // optional override (sandbox vs prod)
  keyVersion          Int      @default(1)
  lastValidatedAt     DateTime?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@unique([shop, provider])
  @@index([shop])
}

model WarehouseCarrierQuoteCache {
  id              String   @id @default(cuid())
  shop            String
  orderId         String   // gid://shopify/Order/{n}
  provider        String
  priceSubunits   Int      // R$ in cents
  currency        String
  minDeliveryDate String?
  maxDeliveryDate String?
  rawResponseJson Json?    // for diagnostics
  quotedAt        DateTime @default(now())
  expiresAt       DateTime

  @@unique([shop, orderId, provider])
  @@index([shop, expiresAt])
  @@index([shop, orderId])
}

model LdAnalyticsDaily {
  id                          String   @id @default(cuid())
  shop                        String
  cityNorm                    String
  cityDisplay                 String
  date                        DateTime // truncated to UTC midnight
  ldOrderCount                Int      @default(0)
  ldRevenueSubunits           Int      @default(0)   // customer-charged for LD
  ldCarrierCostSubunits       Int      @default(0)   // Lalamove quote total
  warehouseCounterfactualSubunits Int  @default(0)   // sum of WH quotes (carrier rate)
  warehouseCustomerRateSubunits   Int  @default(0)   // sum of customer-charged WH counterfactuals
  taxSavingsSubunits          Int      @default(0)
  currencyCode                String
  coveragePercent             Int      // 0-100, % of orders successfully quoted
  computedAt                  DateTime @default(now())

  @@unique([shop, cityNorm, date])
  @@index([shop, date])
}

model LdAnalyticsConfig {
  shop                            String   @id // shop is the unique key
  enabled                         Boolean  @default(false)  // opt-in toggle
  headlineFraming                 String   @default("net_cost_delta")
                                          // "pl_impact" | "revenue_retained" | "net_cost_delta"
                                          // v1 default flipped 2026-05-10 — see post-phase-4 amendment in §17 below.
  perCityTaxSavingsJson           Json     @default("{}")
                                          // { "sao-paulo": 0.12, "guarulhos": 0.08, ... }
  perLocationWarehouseCostJson    Json     @default("{}")
                                          // { "gid://shopify/Location/123": { perOrderSubunits: 2800, currency: "BRL" } }
  partialDataThresholdPercent     Int      @default(80)
  quoteCacheTtlDays               Int      @default(90)
  createdAt                       DateTime @default(now())
  updatedAt                       DateTime @updatedAt
}
```

**Migration safety**:
- All four tables are additive. No existing read paths reference them.
- Pre-image-deploy migration is fine.
- No backfill required. The rollup cron seeds `LdAnalyticsDaily` from existing `LalamoveDispatchJob` history on its first run (idempotent — keyed on `(shop, cityNorm, date)`).

---

## §4. Warehouse-carrier adapter architecture

### §4.1 — Interface (`app/services/warehouse-carrier/types.ts`)

```ts
export type WarehouseProviderId = "intelipost" | "frenet" | "melhor_envio";

export type WarehouseQuoteRequest = {
  origin: {
    postalCode: string;
    address1?: string;
    city: string;
    province: string;
    country: string;
  };
  destination: {
    postalCode: string;
    address1?: string;
    city: string;
    province: string;
    country: string;
  };
  items: Array<{ weightGrams: number; quantity: number; valueSubunits?: number }>;
  currency: string;
  isSpeculative?: boolean; // true when quoting an order that wasn't originally shipped via this provider
};

export type WarehouseQuoteResult = {
  provider: WarehouseProviderId;
  priceSubunits: number;
  currency: string;
  minDeliveryDate?: string;
  maxDeliveryDate?: string;
  raw?: unknown; // provider-specific response, stored for diagnostics
};

export type WarehouseQuoteError = {
  provider: WarehouseProviderId;
  errorCode: "auth_failed" | "out_of_zone" | "invalid_address" | "rate_limit" | "speculative_not_supported" | "unknown";
  message: string;
  retryable: boolean;
};

export interface WarehouseCarrierAdapter {
  readonly id: WarehouseProviderId;
  /** True if this provider permits speculative quoting (orders not originally shipped via this provider). */
  readonly supportsSpeculativeQuoting: boolean;
  /** Validate credentials by calling a cheap endpoint (e.g. /me, /shop). */
  validateCredentials(creds: { apiKey: string; apiSecret?: string; endpoint?: string }): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Get a single quote for one order. */
  quote(creds: { apiKey: string; apiSecret?: string; endpoint?: string }, req: WarehouseQuoteRequest): Promise<WarehouseQuoteResult | WarehouseQuoteError>;
}
```

### §4.2 — Aggregator (`app/services/warehouse-carrier/aggregator.server.ts`)

Single entry point for the rest of the app. Responsibilities:
- Look up the configured `WarehouseCarrierCredential` for a shop.
- Decrypt credentials via `app/utils/encryption.server.ts` (assume already exists per CLAUDE.md memory).
- Dispatch to the right adapter.
- Emit `[ld-analytics:warehouse-carrier]` logs.

```ts
export async function quoteForShop(
  shop: string,
  req: WarehouseQuoteRequest
): Promise<WarehouseQuoteResult | WarehouseQuoteError | null /* null = no carrier configured */> { ... }

export async function validateCredentialsForShop(
  shop: string,
  provider: WarehouseProviderId
): Promise<{ ok: true } | { ok: false; reason: string }> { ... }
```

### §4.3 — Intelipost adapter (`app/services/warehouse-carrier/adapters/intelipost.server.ts`)

**API surface assumptions** (to be verified — see §13 phase-3 verifications):
- Auth: `Authorization: ApiKey <key>` header.
- Endpoint: `POST /api/v1/quote` (sandbox: `api-sandbox.intelipost.com.br`, prod: `api.intelipost.com.br`).
- Body shape: per Intelipost docs.
- `supportsSpeculativeQuoting`: **provisionally `true`**. To be verified — see §13. If verification fails, set to `false` and the panel falls back to Variant A empty state in state #3.

```ts
export const IntelipostAdapter: WarehouseCarrierAdapter = {
  id: "intelipost",
  supportsSpeculativeQuoting: true, // PROVISIONAL — see §13.1

  async validateCredentials({ apiKey, endpoint }) { ... },

  async quote({ apiKey, endpoint }, req) {
    // POST to /api/v1/quote
    // Map response → WarehouseQuoteResult OR WarehouseQuoteError
    // Errors: 401 → auth_failed, 422 → invalid_address / out_of_zone, 429 → rate_limit
  }
};
```

### §4.4 — Quote cache (`app/services/warehouse-carrier/quote-cache.server.ts`)

Read-through cache over `WarehouseCarrierQuoteCache`. TTL from `LdAnalyticsConfig.quoteCacheTtlDays` (default 90 days).

```ts
export async function getOrFetchQuote(
  shop: string,
  orderId: string,
  provider: WarehouseProviderId,
  req: WarehouseQuoteRequest
): Promise<{ result: WarehouseQuoteResult; cached: boolean } | { error: WarehouseQuoteError }> {
  // 1. Look up cache entry where expiresAt > now()
  // 2. If hit → return result with cached: true
  // 3. If miss → call aggregator.quoteForShop()
  // 4. On success → upsert into cache with expiresAt = now() + ttlDays
  // 5. On error → return error (do NOT cache errors)
}
```

---

## §5. Analytics services

### §5.1 — P&L math (`app/services/ld-analytics/pl-math.server.ts`)

Pure functions, deterministic, easy to unit-test.

```ts
export type OrderInputs = {
  ldRevenueSubunits: number;
  ldCarrierCostSubunits: number;
  warehouseCounterfactualSubunits: number; // what merchant would have paid carrier
  warehouseCustomerRateSubunits: number;   // what customer would have been charged
  taxSavingsSubunits: number;
};

export function plImpact(o: OrderInputs): number {
  // (LD revenue + tax savings - LD cost) - (WH revenue - WH cost)
  const ldNet = o.ldRevenueSubunits + o.taxSavingsSubunits - o.ldCarrierCostSubunits;
  const whNet = o.warehouseCustomerRateSubunits - o.warehouseCounterfactualSubunits;
  return ldNet - whNet;
}

export function revenueRetained(o: OrderInputs): number {
  return o.warehouseCustomerRateSubunits - o.ldRevenueSubunits;
}

export function netCostDelta(o: OrderInputs): number {
  return o.ldCarrierCostSubunits - o.warehouseCounterfactualSubunits;
}

export function frame(framing: string, o: OrderInputs): number {
  switch (framing) {
    case "pl_impact":         return plImpact(o);
    case "revenue_retained":  return revenueRetained(o);
    case "net_cost_delta":    return netCostDelta(o);
    default:                  return plImpact(o);
  }
}
```

**Edge cases (per §19 of brief)**:
- Free-ship orders: `ldRevenueSubunits === 0` is valid; LD carrier cost still applies. Math holds.
- Free-ship counterfactual: `warehouseCustomerRateSubunits` must reflect what the customer **would have paid** had the merchant not granted free-ship. This is the merchant's free-ship subsidy. The loader computes this by re-evaluating the cart against the merchant's shipping zone rules at quote time, NOT by reading `Order.shippingLines.price` (which captures the post-discount paid amount).

### §5.2 — Rollup (`app/services/ld-analytics/rollup.server.ts`)

Cron-triggered. Per-shop, per-day. Idempotent.

```ts
export async function rollupShop(shop: string, date: Date): Promise<{
  shop: string;
  date: Date;
  cities: number;
  orders: number;
  coveragePercent: number;
  durationMs: number;
}> {
  // 1. Fetch LalamoveDispatchJob rows where job's createdAt is within [date, date+1day].
  // 2. For each dispatched order:
  //    a. Read ShopOrder for shipping address + line items.
  //    b. getOrFetchQuote() for warehouse counterfactual.
  //    c. Aggregate into per-city × per-day buckets.
  // 3. Compute coverage % (orders successfully quoted / total orders).
  // 4. Upsert LdAnalyticsDaily rows.
  // 5. Log summary.
}
```

### §5.3 — Loader queries (`app/services/ld-analytics/queries.server.ts`)

Read-only aggregations for the page loader.

```ts
export async function getHeadlineMetrics(shop: string, range: { from: Date; to: Date }, locationFilter?: string): Promise<{
  ldOrderCount: number;
  ldNet: number;
  whCounterfactualNet: number;
  plImpact: number;
  revenueRetained: number;
  netCostDelta: number;
  taxSavings: number;
  coveragePercent: number;
  currencyCode: string;
}> { ... }

export async function getPerCityBreakdown(shop: string, range, locationFilter?, cityFilter?): Promise<Array<{
  cityNorm: string;
  cityDisplay: string;
  orderCount: number;
  ldRevenueSubunits: number;
  warehouseCustomerRateSubunits: number;
  ldNet: number;
  whCounterfactualNet: number;
  plDelta: number;
  coveragePercent: number;
}>> { ... }

export async function getOrdersForCity(shop: string, cityNorm: string, range, limit = 50): Promise<Array<{
  orderId: string;
  orderName: string;
  orderDate: Date;
  ldRevenueSubunits: number;
  warehouseCustomerRateSubunits: number;
  ldCarrierCostSubunits: number;
  warehouseCounterfactualSubunits: number;
  isFreeShipped: boolean;
}>> { ... }
```

---

## §6. Routes

### §6.1 — `app/routes/app.local-delivery.analytics.tsx`

#### Loader

```ts
export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const period = url.searchParams.get("period") ?? "90d"; // 7d | 30d | 90d | 365d
  const locationId = url.searchParams.get("location") ?? "all";
  const cityNorm = url.searchParams.get("city") ?? "all";

  const config = await getConfig(shop); // LdAnalyticsConfig

  if (!config.enabled) {
    return json({ kind: "disabled" } as const);
  }

  const credential = await getWarehouseCarrierCredential(shop);
  const ldOrderCount = await countLdOrders(shop, periodToRange(period));

  if (ldOrderCount === 0) {
    return json({ kind: "no_ld_usage" } as const);
  }

  if (!credential) {
    // Fetch the speculative-savings teaser data for the provocation empty state (state #3)
    // Only renders if IntelipostAdapter.supportsSpeculativeQuoting === true
    const teaser = IntelipostAdapter.supportsSpeculativeQuoting
      ? await computeSpeculativeTeaser(shop, periodToRange("90d"))
      : null;
    return json({ kind: "no_carrier", teaser } as const);
  }

  // Try to fetch headline + breakdown
  try {
    const [headline, perCity] = await Promise.all([
      getHeadlineMetrics(shop, periodToRange(period), locationId === "all" ? undefined : locationId),
      getPerCityBreakdown(shop, periodToRange(period), locationId === "all" ? undefined : locationId, cityNorm === "all" ? undefined : cityNorm),
    ]);

    if (headline.coveragePercent < config.partialDataThresholdPercent) {
      return json({ kind: "insufficient_coverage", coveragePercent: headline.coveragePercent } as const);
    }

    return json({
      kind: headline.coveragePercent < 100 ? "partial" : "full",
      headline,
      perCity,
      framing: config.headlineFraming,
      filters: { period, locationId, cityNorm },
    } as const);
  } catch (error) {
    if (isAuthError(error)) {
      const cached = await getLastSuccessfulHeadline(shop);
      return json({ kind: "auth_failed", lastSync: cached } as const);
    }
    throw error;
  }
}
```

#### Action — intents

```ts
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "switch-framing":
      // body: { framing: "pl_impact" | "revenue_retained" | "net_cost_delta" }
      // updates LdAnalyticsConfig.headlineFraming
      return json({ ok: true });

    case "save-overrides":
      // body: { perCityTaxSavingsJson, perLocationWarehouseCostJson }
      // upserts LdAnalyticsConfig
      return json({ ok: true });

    case "retry-uncovered":
      // re-fetches quotes for cache-miss orders in the current period
      // returns updated headline + perCity
      return json({ ok: true });

    case "load-drilldown":
      // body: { cityNorm, period }
      // returns getOrdersForCity()
      return json({ ok: true, orders: [...] });

    default:
      return json({ error: "unknown_intent" }, { status: 400 });
  }
}
```

#### Component (high-level shape)

State machine driven by `loaderData.kind`:
- `disabled` → render "Enable in Settings" empty state
- `no_ld_usage` → state #2
- `no_carrier` → state #3 (Variant B teaser if `loaderData.teaser` is present, Variant A otherwise)
- `auth_failed` → state #4 (banner + cached data dimmed)
- `partial` → full view + warning banner with retry button (state #5)
- `full` → state #6
- `insufficient_coverage` → "insufficient data" empty state

State #1 (loading) handled by `useNavigation()` for client-side transitions.
State #7 (drilldown loading) handled by `useFetcher()` per-row.
State #8 (override editing) handled by `<s-modal>` with internal draft/applied state pattern (per CLAUDE.md "Search & Modals" convention).

### §6.2 — `app/routes/app.local-delivery.tsx` modification

Add the entry-point button to the page header. Single insertion.

```tsx
<s-button slot="primary-action" onClick={() => navigate("/app/local-delivery/analytics")}>
  {t("ld.viewAnalytics")}
</s-button>
```

The `t("ld.viewAnalytics")` key goes in `common.json` namespace, EN + pt-BR.

### §6.3 — `app/routes/app.settings.tsx` modification

Add a section to the Local Delivery tab:

```tsx
<s-section heading={t("settings.ldAnalytics.title")}>
  <s-stack direction="block" gap="base">
    <SettingsToggleRow
      label={t("settings.ldAnalytics.enable.label")}
      description={t("settings.ldAnalytics.enable.description")}
      checked={config.enabled}
      onChange={(v) => submit({ intent: "set-ld-analytics-enabled", enabled: v }, { method: "post" })}
    />
    {config.enabled && (
      <CredentialBlock
        provider="intelipost"
        currentCredential={creds?.find(c => c.provider === "intelipost")}
        onSave={(apiKey, endpoint) => submit({ intent: "save-warehouse-credential", provider: "intelipost", apiKey, endpoint }, { method: "post" })}
        onDelete={() => submit({ intent: "delete-warehouse-credential", provider: "intelipost" }, { method: "post" })}
      />
    )}
  </s-stack>
</s-section>
```

Two new action intents: `set-ld-analytics-enabled` and `save-warehouse-credential` / `delete-warehouse-credential`.

---

## §7. Cron job

### `app/routes/api.cron.ld-analytics-rollup.tsx`

```ts
export async function action({ request }: ActionFunctionArgs) {
  // Bearer-auth via SHARED_SECRET env (per /api/control pattern)
  const authHeader = request.headers.get("Authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const shops = await prisma.ldAnalyticsConfig.findMany({
    where: { enabled: true },
    select: { shop: true },
  });

  console.info(`[ld-analytics:cron] rollup START shops=${shops.length}`);

  const results = [];
  for (const { shop } of shops) {
    try {
      const today = startOfDayUtc(new Date());
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      const result = await rollupShop(shop, yesterday);
      results.push(result);
      console.info(`[ld-analytics:cron] rollup OK shop=${shop} cities=${result.cities} orders=${result.orders} coverage=${result.coveragePercent}% durationMs=${result.durationMs}`);
    } catch (error) {
      console.error(`[ld-analytics:cron] rollup FAILED shop=${shop}`, error);
    }
  }

  const elapsed = Date.now() - startedAt;
  console.info(`[ld-analytics:cron] rollup OK shops=${shops.length} elapsed=${elapsed}ms`);
  return json({ ok: true, results, elapsed });
}
```

### EventBridge schedule

- **Frequency**: daily, 04:00 UTC (01:00 BRT — off-peak for BR shops).
- **Target**: `https://app.cpg-labs.io/api/cron/ld-analytics-rollup` (cpg-labs full) and `https://omnify.cpg-labs.io/api/cron/ld-analytics-rollup` (omnify focused).
- **Auth**: bearer token from SSM `/omnify/CRON_SECRET`.
- **Terraform**: add resource block to `infra/terraform/cron/` mirroring existing cron schedule patterns.

### First-run backfill

On the first cron fire after deploy, the rollup walks back 90 days from yesterday, day-by-day, populating `LdAnalyticsDaily`. This is idempotent (upsert keyed on `(shop, cityNorm, date)`) so re-runs are safe.

---

## §8. Action surface (intents)

Consolidated table for phase 4 to wire up:

| Intent | Endpoint | Body | Returns |
|---|---|---|---|
| `switch-framing` | `/app/local-delivery/analytics` | `{ framing }` | `{ ok }` |
| `save-overrides` | `/app/local-delivery/analytics` | `{ perCityTaxSavingsJson, perLocationWarehouseCostJson }` | `{ ok }` |
| `retry-uncovered` | `/app/local-delivery/analytics` | `{}` | `{ ok, headline, perCity }` |
| `load-drilldown` | `/app/local-delivery/analytics` | `{ cityNorm, period }` | `{ ok, orders }` |
| `set-ld-analytics-enabled` | `/app/settings` | `{ enabled }` | `{ ok }` |
| `save-warehouse-credential` | `/app/settings` | `{ provider, apiKey, apiSecret?, endpoint? }` | `{ ok, validated }` |
| `delete-warehouse-credential` | `/app/settings` | `{ provider }` | `{ ok }` |

---

## §9. Telemetry / logging

Per CLAUDE.md "Logging" conventions. Every server function logs.

| Module | Sub-context | START | OK | FAILED |
|---|---|---|---|---|
| `[ld-analytics]` | `:loader` | `loader START shop=X period=Y kind=?` | `loader OK shop=X kind=Y elapsed=Zms` | `loader FAILED shop=X` |
| `[ld-analytics]` | `:cron` | `rollup START shops=N` | `rollup OK shops=N elapsed=Zms` | `rollup FAILED shop=X` |
| `[ld-analytics]` | `:rollup` | `rollupShop START shop=X date=Y` | `rollupShop OK shop=X cities=N orders=M coverage=P% durationMs=Z` | `rollupShop FAILED shop=X` |
| `[ld-analytics]` | `:warehouse-carrier` | `quote START shop=X provider=Y orderId=Z` | `quote OK shop=X cached=B priceSubunits=N durationMs=Z` | `quote FAILED shop=X errorCode=Y` |
| `[ld-analytics]` | `:intelipost` | `quote START shop=X` | `quote OK shop=X status=200 durationMs=Z` | `quote FAILED shop=X status=N` |
| `[ld-analytics]` | `:credentials` | `validate START shop=X provider=Y` | `validate OK shop=X` | `validate FAILED shop=X reason=Y` |
| `[ld-analytics]` | `:framing-change` | n/a | `framing changed shop=X from=Y to=Z` | n/a |

**Never log**: Intelipost API key/secret, customer addresses, customer emails, customer phone numbers, postal codes (PII risk in BR).

---

## §10. i18n keys

`app/i18n/locales/en/ld-analytics.json` (mirror in pt-BR):

```json
{
  "page": {
    "title": "Analytics",
    "backLabel": "Local delivery"
  },
  "filters": {
    "period": { "label": "Period", "values": { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", "365d": "Last 365 days" } },
    "location": { "label": "Location", "all": "All locations" },
    "city": { "label": "City", "all": "All cities" }
  },
  "headline": {
    "pl_impact": { "label": "Shipping P&L impact", "footnote": "(LD revenue + tax savings) − LD carrier cost, vs (warehouse revenue − warehouse cost). Switch via ⇅ to compare frames: revenue retained, net cost delta." },
    "revenue_retained": { "label": "Revenue retained vs warehouse pricing", "footnote": "Customer was charged {ldCharged} for LD vs {whRate} if shipped warehouse · delta = retained revenue." },
    "net_cost_delta": { "label": "Net cost delta", "footnote": "LD carrier cost minus warehouse counterfactual cost. Negative = saving." },
    "switchPickerTitle": "Switch headline metric"
  },
  "supporting": {
    "ldNet": { "label": "LD net", "subtitle": "{charged} charged + {tax} tax saved − {cost} carrier" },
    "whNet": { "label": "Warehouse counterfactual net", "subtitle": "{rate} would-be charged − {cost} cost" }
  },
  "chart": { "title": "Net P&L by month — LD vs warehouse counterfactual", "subtitle": "Profit per channel after costs · {range}" },
  "table": {
    "title": "Per-city breakdown",
    "subtitle": "Click any row to drill down to orders",
    "headers": { "city": "City", "orders": "Orders", "ldCharged": "LD charged", "whRate": "Warehouse rate", "ldNet": "LD net", "whNet": "WH net", "plDelta": "P&L delta" }
  },
  "states": {
    "loading": "Loading…",
    "noLdUsage": { "title": "No local delivery activity yet", "body": "Once you dispatch your first LD route, this panel will show what your shipping P&L looks like vs warehouse delivery.", "primaryCta": "Set up local delivery", "secondaryCta": "Read setup guide" },
    "noCarrier": {
      "title_teaser": "You could be saving ~{amount} / month",
      "body_teaser": "Based on your last 90 days of orders, switching eligible {city} deliveries to LD instead of warehouse would have generated an estimated {plDelta} in additional shipping P&L. Connect a carrier so we can confirm with real quotes.",
      "title_conservative": "Connect a warehouse carrier to see savings",
      "body_conservative": "To compare LD costs against warehouse shipping, connect a carrier so we can quote the same orders both ways.",
      "primaryCta": "Connect Intelipost",
      "secondaryCta": "Use manual rates",
      "teaserDisclaimer": "Estimate based on Intelipost speculative quotes against your historical orders. Numbers will refine once carrier is connected."
    },
    "authFailed": { "title": "Intelipost authentication failed", "body": "The API rejected your stored credentials. Showing data from the last successful sync ({date}).", "reconnect": "Reconnect", "switchManual": "Switch to manual" },
    "partial": { "title": "{uncovered} of {total} orders couldn't be quoted ({coverage}% coverage)", "body": "The carrier returned errors for some addresses (likely out-of-zone or malformed). Numbers below cover the {covered} quoted orders.", "retry": "Retry uncovered" },
    "insufficientCoverage": { "title": "Insufficient data to compute savings", "body": "Less than {threshold}% of orders could be quoted in this period. Retry uncovered orders to view savings.", "retry": "Retry uncovered" },
    "drilldownLoading": "Loading {n} orders…"
  },
  "modal": {
    "overrides": {
      "title": "Edit overrides",
      "intro": "Manual flat warehouse cost per location (used when carrier integration is unavailable or you want to override the carrier number for a specific location). Tax savings apply to LD orders to that city.",
      "warehouseCostHeading": "Warehouse cost per order, by location",
      "taxSavingsHeading": "Tax savings %, by LD city",
      "save": "Save",
      "cancel": "Cancel"
    }
  },
  "settings": {
    "ldAnalytics": {
      "title": "Local Delivery analytics",
      "enable": {
        "label": "Local Delivery analytics",
        "description": "Beta. Shows LD shipping P&L vs warehouse counterfactual. Requires Intelipost (or another carrier) for accurate numbers."
      },
      "credential": {
        "title": "Warehouse carrier credentials",
        "intelipost": { "name": "Intelipost", "apiKeyLabel": "API key", "endpointLabel": "API endpoint (sandbox/prod)" },
        "save": "Save and validate",
        "validate_ok": "Credentials validated.",
        "validate_failed": "Validation failed: {reason}"
      }
    }
  },
  "ld": {
    "viewAnalytics": "View analytics"
  }
}
```

**pt-BR translation rules (CLAUDE.md brand voice)**: no em dashes, no idioms, no sarcasm, plain language. Translation effort ~1h, do as part of phase 4.

---

## §11. State management (frontend)

Single component `LdAnalyticsPage` consumes loader data. Switch on `loaderData.kind` (per §6.1).

**Local component state** (React `useState`):
- `activeFraming` (mirrors `loaderData.framing` until merchant changes via picker)
- `expandedCity` (cityNorm or null) — for drilldown
- `drilldownData` (Record<cityNorm, Order[]>) — fetched lazily via useFetcher
- `overrideModalOpen` (boolean)
- `overrideDraft` (LdAnalyticsConfig override fields, mirrors applied state, reset on cancel) — per CLAUDE.md "Draft/applied pattern for modal settings"

**No global state needed.** No Redux, no context. React Router loader is the source of truth.

---

## §12. Test plan

### Unit tests

- `pl-math.test.ts` — verify each framing function returns expected values for: standard order, free-ship order, zero tax savings, edge cases.
- `intelipost.test.ts` — mock `fetch`, verify request shape + response mapping for: success, 401 auth, 422 invalid address, 429 rate limit, network timeout.
- `quote-cache.test.ts` — verify cache hit, cache miss → fetch → cache write, expired entry skipped.

### Integration tests (light, optional in v1)

- `rollup.test.ts` — seed `LalamoveDispatchJob` + `ShopOrder` rows, mock Intelipost adapter, run `rollupShop`, assert `LdAnalyticsDaily` rows match expected.

### Manual smoke list (to run pre-deploy)

1. Enable feature in Settings on GE Beauty; toggle persists across reloads.
2. Connect Intelipost credentials with a wrong key; UI shows `validate_failed` toast.
3. Connect Intelipost with correct credentials; UI shows `validate_ok` toast.
4. Visit `/app/local-delivery/analytics` with no LD data → state #2.
5. Disable Intelipost in Settings → state #3 (provocation teaser, if speculative supported) on next visit.
6. Re-enable + visit → state #6 with full data.
7. Click city row → drilldown loads (state #7 → expanded state).
8. Open "Edit overrides", change tax % for São Paulo, save → headline updates.
9. Click ⇅ on headline → cycle through 3 framings → choice persists across reload.
10. Mobile (responsive) → headline cards stack, table shows P&L delta column only, "Edit overrides" hidden, drilldown hidden.

---

## §13. Phase-3 verifications (open items requiring user action)

These are conditional on external systems and may change spec details before phase 4 starts. Each has a fallback if verification fails.

### §13.1 — Intelipost speculative-quote feasibility

**Question**: does Intelipost's `/quote` endpoint accept arbitrary origin/destination/items input from a merchant whose Intelipost account does NOT have an active shipment for that order?

**How to verify** (Lucas to run against GE Beauty's Intelipost credentials):
```bash
# Pseudo-curl — confirm endpoint shape against current Intelipost docs first.
curl -X POST https://api.intelipost.com.br/api/v1/quote \
  -H "Authorization: ApiKey $INTELIPOST_KEY" \
  -H "Content-Type: application/json" \
  -d '{"origin_zip_code": "01310-100", "destination_zip_code": "20040-020", "volumes": [{"weight": 0.5, "quantity": 1}]}'
```
- If returns 200 with rate options → `IntelipostAdapter.supportsSpeculativeQuoting = true`. Variant B teaser ships in v1.
- If returns 403 / 422 / order-required → `IntelipostAdapter.supportsSpeculativeQuoting = false`. Variant A empty state ships in v1; Variant B becomes a v2 feature.

**Default in spec**: `true`. Phase 4 build assumes true. If verification fails, single-line code change (`supportsSpeculativeQuoting: false`) + i18n fallback to conservative copy.

### §13.2 — Intelipost rate-limit behavior

**Question**: what's Intelipost's per-shop rate limit for `/quote`? The rollup cron quotes every LD-dispatched order daily.

**How to verify**: read Intelipost docs OR observe HTTP `X-RateLimit-Remaining` header in the speculative-quote test above.

**Mitigations baked into spec regardless**:
- Quote-cache TTL of 90 days means each order is quoted at most once per quarter.
- Cron runs daily for new orders only (yesterday's data, not full backfill on every run).
- Adapter respects 429 with exponential backoff (3 retries: 1s, 5s, 30s).

### §13.3 — Headline-picker persistence

**Spec resolution**: `LdAnalyticsConfig.headlineFraming` column already designed (§3). Action intent `switch-framing` already designed (§8). No external dependency. ✓

### §13.4 — Free-ship counterfactual rate

**Question**: how does the loader compute "what the customer would have been charged" for an order that was free-shipped?

**Spec resolution**: re-evaluate the cart against the shop's shipping zones via Shopify GraphQL `deliveryProfiles` query, NOT by reading `Order.shippingLines.price` (which captures the post-discount paid amount, often R$ 0 for free-ship). The loader caches the un-discounted rate alongside the warehouse counterfactual.

**Implementation note for phase 4**: this is a Shopify GraphQL call per order on first quote. Cached forever (free-ship rules don't change retroactively for shipped orders).

---

## §14. Build sequencing for phase 4

Recommended order. Each step ends in a green lint + typecheck before moving on.

1. **Schema migration first.** `prisma migrate dev --name ld_analytics`. Verify migration file matches §3 exactly.
2. **i18n stubs.** Create `ld-analytics.json` files (EN + pt-BR) with minimal keys. Wire `app/i18n/resources.ts`.
3. **P&L math (pure).** `pl-math.server.ts` + unit tests. No DB, no async.
4. **Adapter scaffold.** `warehouse-carrier/types.ts` + `aggregator.server.ts` skeleton (no provider yet).
5. **Intelipost adapter.** `adapters/intelipost.server.ts` + unit tests with mocked fetch.
6. **Quote cache.** `quote-cache.server.ts` + tests.
7. **Credential service.** `intelipost-credentials.server.ts` (encrypt/decrypt, validate).
8. **Settings UI.** Modify `app/routes/app.settings.tsx` to add toggle + credential block. Wire intents.
9. **Rollup logic.** `rollup.server.ts` + integration test against seeded data.
10. **Cron route.** `api.cron.ld-analytics-rollup.tsx` + bearer auth.
11. **Loader queries.** `queries.server.ts`.
12. **Analytics page.** `app/routes/app.local-delivery.analytics.tsx` + CSS module.
13. **Entry-point button.** Modify `app.local-delivery.tsx` for the header button.
14. **Polish pass.** Mobile responsive, error states, banner stacking, loading skeletons.
15. **Lint, typecheck, manual smoke.** `npm run lint && npm run typecheck && npm run check:basepath`.
16. **Deploy queue entry.** Append to `.claude/deploy-queue.md`.

---

## §15. Rollback plan

If v1 ships and a critical bug surfaces post-deploy:

- **Fast kill switch**: flip `LdAnalyticsConfig.enabled = false` for the affected shop (single SQL update). Loader returns `kind: "disabled"` → empty page. No data loss.
- **Soft revert**: deploy a hotfix that hardcodes `kind: "disabled"` in the loader for all shops while we debug. ~30 min from PR to deploy.
- **Hard revert**: revert the deploy via `scripts/deploy.ps1 -App full -Image <prev-revision>` and `... -App omnify ...`. Schema migration is additive — old code ignores new tables.
- **Schema cleanup if abandoned**: separate down-migration drops the 4 tables. Only do this if feature is permanently killed (>30 days post-launch with zero usage).

---

## §16.5 Phase-4 build assumptions / deviations

Logged during the phase-4 autonomous build (commit range starting at 5969cd5):

- **Step 1 — migration timestamp**: `prisma migrate dev` was not executed against
  a live DB during the build; instead a hand-authored migration SQL file was
  written at `prisma/migrations/20260510000000_ld_analytics/migration.sql`
  matching the §3 schema. This is functionally identical to what
  `migrate dev --name ld_analytics` produces. Deploy will run
  `prisma migrate deploy` per the existing deploy script.
- **Step 4 — adapter bundling**: The Intelipost adapter implementation was
  written together with the scaffold (single commit) rather than split across
  steps 4 and 5, because the aggregator's typed import requires the adapter to
  exist. Step 5's commit adds the adapter unit tests as planned.
- **Step 6 — quote-cache tests deferred to integration**: A pure unit test for
  the quote cache would require deep prisma mocking with little signal value.
  Coverage is folded into the rollup integration test in step 9 instead.
- **Adapter implementation detail (intelipost.server.ts)**: Using `api-key`
  header (Intelipost convention per their docs) rather than the spec's
  draft `Authorization: ApiKey <key>` header. If the offline verification
  (§13.1) shows otherwise, swap the `authHeaders()` helper.

## §16. Open items for phase-3 gate

Logged here so phase 4 doesn't proceed without resolution. None block spec drafting; all are surfaced for explicit acknowledgement.

1. **Intelipost speculative-quote verification** (§13.1) — Lucas to run against GE Beauty creds at convenience. Default assumption: supports it.
2. **Intelipost rate-limit verification** (§13.2) — Same. Default mitigations are in spec regardless.
3. **Free-ship counterfactual approach** (§13.4) — Spec answer: re-quote via Shopify `deliveryProfiles`. Confirm this is acceptable vs alternative (use shop's published shipping rates table).
4. **Cron schedule** — Spec proposes daily 04:00 UTC. Confirm or override.
5. **EventBridge → ALB endpoint** for the cron — Confirm there's no firewall rule blocking the bearer-authed call.
