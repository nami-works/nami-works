# Implementation Spec — LD Analytics Aside Block

| Field | Value |
|---|---|
| **Feature slug** | `local-delivery-analytics-aside` |
| **Status** | Phase 3 — awaiting approval |
| **Branch** | `feat/local-delivery-analytics-aside` |
| **References** | Mockup: [`inputs/mockups/local-delivery-analytics-aside-v1.html`](../../inputs/mockups/local-delivery-analytics-aside-v1.html) · Parent feature brief: [`inputs/briefs/local-delivery-analytics.md`](../../inputs/briefs/local-delivery-analytics.md) · Parent feature spec: [`docs/plans/local-delivery-analytics.md`](./local-delivery-analytics.md) |
| **Created** | 2026-05-10 |
| **Skipped phases** | Phase 1 brief skipped — small scope, mockup carries enough context |

This spec extends the already-shipped LD Analytics v1 feature with a sidebar surface on the LD operational page. Replaces the standalone "View analytics" header button (added in commit `48e15db`) with a richer inline aside block.

---

## §1. Goal & scope

**Goal:** make the analytics value obvious from the LD operational page. Today the merchant has to click a header button and switch context. The aside surfaces the headline number + trend inline, so the merchant sees the cost-savings outcome of their LD activity while looking at the operational state.

**v1 scope:**
- New sidebar card on `/app/local-delivery` (between `Auto-assign accuracy` and the bottom of the aside).
- 7 states (per mockup state matrix).
- Replaces the existing "View analytics" `slot="primary-action"` header button.
- Mobile: renders above main content via `order: -1` per CLAUDE.md mobile layout rules.

**Out of scope:**
- Per-city / per-route breakdown inside the aside — that's what the full panel does.
- Picker on the aside to switch framing — picker stays on the analytics panel only.
- Drilldowns from the aside — See-more navigates to the full panel.

---

## §2. File-by-file diff plan

### New files

| Path | Purpose | LOC est |
|---|---|---|
| `app/services/ld-analytics/aside.server.ts` | Loader-side function to compute the aside's data (savings + sparkline + delta) | ~120 |
| `app/components/ld-analytics-aside.tsx` | The React component rendering the 7 states | ~250 |
| `app/components/ld-analytics-aside.module.css` | Scoped CSS module mirroring mockup tokens | ~150 |
| `app/services/ld-analytics/__tests__/aside.test.ts` | Unit tests for the aside compute fn | ~80 |

### Modified files

| Path | Change | LOC est |
|---|---|---|
| `app/routes/app.local-delivery.tsx` | Remove `slot="primary-action"` View-analytics button; render `<LdAnalyticsAside>` in the aside slot | −12 / +20 |
| `app/i18n/locales/en/ld-analytics.json` | Add `aside.*` keys (headline label, MoM trend, See-more, provocation copy, stale footnote) | +30 |
| `app/i18n/locales/pt-BR/ld-analytics.json` | Same in pt-BR | +30 |
| `prisma/schema.prisma` | Add `asideFirstSeenAt DateTime?` to `LdAnalyticsConfig` for "New" pill TTL | +1 |

---

## §3. Schema change

Single nullable column on the existing `LdAnalyticsConfig`:

```prisma
model LdAnalyticsConfig {
  // ... existing fields ...
  asideFirstSeenAt DateTime?  // first time the aside rendered for this shop; drives the 14-day "New" pill
}
```

Migration: additive nullable column. New file `prisma/migrations/<YYYYMMDDHHMMSS>_aside_first_seen_at/migration.sql`:

```sql
ALTER TABLE "LdAnalyticsConfig"
  ADD COLUMN "asideFirstSeenAt" TIMESTAMP(3);
```

---

## §4. Loader integration (parallel fetcher decoupling)

The LD page loader is the slow one (14-17s baseline; perf work is in flight per `inputs/backlog/local-delivery.md` "Performance / reliability"). The aside MUST NOT extend that loader's wall-clock.

**Pattern:**
1. **Main LD page loader** does NOT compute the aside data. Returns its usual payload unchanged.
2. **Aside data fetches via `useFetcher`** on client-mount, hitting a new `loader` export on a small data-only route, OR — preferred — an intent inside the existing `/app/local-delivery/analytics` action surface so we don't add another route just for this. Reuse the existing route's `getHeadlineMetrics` + a new `getSparklineWeekly` helper.
3. Component shows **loading skeleton (state #1)** while the fetcher is in flight.
4. Resolved data → state #2 / #3 / #4 / #5 based on `kind` discriminator returned.

**Concrete endpoint choice:** **`GET /app/local-delivery/analytics?aside=1`** — same loader, new `aside=1` query param triggers a small payload (no per-city breakdown, just the aside-shaped data). Avoids spinning up a new route file. Loader detects the param and short-circuits to the aside compute fn.

```ts
// In app/routes/app.local-delivery.analytics.tsx loader:
if (url.searchParams.get("aside") === "1") {
  return json(await computeAsideData(shop));
}
// ... rest of loader unchanged ...
```

```ts
// In app/components/ld-analytics-aside.tsx:
const fetcher = useFetcher<AsideData>();
useEffect(() => {
  if (fetcher.state === "idle" && !fetcher.data) {
    fetcher.load("/app/local-delivery/analytics?aside=1");
  }
}, []);
```

---

## §5. Aside compute function

`app/services/ld-analytics/aside.server.ts`:

```ts
export type AsideData =
  | { kind: "hidden" }            // analytics opt-in off
  | { kind: "provocation"; estimatedMonthlySavings: number; currency: string }
  | { kind: "conservative_empty" }
  | { kind: "stale"; ...full kind fields }
  | { kind: "full"; total: number; momPercent: number; sparkline: WeeklyPoint[]; currency: string; framing: Framing; isNew: boolean };

export type WeeklyPoint = { week: string /* ISO week start */; valueSubunits: number };

export async function computeAsideData(shop: string): Promise<AsideData> {
  const config = await prisma.ldAnalyticsConfig.findUnique({ where: { shop } });
  if (!config?.enabled) return { kind: "hidden" };

  const credential = await getWarehouseCarrierCredential(shop);
  const hasRollupData = await hasAnyLdAnalyticsDaily(shop);

  if (!hasRollupData) {
    if (!credential) {
      // Try speculative-quote teaser; fall back to conservative
      if (IntelipostAdapter.supportsSpeculativeQuoting) {
        const teaser = await computeSpeculativeTeaser(shop);
        if (teaser) return { kind: "provocation", ...teaser };
      }
      return { kind: "conservative_empty" };
    }
    // Carrier configured but no rollup data yet — show conservative until first cron fires
    return { kind: "conservative_empty" };
  }

  // Full data path
  const range = last90Days();
  const headline = await getHeadlineMetrics(shop, range);
  const sparkline = await getSparklineWeekly(shop, 12 /* weeks */);
  const momPercent = computeMomPercent(shop, range);
  const lastRollup = await getLastRollupAge(shop);

  // Set "New" pill timestamp on first render
  if (!config.asideFirstSeenAt) {
    await prisma.ldAnalyticsConfig.update({
      where: { shop },
      data: { asideFirstSeenAt: new Date() },
    });
  }
  const isNew = config.asideFirstSeenAt
    ? Date.now() - config.asideFirstSeenAt.getTime() < 14 * 24 * 60 * 60 * 1000
    : true;

  const total = frame(config.headlineFraming, headlineToOrderInputs(headline));
  const currency = headline.currencyCode;

  // Stale: > 36h since last rollup → stale; > 72h → drop to conservative
  if (lastRollup > 72 * 60 * 60 * 1000) return { kind: "conservative_empty" };
  if (lastRollup > 36 * 60 * 60 * 1000) {
    return { kind: "stale", total, momPercent, sparkline, currency, framing: config.headlineFraming, isNew };
  }
  return { kind: "full", total, momPercent, sparkline, currency, framing: config.headlineFraming, isNew };
}
```

### §5.1 Sparkline data (`getSparklineWeekly`)

12 weekly buckets of `LdAnalyticsDaily`, rolled up Sunday-to-Saturday by week. Single Prisma `groupBy` + sum. Cached at the in-memory level for 1h to avoid re-running on every page paint:

```ts
const cache = new Map<string, { fetchedAt: number; data: WeeklyPoint[] }>();
const TTL_MS = 60 * 60 * 1000;

export async function getSparklineWeekly(shop: string, weeks: number): Promise<WeeklyPoint[]> {
  const hit = cache.get(shop);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit.data;

  const fromDate = startOfWeek(subWeeks(new Date(), weeks));
  const rows = await prisma.ldAnalyticsDaily.findMany({
    where: { shop, date: { gte: fromDate } },
    select: { date: true, /* framing-relevant subunit columns */ },
  });
  const grouped = groupByIsoWeek(rows);
  const data = computeFramedValuePerBucket(grouped, /* framing from config */);
  cache.set(shop, { fetchedAt: Date.now(), data });
  return data;
}
```

### §5.2 MoM trend calc

```ts
function computeMomPercent(shop: string, range: DateRange): Promise<number> {
  // Last 30 days vs prior 30 days, % delta of framed total.
  // Color the arrow per delta: > +2% green ▲, < -2% red ▼, else neutral —.
}
```

---

## §6. Component

`app/components/ld-analytics-aside.tsx`. Pure presentational; consumes fetcher data.

```tsx
export function LdAnalyticsAside() {
  const { t } = useTranslation("ld-analytics");
  const fetcher = useFetcher<AsideData>();

  useEffect(() => {
    if (fetcher.state === "idle" && !fetcher.data) {
      fetcher.load("/app/local-delivery/analytics?aside=1");
    }
  }, [fetcher]);

  if (fetcher.state === "loading" || !fetcher.data) return <Skeleton />;

  const data = fetcher.data;
  switch (data.kind) {
    case "hidden":             return null;
    case "provocation":        return <Provocation data={data} />;
    case "conservative_empty": return <ConservativeEmpty />;
    case "stale":              return <FullData data={data} stale />;
    case "full":               return <FullData data={data} />;
  }
}
```

Sub-components map 1:1 to mockup states. CSS module mirrors `inputs/mockups/local-delivery-analytics-aside-v1.html` token usage.

**Sparkline rendering:** inline SVG, no chart library. `<polyline>` + `<polygon>` (for the fill) over a `<svg viewBox="0 0 200 28" preserveAspectRatio="none">`. Polyline points generated by mapping each weekly bucket to `(x, y)` over the 12-week min/max range.

---

## §7. Modifications to `app.local-delivery.tsx`

Single insertion + single deletion.

**Delete** (commit `48e15db` introduced this):
```tsx
<s-button slot="primary-action" onClick={() => navigate("/app/local-delivery/analytics")}>
  {t("ld.viewAnalytics")}
</s-button>
```

**Insert** in the existing aside region (after the `Auto-assign accuracy` block):
```tsx
<LdAnalyticsAside />
```

Mobile rules are inherited from the existing `app/routes/app.local-delivery/styles.module.css` aside container — `order: -1` already applies to all sidebar blocks at the `≤768px` breakpoint, so the new block stacks above main with no additional CSS.

---

## §8. i18n keys (additive)

Append to `app/i18n/locales/en/ld-analytics.json` under a new `aside` key:

```json
{
  "aside": {
    "label": "Total savings",
    "labelProvocation": "Estimated opportunity",
    "labelEmpty": "Shipping savings",
    "deltaTemplate": "vs warehouse · last 90 days · {trend} {percent}% MoM",
    "trendUp": "▲",
    "trendDown": "▼",
    "trendFlat": "—",
    "sparkLabel": "90d",
    "seeMore": "See more",
    "newPill": "new",
    "provocationValueTemplate": "~{amount} / month",
    "provocationHelper": "Based on your last 90 days. Connect a carrier so we can confirm with real quotes.",
    "provocationConnect": "Connect Intelipost",
    "provocationManual": "Use manual rates",
    "conservativeBody": "Connect a warehouse carrier to see what you'd save vs warehouse delivery.",
    "staleFootnoteTemplate": "⚠ Last rollup {age} ago · {coverage}% coverage"
  }
}
```

pt-BR mirror with brand-voice rules (no em dashes, plain language, no idioms).

---

## §9. Telemetry / logging

| Module | Sub-context | Event |
|---|---|---|
| `[ld-analytics:aside]` | `:loader` | `aside load START shop=X` / `aside load OK shop=X kind=Y elapsed=Zms` / `aside load FAILED shop=X` |
| `[ld-analytics:aside]` | `:cache` | `sparkline cache hit shop=X` / `sparkline cache miss shop=X durationMs=Z` |
| `[ld-analytics:aside]` | `:newpill` | `firstSeen recorded shop=X` (when the column is set for the first time) |

No PII. No credential values. Aligned with parent feature's `[ld-analytics:*]` namespace.

---

## §10. Test plan

### Unit tests

- `aside.test.ts` — 7 unit tests, one per state. Mock `prisma`, `getWarehouseCarrierCredential`, `IntelipostAdapter`. Verify the right `kind` returns for each scenario.
- `getSparklineWeekly` cache behavior: 1h TTL respected; cache invalidated when crossed.

### Manual smoke (post-deploy)

1. Shop with analytics disabled → block doesn't render (no DOM node).
2. Shop with analytics enabled but no LD activity AND speculative-quote available → State #3 (provocation teaser).
3. Same but speculative-quote unavailable → State #4 (conservative empty).
4. Shop with rolled-up data (run cron once) → State #2 (full). Sparkline shows 12 weeks. MoM trend shows correct arrow color.
5. Disable Intelipost on a shop that previously had data → State #5 (stale) after 36h, State #4 (conservative empty) after 72h.
6. First visit after enabling → "New" pill visible. After 14 days → pill gone.
7. See-more button → navigates to `/app/local-delivery/analytics`.
8. Mobile (≤768px) → block renders above main content.
9. Header no longer shows the "View analytics" button.
10. CloudWatch: `[ld-analytics:aside:*]` lines present, no PII.

---

## §11. Build sequence

1. Schema migration (single column addition).
2. i18n key additions (EN + pt-BR).
3. Compute fn + cache (`aside.server.ts`) + unit tests.
4. Component + CSS module.
5. Wire fetcher in `app.local-delivery.tsx`; delete the header button.
6. Manual smoke test.
7. Lint + typecheck + basepath green.

Estimated wall-clock: 2-4 hours background build.

---

## §12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **LD page loader gets slower** if the fetcher accidentally blocks the main loader | Fetcher runs CLIENT-SIDE via `useFetcher().load(...)` post-mount; main loader is untouched |
| **Cache stampede** if many concurrent users hit the same shop after cache expires | In-memory cache is per-process; cron-warmed once per hour is sufficient |
| **Sparkline empty buckets** (gaps in cron runs) | Render zero-value points; do NOT skip buckets in the polyline (would distort time axis) |
| **"New" pill never expires** if `asideFirstSeenAt` write fails silently | Idempotent write inside a try/catch; failed write means pill stays one more visit, then retries |
| **Visual regression on LD page sidebar** | Mockup is the contract; CSS module mirrors tokens exactly; manual smoke step 8 catches mobile |

---

## §13. Open items for phase-3 gate

None blocking. All design decisions locked at phase-2 gate. The 7 follow-ups from the mockup are addressed inline above (§4 loader fetcher, §5.1 sparkline, §5.2 MoM, §5 disabled-state hide, §5 "New" pill, §5 stale rule, §5 framing alignment).

### Phase-4 build-time assumptions (logged 2026-05-11)

These were not pre-decided in the spec and were resolved during build. Flagging in-line:

- **Sign convention on `net_cost_delta`** (aside.server.ts `framedHeadline` + `computeAsideData`). The full analytics panel renders `net_cost_delta` as a signed number (negative = saving). The aside reads "positive = saving" across all states per the mockup ("+R$ 8,290" in state #2). On the aside we flip the sign so all framings share the same "positive = saving" convention, and flip the MoM trend too so a falling cost reads as a positive trend. Full panel keeps its own signed display.
- **Stale window source is `computedAt`**, not `date`. `LdAnalyticsDaily.computedAt` is the cron's last write timestamp; `date` is the rollup's calendar day. The "> 36h stale, > 72h drop" rule applies to "how long since the cron last wrote a row", so we sort by `computedAt`.
- **Sparkline cache key** includes `framing`. If the merchant flips headline framing in the full panel, the aside should reflect it on next render — so framing is part of the cache key (`${shop}|${framing}|${weeks}`).
- **Compute fn unit tests** cover the pure helpers (date math, MoM %, sparkline grouping); the full `computeAsideData` integration path is covered by the §10 manual smoke list. Mocking `prisma` / `getActiveCredentialForShop` / `IntelipostAdapter` was out of scope for unit-level coverage.
- **Migration approach.** Migration file is hand-authored as additive SQL (`prisma/migrations/20260511000000_aside_first_seen_at/migration.sql`) — `prisma migrate dev` was not run interactively (the prisma client was regenerated with `npx prisma generate`). Production migration will run on Lightsail boot via the existing `npm run setup` (`prisma migrate deploy`).
- **Fullscreen aside parity.** Per CLAUDE.md "collapsed & expanded forms" rule, `<LdAnalyticsAside>` is rendered in BOTH the collapsed `slot="aside"` and the fullscreen `fullscreenAsidePane` regions. The fetcher is component-scoped so each instance loads its own copy — fine for v1; a shared cache is a later optimization if it becomes painful.

---

## §14. Phase plan & gates

| Phase | Output | Gate | Estimated wall-clock |
|---|---|---|---|
| **1. Brief** | Skipped — small scope, mockup carries context | n/a | 0 |
| **2. Design** | `inputs/mockups/local-delivery-analytics-aside-v1.html` + 7-state matrix | ✅ Approved 2026-05-10 (commit `f755ae9`) | ~30 min |
| **3. Spec** | This file | User chat reply: "approved phase 3" | ~30 min |
| **4. Build** | Branch `feat/local-delivery-analytics-aside` with all commits, gates green | User reviews diff | ~2-4 hours background |
| **5. Ship** | PR + merge + deploy | User merge + deploy approval | ~30 min |
