# Data Sync Architecture

How Shopify store data flows into CPG Labs, where it lives locally, and how
to plug a new feature into the system without adding another redundant
fetcher.

## Three layers, one picture

```
                      SHOPIFY
                         │
   ┌─────────────────────┼────────────────────────────┐
   │                     │                            │
   ▼ push                ▼ pull (hourly)              ▼ pull (on demand)
WEBHOOKS            RECONCILE CRONS                LEGACY FETCHERS
(real-time,         :00  retail-goals              (progressively retired)
 sub-second)        :15  shop-ingest
                    :30  affiliates
```

**Rule of thumb for new features:** read from the local DB. Do not call
Shopify directly for store data. If the shape you need isn't there, extend
the canonical tables in `app/services/shop-ingest/` rather than adding a
feature-specific fetcher.

## Canonical tables (source of truth)

Populated by `app/services/shop-ingest/*.server.ts`. Webhooks write here
alongside feature tables; Phase 3+ features read from here directly.

| Table | Written by | Notes |
|---|---|---|
| `ShopOrder` | `webhooks.orders.tsx` + `api.cron.shop-ingest-reconcile.tsx` | All orders, all statuses. Full payload: addresses, customer JSON, refunds, line items, tags, staff member. Pkey `(shop, id)`. |
| `ShopCustomer` | `webhooks.customers.tsx` + shop-ingest cron | Full customer record with `defaultAddressJson`, `phone`, `ordersCount`, `totalSpent`. Pkey `(shop, id)`. |
| `ShopProduct` | `webhooks.products.update.tsx` + shop-ingest cron | Variants + metafields as JSON. Pkey `(shop, id)`. |
| `ShopLocation` | `app/services/shop-ingest/locations.server.ts` | Batch-refreshed on demand — no native Shopify webhook for locations. Carries `isRetailStore` (= `localPickupSettingsV2 != null`). |
| `ShopIngestMeta` | All of the above | Per-shop watermarks (`ordersLastSeenUpdatedAt`, etc.) that drive the drift-aware cron. |

## Feature tables (projections)

Every feature table below is **derived** from a canonical source. The
long-term goal is to make them views/projections of `ShopOrder`. Today most
are still populated twice: once by the webhook handler's own logic, once
(reconciliation) by the hourly feature-specific cron.

### Retail Sales Goals

| Table | What it is | Populated by |
|---|---|---|
| `SalesOrder` | POS-only orders (`sourceName != "web"` + resolvable physical location) | `webhooks.orders.tsx:143-191` + `api.cron.retail-goals-sync.tsx` via `runSalesGoalsSync` |
| `SalesOrderMonthly` | Pre-aggregated month/location revenue + discounts | `recomputeMonthly` on every webhook write, full rebuild on hourly cron |
| `SalesGoalsSyncMeta` | Dashboard "Last synced" label + phase | Cron updates it every hour at :00 |

**Why the cron exists:** even with webhooks, a dropped delivery is gone
forever unless reconciled. Cron query = `created_at:>=T-2mo -source_name:web`
(do NOT use `source_name:<numeric-app-id>` — Shopify's search API returns
0 hits for numeric source names; this was a silent bug, fixed 2026-04-18).

### Retail Footprint

| Table | Populated by |
|---|---|
| `RetailOrder` | `webhooks.orders.tsx:134-139` via `upsertRetailOrders` (requires `shipping_address.city`) |
| `RetailCustomer` | `webhooks.customers.tsx` via `upsertRetailCustomers` |
| `RetailCityMonthly`, `RetailHeatmapBucket` | Recomputed after each upsert |
| `RetailSyncMeta` | Cron placeholder (today the Retail Footprint reconcile runs on page load only) |

### Affiliates (Phase 3, shipping now)

| Table | Populated by |
|---|---|
| `AffiliateProfile` | Manual import via BixGrow CSV + UI profile editor |
| `AffiliateOrder` | `webhooks.orders.tsx` via `upsertAffiliateOrderFromWebhook` (kill-switched on `AFFILIATES_WEBHOOK_WRITE=1`) + `api.cron.affiliates-sync.tsx` via `reconcileAffiliatesIncremental` |
| `OrganicOrder` | Same paths, for non-affiliate orders |
| `AffiliateOrganicAgg` | Cron rebuilds only the months touched in the incremental run |
| `AffiliateMonthly` | Cron full-shop rebuild via `rebuildAffiliateMonthly` |
| `AffiliateSyncMeta` | Cron updates once per hour |
| `AttributionCandidate` | Webhook flagger (gated to `ge-beauty-cosmeticos.myshopify.com`): IGLU/WhatsApp orders with UGC coupons |
| `AttributionClaim` | Manual via Attribution tab + auto-confirmed by `importPedidosCsv` |
| `BixgrowAttributedOrder` | `importPedidosCsv` — denormalized set of already-attributed orders |
| `AttributionQueueSnapshot` | Cron at :30 + manual Refresh. Loader reads this for instant tab paint. |

### Campaign Goals, Merchandising, Local Delivery

Purely feature-owned tables. No canonical source beyond Shopify itself.
Inspect `prisma/schema.prisma` for details.

## Webhook fan-out order (app/routes/webhooks.orders.tsx)

For every `ORDERS_CREATE` / `ORDERS_UPDATED` event, in this order:

1. **`verifyWebhookRequest`** — HMAC check
2. **`ingestOrder`** → `ShopOrder` (canonical, shadow mode until Phase 3 readers flip)
3. **`upsertRetailOrders`** → `RetailOrder` (geo)
4. **`upsertSalesOrders` + `recomputeMonthly`** → `SalesOrder` + `SalesOrderMonthly` (retail goals)
5. **`evaluateCampaignMatches`** → `CampaignOrderMatch` (only if an active campaign covers `orderDate`)
6. **`classifyWebhookOrder` + upsert to `AffiliateOrder` OR `OrganicOrder`** (gated by `AFFILIATES_WEBHOOK_WRITE=1`)
7. **`flagAttributionCandidateFromWebhook`** → `AttributionCandidate` (gated to gebeauty + IGLU/WhatsApp source)
8. **`autoAssignOrderToRoute`** → `PendingDeliveryRoute` (fire-and-forget, only `ORDERS_CREATE`)

Each step catches its own errors so one failure doesn't block the others.

`ORDERS_DELETE` runs the inverse for every table.

## Cron schedule (EventBridge)

| Rule | Schedule | Endpoint | Purpose |
|---|---|---|---|
| `auto-delivery-cron-5min` | `rate(5 minutes)` | `/full/api/cron/auto-delivery` | Local Delivery route dispatch |
| `lalamove-watchdog-cron-5min` | `rate(5 minutes)` | `/full/api/cron/lalamove-watchdog` | Cancel stale Lalamove dispatches |
| `retail-goals-cron-hourly` | `cron(0 * * * ? *)` | `/full/api/cron/retail-goals-sync` | SalesOrder + monthly aggregate reconcile |
| `shop-ingest-cron-hourly` | `cron(15 * * * ? *)` | `/full/api/cron/shop-ingest-reconcile` | Canonical table drift check (`updated_at:>watermark`) |
| `affiliates-cron-hourly` | `cron(30 * * * ? *)` | `/full/api/cron/affiliates-sync` | AffiliateOrder/Monthly + AttributionQueueSnapshot refresh + forgotten-claims notifier |

All use `X-Cron-Secret` header auth, validated against the `CRON_SECRET` env
var (injected into both ECS task definitions from SSM `/omnify/CRON_SECRET`).

## Playbook: "I need store data in a new feature"

1. **Is the shape already in `ShopOrder` / `ShopCustomer` / `ShopProduct`?**
   - Yes → write a read query against the canonical table. You're done.
   - No → extend the canonical table (new JSON column or indexed field).
     Update `app/services/shop-ingest/*.server.ts` to populate it.
2. **Write your feature table as a projection.** Define it in
   `prisma/schema.prisma` with whatever indexes your queries need. Populate
   it via (a) a small function called from `webhooks.orders.tsx` fan-out,
   AND (b) a reconcile pass in a new cron route mirroring
   `api.cron.affiliates-sync.tsx`.
3. **Never call Shopify GraphQL from a feature read path.** The UI route
   loader should read Prisma tables only. Shopify calls belong in
   webhooks, crons, and the canonical ingest services.
4. **Add your cron to `infra/terraform/`** by copying the nearest existing
   `*-cron.tf` file. Use an offset minute (`:00`, `:15`, `:30`, `:45`) to
   spread load against the ECS task.
5. **Document your feature's tables** in this doc under the "Feature
   tables" section.

## Known bugs / gotchas

- **Shopify search `source_name:<numeric-app-id>`** silently returns 0 hits.
  Quoting doesn't help. Use `-source_name:web` and filter app-side. The
  retail-goals cron ate this for months before the 2026-04-18 fix.
- **Webhook payload lacks `numberOfOrders`/`createdAt` for every customer
  edge case.** REST gives us `orders_count` and `created_at` on the customer
  subobject, but if absent we default `wasPreExistingCustomer = false`. The
  hourly cron's GraphQL pull corrects this.
- **`AttributionCandidate` is shop-gated to gebeauty.** The source IDs
  (`206755758081`, `316281618433`) are tenant-specific app references that
  might collide in meaning for other shops. Generalize only when a second
  shop needs the same queue.
- **Location webhooks don't exist.** `ShopLocation` is refreshed manually
  and on a daily cadence (not in this doc's scope — see
  `locations.server.ts`).

## Kill switches

Env vars on the ECS task definition that toggle write paths without a code
deploy. Flip via `terraform apply -replace=aws_ecs_task_definition.gebeauty[0]`
after updating tfvars (see CLAUDE.md deployment section for the recipe).

| Env var | Values | Effect |
|---|---|---|
| `AFFILIATES_WEBHOOK_WRITE` | `"1"` to enable, anything else disables | Controls whether the orders webhook writes to `AffiliateOrder`/`OrganicOrder`/`AttributionCandidate`. Default off until shadow-mode parity is verified. |

Cron-side flags live in `infra/terraform/terraform.tfvars`:

| Flag | Default | Effect |
|---|---|---|
| `enable_delivery_cron` | `true` (prod) | Local Delivery cron pair |
| `enable_retail_goals_cron` | `true` (prod) | Retail goals hourly reconcile |
| `enable_shop_ingest_cron` | `true` (prod) | Canonical drift check |
| `enable_affiliates_cron` | `false` (flip to `true` after Phase 3 B verification) | Affiliates hourly reconcile |
