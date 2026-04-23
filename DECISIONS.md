# DECISIONS.md — Sprint 2026-04-22 / 2026-04-23

Record of the overnight autonomous sprint and the morning review session
that followed. Structured so you can find: what landed, what didn't,
what's open.

---

## Headline

**22 of 25 branches merged.** 50 new Shopify tools, 3 Omie reads, 1
Affiliates POC, 2 operator scripts, 3 docs files, NAMI Works mark
in MCP + favicon route. All merged commits verified green: `npm run
typecheck`, `npm run lint`, `npm test` (113/113).

Nothing was pushed. Nothing was deployed. `origin/main` is 18+ commits
behind `main`.

---

## What's on `main` that wasn't before tonight

### Infra & developer experience (3 merged)

| # | Branch | Shipped |
|---|---|---|
| 1 | `feat/connector-icon` | SVG mark at `/favicon.ico` + `/icon.svg` (Fastify routes). `icons: [...]` field on MCP `serverInfo`. Placeholder SVG ("NW" on #1f1e1c) — swap for a real mark in a one-line diff when you have artwork. |
| 2 | `feat/operator-scripts` | `npm run rotate-bearer -- --slug=<slug>` and `npm run suspend-tenant -- --slug=<slug> [--activate|--disable]`. Both TS, reuse existing Prisma models. |
| 3 | `feat/operator-docs` | `docs/runbook.md`, `docs/tenant-onboarding.md`, `docs/architecture.md`. Pure docs. |

### Omie surface (1 merged)

| # | Branch | Shipped |
|---|---|---|
| 4 | `feat/phase-5-omie` | `src/clients/omie.ts` (per-tenant JSON-RPC, SSM creds, exponential backoff on 425/429/5xx, fault-on-HTTP-200 detection). 3 read tools: `omie_consultar_cliente`, `omie_listar_pedidos`, `omie_consultar_financeiro`. Portuguese operator output. Client refuses to build while SSM has `REPLACE_ME` placeholders — populate before first call. |

### Affiliates (1 merged)

| # | Branch | Shipped |
|---|---|---|
| 5 | `feat/affiliates-read-poc` | `affiliates_list_profiles` tool + new Prisma models (`AffiliateProfile`, `AffiliateMonthly`) + migration file `20260423021617_affiliates`. **Migration NOT applied to prod.** Tool returns zero monthly stats until the sync cron question (D3 below) is resolved. |

### Shopify tool expansion (17 merged)

| # | Branch | Tools | Theme |
|---|---|---|---|
| 6 | `feat/more-shopify-reads` | 4 | list_discount_codes, list_locations, customer_lifetime, daily_revenue_summary |
| 7 | `feat/bonus-shopify-reads` | 4 | top_cities_by_orders, compare_revenue_yoy, list_pending_local_delivery, **preview_bulk_price_update** (dry-run, no writes) |
| 8 | `feat/stale-discount-detector` | 1 | detect_stale_markdowns (forgotten-promo cleanup) |
| 9 | `feat/campaign-audits` | 3 | audit_markdowns, audit_excluded_in_campaign, audit_campaign_consistency (🏷️ CPG-biased — default exclusion tag `lancto`, overridable) |
| 10 | `feat/batch-a-audits-reads` | 8 | audit_discount_shipping_combine, revenue_by_location, revenue_month_to_date, deep_dig_order, top_customers_by_ltv, compare_two_orders, kpi_monthly_average, shipping_journal |
| 11 | `feat/batch-b-beautyback` | 2 | list_beautyback_codes, audit_beautyback_consistency (🏷️ CPG-biased — default prefix `BEAUTYBACK`, overridable) |
| 12 | `feat/batch-c-carrier` | 2 | list_carrier_services, list_delivery_profiles |
| 13 | `feat/batch-d-promo-reads` | 3 | discount_usage_summary, upcoming_discounts, audit_product_metafield |
| 14 | `feat/batch-e-product` | 3 | low_inventory_alert, product_dimensions (🏷️ CPG-biased defaults, overridable), find_products_by_metafield |
| 15 | `feat/batch-f-ops-audits` | 2 | audit_retail_totals, list_fulfillment_stragglers |
| 16 | `feat/batch-g-collections` | 5 | list_collections, list_products_in_collection, audit_missing_image, audit_missing_seo, product_collection_memberships |
| 17 | `feat/batch-h-customers` | 5 | customer_order_history, detect_duplicate_customers, list_customer_segments, search_customers_advanced, list_abandoned_checkouts |
| 18 | `feat/batch-i-orders` | 5 | list_draft_orders, list_recent_orders, product_sales_rank, list_orders_by_tag, list_recent_refunds |
| 19 | `feat/batch-j-writes` | 5 | **tag_order, untag_order, add_note_to_order, tag_customer, replace_product_tags** — all two-step confirm-gated via `src/lib/confirm.ts`. `replace_product_tags` is destructive-by-design (full overwrite); preview shows current tags before apply. |
| 20 | `feat/batch-k-admin` | 5 | list_webhooks, shop_info, list_gift_cards, list_metaobject_definitions, list_markets |
| 21 | `feat/batch-l-inventory` | 5 | list_inventory_adjustments, product_inventory_by_location, list_transfers (plan-gated), reorder_forecast, audit_inventory_negatives |
| 22 | `feat/decisions-summary` | — | This file (plus the sandbox-gebeauty import from `cpg-labs@ded9a14`, which landed on the same branch). |

**Totals:** 61 new Shopify tools + 3 Omie reads + 1 Affiliates read = **65 tool registrations** on top of the 6 already on main before tonight (71 total surface).

---

## What's NOT on `main`

### Dropped (1)

- `feat/shopify-version-auto-detect` — you correctly flagged that the
  `@shopify/admin-api-client` library validates `apiVersion` client-side
  against a baked-in list. Runtime auto-detection via `publicApiVersions`
  can't help because the client itself rejects any version it doesn't
  know about. The quarterly manual bump at `src/clients/shopify.ts:12`
  is the actual mechanism. Branch deleted.

### Held for follow-up (1)

- `feat/tool-catalog-docs` — contains `docs/tool-catalog.md` +
  `docs/merchant-discovery.md`. Written before the 50+ tool expansion,
  so both files are ~1/3 accurate. To regenerate, start a fresh session
  and ask me to rewrite the catalog from the current
  `src/tools/shopify/index.ts` + `src/tools/omie/index.ts` +
  `src/tools/affiliates/index.ts`. I classify each tool as 🌐 Universal /
  🏷️ CPG-biased / 🎯 Tenant-specific. The merchant-discovery questionnaire
  structure is still worth keeping — just the tool mappings need refresh.

---

## Open decisions (changed since overnight)

### D1 — Tool catalog docs (still open, approach agreed)

Regenerate `docs/tool-catalog.md` from the full current tool list in a
fresh session. The held `feat/tool-catalog-docs` branch can be used as a
structural reference and then discarded, or I can start from scratch.

### D2 — Omie write tools (still open)

Phase 5 shipped reads only. `omie_criar_cliente` is the obvious next
write tool but there are per-account address-validation quirks (CEP,
state codes) and double-creation in Omie is hard to reverse. When you
want it, it's a one-branch batch that reuses `confirmationPreview` the
same way Shopify writes do.

### D3 — Affiliates port (still blocked)

Two blockers to surface real data from `affiliates_list_profiles`:

1. **Migration apply.** `prisma/migrations/20260423021617_affiliates`
   is on `main` but was never `prisma migrate deploy`'d to prod RDS.
   Needs the temporary ingress-from-your-IP song-and-dance in
   `docs/runbook.md`.
2. **Sync cron decision.** cpg-labs fills the monthly rollups via
   `api.cron.affiliates-sync.tsx` daily. Two options:
   - **Port the cron here** (new scheduled ECS task, cleaner, heavier)
   - **Bridge** via shared table written by cpg-labs (faster, couples
     products)

   Recommendation still: port, but call is yours.

### D4 — OAuth 2.1 polish (nice-to-have, not urgent)

OAuth is live in prod. Two backlog items if you want to iterate:
- Branded `/oauth/consent` page (currently functional but unstyled).
- Token-revocation endpoint (today's flow forces waiting for JWT expiry).

Not tonight.

### D5 — `audit_retail_totals` channel match (flagged, not fixed)

Tool hardcodes gebeauty's `POS` + `retailLocation` channel match. For a
second CPG tenant this will break. Low-urgency fix: move the channel
matcher into tenant config next time we onboard. Keep this in mind when
you start a second tenant.

### D6 — SVG mark

`/icon.svg` currently serves a monochrome `NW` placeholder. When you
have a designed brand mark, swap the `NAMI_WORKS_ICON_SVG` string in
`src/lib/icon-routes.ts` — one-line change.

---

## Operator-action checklist

Everything below is NOT done. Each needs you or your explicit go-ahead.

- [ ] **Push `main` to `origin`.** The merge commits + tonight's sprint
      are local-only. `git push` when ready to make them the canonical
      main.
- [ ] **Apply Prisma migration** `20260423021617_affiliates` on prod
      RDS before first `affiliates_list_profiles` call. Use the temporary
      ingress flow in `docs/runbook.md`.
- [ ] **Deploy.** `.\scripts\deploy.ps1` when you want the new tool
      surface live on `mcp.nami.works`. No Terraform changes were
      introduced, so task-def + image is all that rolls.
- [ ] **Rotate prod bearer** if the one currently in claude.ai was
      ever shared: `npm run rotate-bearer -- --slug=gebeauty`. Note: if
      rotated, the gebeauty claude.ai connector needs a fresh OAuth
      consent (paste new bearer once into the consent page).
- [ ] **Populate Omie SSM credentials** for `gebeauty` before the Omie
      tools can fire. The client errors out with a `put-parameter` hint
      when it sees `REPLACE_ME`.
- [ ] **Regenerate `docs/tool-catalog.md`** — ask me in a fresh session
      (see D1).
- [ ] **Decide D3 (affiliates cron)** before applying the affiliates
      migration, or apply the migration + leave the tool returning zeros
      as a harmless placeholder.

---

## Numbers

- Branches merged: 22.
- Held: 1 (`feat/tool-catalog-docs`).
- Dropped: 1 (`feat/shopify-version-auto-detect`).
- Tool surface: 71 (6 pre-sprint + 65 new).
- Test count: 113 passing on merged main (was 57 before sprint).
- Net new code: ~9,000 LoC including tests and docs.

---

## Morning-of-next-session quickstart

```powershell
# Check the state
git log --oneline -15
git status

# Smoke test locally
npm run typecheck; npm run lint; npm test

# If you want the new surface live:
# 1. apply the affiliates migration (or skip if not using affiliates yet)
# 2. populate Omie SSM for gebeauty if you want the Omie tools to fire
# 3. git push
# 4. .\scripts\deploy.ps1
```

---

— Claude
