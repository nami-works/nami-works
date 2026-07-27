---
id: gebeauty-vnda-order-backfill
name: Backfill VNDA historical orders into Shopify
owner: cto
status: backlog
priority: normal
created: 2026-07-14
target: null
current_phase: 2-de-risk
next_blocker: Dry-run built + validated (45,469 orders / 29,592 customers). Live write blocked on 3 gates — (1) CheckCommerce evolução GB-990 answered + implemented (keep backfill orders out of Omie/NF-e); (2) write_orders scope granted; (3) Klaviyo Pós compra trigger_filter applied. Then 10-order test.
next_owner: cto (build live path once gates clear) / CheckCommerce (GB-990) + Lucas (scope grant, Klaviyo go)
stakeholders:
  - Lucas (CEO)
working_agreement: ~/.claude/projects/c--claude/memory/feedback_cto_contract.md
---

## Why
~49k customers were migrated from the old VNDA storefront into Shopify with **no order history**, so Shopify's native `rfm_group` and Klaviyo's predictive analytics classify them as cold "prospects." A `Migration1` tag was the workaround marker. The definitive native fix is to import their real VNDA purchase history: matched customers then classify correctly in **both** Shopify and Klaviyo (proper winback targeting), and `Migration1` becomes truly obsolete. Analysis confirms the payoff is large and the data is clean.

## Source (validated 2026-07-14)
- **VNDA order export:** `G:\Drives compartilhados\GEB_Operações\Drive Felipe\GB\FORNECEDORES\VNDA\BaseDePedidos\Pedidos1-8.xlsx` (~30 MB, 8 files, date ranges in `entredatas-arquivos.txt`).
- Coverage **2020-08-24 → 2024-03-13** (up to Shopify cutover); **48,519 confirmed orders**.
- Schema: per order 1 `Tipo=Total` row (+ Frete/Produto/Promoção). `Total` rows carry **Data, Preço venda, E-mail, Documento (CPF), address** — everything RFM needs; SKU reconstruction not required.
- Customer base file: `...\VNDA\baseClientes\Clientes.xlsx`. Omie is a fiscal cross-check (84k pedidos back to 2020, matchable by email/CPF).

## Match analysis (2026-07-14, read-only)
- VNDA buyers matched to Shopify by email: **30,576 / 31,941 = 95.7%** (only 1,365 not in Shopify).
- **Migration1 customers enrichable: 29,592** (of 49,368 = 59.9%); **22,564** currently have 0 Shopify orders (pure gap fix).
- VNDA orders to import for matched Migration1: **~45,469**.
- The ~40% of Migration1 not in VNDA are genuine never-purchasers (newsletter/other imports) — they correctly stay prospects. Import cleanly separates real lapsed buyers from non-buyers.

## Phases
- [x] 1. Source located + validated + match analysis — 2026-07-14
- [~] 2. De-risk (in progress 2026-07-14) — findings below in "Phase 2 de-risk findings". Klaviyo risk narrowed to ONE flow; fiscal risk is REAL (a Shopify→Omie sync exists). — owner: cto
- [~] 3. Build `orderCreate` importer — **dry-run DONE + schema-validated 2026-07-14** (`gebeauty/scripts/vnda_backfill_import.py`; 45,469 orders / 29,592 custs). Idempotent via `customAttributes.vnda_pedido`, `vnda-import` tag, `processedAt` back-date, single "Pedido histórico VNDA" line, notifications suppressed. Live `--apply` path NOT written until the 3 gates clear.
- [ ] 4. 10-order live test → watch Shopify analytics + Klaviyo events/flows 24h for zero flow fires
- [ ] 5. Staged batches with monitoring; verify `rfm_group` reclassification on a sample
- [ ] 6. Retire `Migration1` tag (49,368) once history is in and classification confirmed
- [ ] 7. Update memory + close

## Phase 2 de-risk findings (2026-07-14, all read-only)

### (a) Klaviyo — risk collapses to a single flow
Live order-relevant Metric flows and their real triggers (pulled from Klaviyo API, rev 2025-07-15):
- **Pós compra** (`RRzE9p`): trigger = **Ordered Product** (`TvT23S`), trigger_filter = *null* (any line item); profile_filter = Ordered Product count == 1 all-time (first-ever purchase).
- **Recompra TRIO** (`XkACFP`) + **Recompra Boosters/Finalizadores** (`XqJpap`): trigger = **Ordered Product**, but trigger_filter requires product **Tags/Name** (`contem-shampoo/mascara/leave-in`, `booster`, `finalizador…`).
- **Carrinho abandonado ATT** (`VcC7JX`): trigger = **Added to Cart** (`WSrvL9`).
Consequence of the single summary line item "Pedido histórico VNDA" (no real SKU, no product tags):
- Recompra flows' trigger_filters **cannot match** → structurally safe.
- Abandoned flow triggers on Added-to-Cart / Checkout Started, which imports never create → structurally safe.
- **Only Pós compra can fire** (its trigger_filter is null), and only for pure-gap customers whose imported order is their 1st Ordered Product event — *and only if Klaviyo triggers flows on back-dated events at all.*
Timestamp semantics: Klaviyo's Shopify integration timestamps Placed/Ordered events by the order's own date (verified: today's live events carry today's datetime). Klaviyo docs: native integrations don't fire flows on historical/back-dated events (Events-API replay is the exception, needs `backfill:true`; not our path). **Must still be confirmed empirically on the 10-order test.**
**Klaviyo plan (chosen = CTO recommendation, 2026-07-14):** add a permanent Pós compra trigger_filter "Ordered Product item Name does NOT contain 'Pedido histórico VNDA'" → import-proof regardless of timestamp behavior; doesn't blind the flow for real new customers; distinctive name never appears in real orders. Still watch the 10-order test as defense-in-depth. (Klaviyo write — pending Lucas approval at build time; nothing changed yet.)

### (b) Fiscal — premise was WRONG: a Shopify→Omie sync DOES exist
Evidence (repo scripts `scripts/omnify/extrema-omie-import-status.py`, `omie-lookup-by-shopify-id.py`, `omie-pedido-etapas.py`): a connector pushes Shopify orders into Omie keyed by **`codigo_pedido_integracao` = Shopify order numeric ID** (and `numero_pedido_cliente` = order name), and pedidos advance through etapas to **NF-e emission (etapa 70)**. So API-created orders getting new Shopify IDs **could be swept into this sync and attempt 45k back-dated NF-e** — a fiscal hazard, higher-certainty than the Klaviyo one.
**Connector identified (Lucas, 2026-07-14): "OMS + PDV" by FullComm** (`apps.shopify.com/integration-erp-wms-tms`, docs.fullcomm.io) — orchestrator middleware; syncs Shopify orders into Omie for NF-e. It's **status-driven** (orders flow through FullComm statuses; NF-e emits at the faturamento step) and supports **"Custom rules"** for order selection. GE's specific config (auto-NF-e on/off, which orders sync) lives in GE's Omie.Hub/FullComm dashboard — NOT programmatically reachable (no `read_apps` scope).
Real orders carry `sourceName='web'` + routing tags (`CD Extrema`/`SHIPPING`, `PICK_UP`/`Shops Jardins`); an `orderCreate` import would have a different `sourceName` (app handle) and only a `vnda-import` tag — the levers for a FullComm exclusion rule.
**FullComm = CheckCommerce** (GE's storefront/integration vendor, the `mcp__check__*` board). The Shopify→Omie sync is their domain (delivered evoluções GB-482 "Ajuste integração Shopify > Omie Extrema", GB-513 "cenário fiscal Omie", GB-410 "erro criar pedido no Omie"). So the fiscal exclusion is filed as a request to them, not self-configured.
**Fiscal plan — FILED 2026-07-14: evolução `GB-990`** (lane todo) asks CheckCommerce for their recommended, most-reliable mechanism to keep the backfill orders out of the Omie/NF-e flow (our suggestion: ignore Shopify orders tagged `vnda-import`; other signals offered: API `sourceName`≠`web`, single no-SKU line "Pedido histórico VNDA"). **Blocking: await their answer + implementation before any live write.** Then still gate on the 10-order test (create 10, watch Omie 24h via `scripts/omnify/extrema-omie-import-status.py`) to confirm zero pedidos advance toward NF-e.

## Phase 3 progress — dry-run importer BUILT + validated (2026-07-14)
Script: `gebeauty/scripts/vnda_backfill_import.py` (dry-run default; `--apply` deliberately refuses — live path not implemented until the 3 gates clear). Reads the 8 Pedidos*.xlsx, filters `Status==Confirmado`, matches to Migration1 customers by email, builds idempotent orderCreate payloads. PII outputs go to scratchpad (`_vnda_plan.jsonl`, `_vnda_unmatched.jsonl`), never committed.
Dry-run results (reproduce the phase-1 match analysis exactly):
- 48,519 Confirmado orders (64 Cancelado dropped; 0 after-cutoff).
- **45,469 orders importable**, matched by email to **29,592 distinct customers** (of which **22,563 pure-gap, 0 prior Shopify orders**). 3,050 orders unmatched (buyer not in Migration1). Total backfill GMV ≈ **R$10.87M**. All line amounts > 0.
- Payload per order: single custom line "Pedido histórico VNDA" (UTF-8 verified), `processedAt`=original date (BRT), `financialStatus: PAID`, `email`+`customer.toAssociate`, tag `vnda-import`, `customAttributes.vnda_pedido`=VNDA id (idempotency key), options `sendReceipt/sendFulfillmentReceipt:false`, `inventoryBehaviour: NOT_CLAIMED`.
- `orderCreate` mutation shape **validated against 2026-01 schema** (shopify-dev-mcp). Required scopes confirmed: `write_orders` (still not granted).
- Note: customer CPF is NOT a `custom.cpf` metafield, so matching is email-only (100% of VNDA orders carry email); CPF fallback is effectively inert.

### Hard constraints discovered
- `orderCreate` requires **`write_orders`** scope — **NOT currently granted** (see gebeauty/CLAUDE.md scope list). Natural gate: import can't run until Lucas adds it.
- `orderCreate` is capped at **5 new orders/minute** on Plus → ~45,469 orders ≈ **6+ days** of continuous paced running (plan phase 5 accordingly).
- Back-date via **`processedAt`** (analytics/RFM date), not `createdAt` (server-assigned). Confirm `OrderCreateOrderInput.processedAt` when building.

## Notes
- 2026-07-14 — Initiative spun out of the customer-tag cleanup session (`shopify_cleansing`). Same session: removed CPF tags (1,716 custs, IGLU-POS artifact) and `rfm_*` tags (144,657 custs) after migrating RFM to Klaviyo-native segments (`Compradores engajados` / `Winback` / `Quase perdidos`). `Migration1` deliberately **held, not deleted** — it's the import cohort marker (phase 6 removes it).
- 2026-07-14 — Old platform identified as **VNDA** via ex-IT-manager handover email (felipe@, 2024-12-23). Files live in `ti@gebeauty.com.br` Drive / shared drive path above.
- **Risk #1 = Klaviyo flow detonation.** Live Metric-triggered flows on `Placed Order`. Back-dated events usually don't trigger Klaviyo flows but MUST be verified on the 10-order test before scaling. `suppress_notifications` only silences Shopify's own emails, not Klaviyo.
- **Risk #2 = fiscal.** 48k `paid` orders hit Shopify analytics by historical date; confirm nothing syncs API-created orders to Omie/NF-e.
- Match/profiling scripts + outputs are in the session scratchpad (ephemeral) — re-runnable from the source path above; the 29,592-customer cohort is re-derivable from VNDA email ∩ Shopify `Migration1`.

## Done means
- Matched VNDA orders imported into Shopify with correct historical `created_at`, deduped (no double-import), zero Klaviyo flow fires attributable to the import.
- A sample of enriched customers shows corrected `rfm_group` (no longer PROSPECTS) and Klaviyo predictive history.
- `Migration1` tag removed; the tag no longer needed because real history drives classification.
- Memory updated (`project_gebeauty_vnda_backfill.md` or similar) and MEMORY.md linked.
