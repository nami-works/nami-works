# Session Handover — Local Delivery Control API — 2026-04-19

> **Note (2026-04-23):** Paths in this document refer to `gebeauty-workspace/` as it existed at the time of writing. That workspace has since been migrated to the `nami-works` repo at `sandbox/gebeauty/` — the Python client, shipping journal, and `.env` all live there now. The `/api/control/*` server side is unchanged.

## What was done

**Built and deployed a bearer-auth-gated HTTP control surface (`/api/control/*`) that lets Claude Code drive the Local Delivery pipeline headlessly** — no UI, no Shopify embedded session. Proved it end-to-end by running a full day's dispatch cycle (4 routes, 19 orders across SP + Rio + Recife) entirely through Claude calling these endpoints.

**New control intents (all live on prod, task def rev 220):**

- `GET  /api/control/state?locationId=X[&live=true]` — snapshot of routes, orders, dispatch status. `live=true` refreshes each active dispatch by calling Lalamove's API in parallel (persists status changes to DB).
- `POST /api/control/optimize { locationId }` — clusters unassigned LOCAL orders into routes, applies `ld_rota-NN` tags, writes `RouteOptimizationSnapshot`. Mirrors cron's Phase A.
- `POST /api/control/dispatch { locationId, routeIndex }` — places a Lalamove order for one route. Derives orders from Shopify tags; no `PendingDeliveryRoute` dependency.
- `POST /api/control/reorder { locationId, routeIndex }` — cancels the active Lalamove order + immediately re-requests a new driver.
- `POST /api/control/unassign { routeTag, orderIds[], locationId }` — strips `ld_rota-NN` tag from specific orders.
- `POST /api/control/mark-delivered { locationId, routeIndex, ... }` — archives tags, creates Shopify fulfillment, creates `FulfillmentEvent { status: DELIVERED }`. Handles most-recent job per slot.
- `POST /api/control/mark-all-today { locationId }` — **sweeps every dispatch job at a location from the last 24h** and applies the mark-delivered flow. Needed because cron dispatches earlier in the day may share the same slot number with Claude dispatches later — `mark-delivered` alone misses the older ones.

**Python client at `gebeauty-workspace/scripts/cpg_control.py`** — reads `CPG_LABS_CONTROL_URL` + `CPG_LABS_CONTROL_TOKEN` from `.env`, exposes `state`, `optimize`, `dispatch`, `reorder`, `unassign`, `mark-delivered`, `mark-all-today` as CLI subcommands.

**Shipping journal at `gebeauty-workspace/scripts/shipping_journal.py`** — daily snapshot of in-flight routes and orders from Shopify tags. Writes dated markdown to `gebeauty-workspace/shipping-journal/`. First entry seeded at `2026-04-17.md`. Schema includes Observations + Feedback signal sections for end-of-day reflection.

**Scope expansion on CPG Labs Shopify app:** added `read_fulfillments` + `write_fulfillments` to `shopify.app.toml` (required by `fulfillmentEventCreate`). Deployed as `cpg-labs-39` via `shopify app deploy` and merchant re-approved.

**Deploy-script hole patched** across all three deploy scripts (`deploy-cpg-labs.ps1`, `deploy-omnify.ps1`, `deploy-storefront.ps1`). Each now reconciles `secrets[]` from `/omnify/*` SSM params via `aws ssm describe-parameters` + `aws sts get-caller-identity`, emitting the full secrets array every deploy. `omnify` + `storefront` scripts also converted from inline `python -c` one-liners to heredoc temp-file style (matches `cpg-labs`). Python syntax verified via `ast.parse` on each heredoc.

## Key decisions

- **Env-var auth, not DB table.** `CLAUDE_CONTROL_TOKEN` + `CLAUDE_CONTROL_SHOP` injected via SSM. Simpler than building an `IntegrationToken` table; good enough for single-shop use. Shop is server-side (derived from env), not client-supplied — a stolen token can't target another shop. Migrate to a DB table when we need multi-shop / rotation / audit.
- **Control API is the data plane, Claude is the shift manager.** Originally considered three architectures (ride existing cron only / give workspace `write_orders` scope / new endpoints). Settled on the last because it preserves single-source-of-truth for optimizer + Lalamove logic in the app.
- **`createShopifyFulfillment=true` by default on `mark-delivered`.** The auto-delivery pipeline's original design was "no Shopify fulfillments, tags only." The user explicitly reversed that for the Claude-driven flow — orders MUST show Fulfilled + Delivered in Shopify admin. `notifyCustomer=false` default (avoids email spam; flip via `--notify-customer`).
- **`mark-all-today` uses 24h lookback, not UTC-midnight "today".** We crossed UTC midnight during the session and the strict "today" filter in the first version of `mark-delivered` returned 404. The 24h sliding window handles timezone edge cases and covers the full Brazil operational day.
- **Compaction at `update-routes` commit point (earlier in session), not `assign`.** Per `inputs/pm-handoff-route-manager-reorder-2026-04-15.md`. Dispatched routes are frozen anchors — compaction never crosses them.
- **Phase 5b stale-polyline fix** (earlier in session) clears `route.corridorPolyline = ""` when Google Routes API fails, instead of silently keeping the stale geometry.
- **The `/api/control` bearer token lives in both Terraform `terraform.tfvars` AND `gebeauty-workspace/.env`** — must stay in sync. Rotating = update both + `terraform apply` + `deploy-cpg-labs.ps1` + restart workspace shell.

## What's pending

- **Deploy-script patch is not yet exercised.** All three scripts now reconcile `secrets[]` from SSM, but no deploy has run since the patch. The fix is inert until the next deploy; watch the first one's logs to confirm the SSM call emits the expected 12 secrets (no behavior change expected for the current set since they're already in the running task defs).
- **Reorder endpoint untested live.** Built and deployed but never exercised (user handled the Recife stuck-driver case manually). First live call will be the actual smoke test.
- **Live-status endpoint untested live.** Same story — the `state --live` flag is deployed but not exercised. Per-route Lalamove fetch adds ~1–2s latency; parallel so bounded.
- **No rate limiting / retry on control endpoints.** If Lalamove or Shopify throttle, the endpoints will throw 500. Fine for interactive use; revisit if we start calling from a cron.
- **Pre-existing uncommitted work unrelated to this session.** The working tree has 27 modified files and multiple untracked files in `app/campaign-goals/`, `app/routes/app.footprint-expansion*`, `app/routes/app.retail-sales/*`, `app/sales-goals/*`, `inputs/`, etc. None of these were touched this session; they're from prior work that never got committed. Before the next commit, sort out which of those are intended to ship — easy to accidentally include unrelated WIP.

## Modified files

**Control API — complete, deployed (rev 220, tag `claude-control-v8`):**
- `app/services/claude-control-auth.server.ts` *(new)* — bearer + shop-scoping
- `app/routes/api.control.$intent.tsx` *(new)* — 7 intents
- `infra/terraform/claude-control.tf` *(new)* — SSM params
- `infra/terraform/ecs.tf` — wired `CLAUDE_CONTROL_TOKEN`, `CLAUDE_CONTROL_SHOP` into task-def secrets
- `infra/terraform/terraform.tfvars` — `enable_claude_control=true` + token + shop
- `shopify.app.toml` — added `read_fulfillments,write_fulfillments` scopes (deployed via `shopify app deploy` as `cpg-labs-39`)

**Deploy scripts — complete, not yet exercised (will be applied on next deploy):**
- `scripts/deploy-cpg-labs.ps1` — added SSM reconcile to existing heredoc
- `scripts/deploy-omnify.ps1` — converted inline python to heredoc + reconcile
- `scripts/deploy-storefront.ps1` — converted inline python to heredoc + reconcile

**Workspace tooling — complete:**
- `gebeauty-workspace/scripts/cpg_control.py` *(new)* — Python client
- `gebeauty-workspace/scripts/shipping_journal.py` *(new)* — daily snapshot
- `gebeauty-workspace/shipping-journal/README.md` *(new)* — doc + deploy steps
- `gebeauty-workspace/shipping-journal/2026-04-17.md` *(new)* — first journal entry
- `gebeauty-workspace/.env` — added `CPG_LABS_CONTROL_URL` + `CPG_LABS_CONTROL_TOKEN`

**Cleanup:**
- `gebeauty-workspace/scripts/__pycache__/` — Python bytecode, gitignore candidate.

## Current state

**Production is live with the full control surface.** Verify end-to-end from the workspace:

```bash
cd gebeauty-workspace

# Snapshot (any location)
python scripts/cpg_control.py state --location gid://shopify/Location/97784398144

# Tomorrow's morning run (SP example)
python scripts/cpg_control.py optimize --location gid://shopify/Location/97784398144
python scripts/cpg_control.py dispatch --location gid://shopify/Location/97784398144 --route-index 0
python scripts/cpg_control.py dispatch --location gid://shopify/Location/97784398144 --route-index 1

# End of day, once all delivered
python scripts/cpg_control.py mark-all-today --location gid://shopify/Location/97784398144
```

**Known-good locations:**
- `gid://shopify/Location/97784398144` — Shops Jardins (SP)
- `gid://shopify/Location/101298569536` — RioSul (Rio)
- `gid://shopify/Location/97397014848` — Shopping Recife

**Today's run succeeded:** 19 orders marked Fulfilled + DELIVERED (SP 13, Rio 4, Recife 2), zero failures.

## Recommended next steps

1. **Commit the Claude control framework + deploy-script fix separately.** Two discrete, complete units. Stage only:
   - Control framework: `app/services/claude-control-auth.server.ts`, `app/routes/api.control.$intent.tsx`, `infra/terraform/claude-control.tf`, `infra/terraform/ecs.tf`, `infra/terraform/terraform.tfvars` *(watch for secrets — this file contains prod credentials, don't leak)*, `shopify.app.toml`, `gebeauty-workspace/scripts/{cpg_control,shipping_journal}.py`, `gebeauty-workspace/shipping-journal/README.md`, `gebeauty-workspace/shipping-journal/2026-04-17.md`.
   - Deploy-script fix: `scripts/deploy-cpg-labs.ps1`, `scripts/deploy-omnify.ps1`, `scripts/deploy-storefront.ps1` (same SSM-reconcile logic across all three).
   - **Do NOT commit** `gebeauty-workspace/.env` (contains token).
2. **Sort out the pre-existing uncommitted pile** (campaign-goals, retail-sales, footprint-expansion, sales-goals, settings). Ask the user what's meant to ship and what's WIP to discard.
3. **Watch the first deploy with the new scripts.** Should emit 12 `/omnify/*` secrets and register cleanly. Tests the reconcile logic end-to-end.
4. **Tomorrow's live run.** The user wants to repeat today's flow (optimize → dispatch → mark-all-today) with minimal intervention. That's the first real end-to-end exercise.
5. **Event history feed** (PM-labeled Option 2 earlier in the session). Webhook handler already knows about transitions — table `LalamoveDispatchEvent` + `GET /api/control/events?since=X` would give Claude session-to-session catch-up. ~45 min.

## Context the next session needs

- **Deploy pattern: Terraform first, then PowerShell.** `terraform apply` creates/updates SSM params and registers a task definition. PowerShell deploy scripts build the image and register ANOTHER task def revision derived from the current running one. **As of this session, PS scripts now reconcile `secrets[]` from `/omnify/*` SSM params every deploy** — so new Terraform-added secrets propagate automatically, and removed ones get cleared. Prior to the patch, the scripts copied `secrets[]` verbatim from the previous revision, causing silent drift.
- **`CLAUDE_CONTROL_TOKEN` value lives in THREE places:** `infra/terraform/terraform.tfvars`, `/omnify/CLAUDE_CONTROL_TOKEN` (AWS SSM, auto-managed by Terraform), and `gebeauty-workspace/.env` (client-side). All must match. The token string: already set; don't regenerate unless rotating.
- **BASE_PATH=/full** — the app is mounted at `/full`. The workspace `.env` `CPG_LABS_CONTROL_URL` ends with `/full`. React Router basename is set at BUILD time via Dockerfile ARG, NOT at runtime. Changing BASE_PATH requires rebuilding the image.
- **GE Beauty's delivery pipeline design principle (historical) WAS "no Shopify fulfillments, tags only"** — see `memory/project_auto_delivery_pipeline.md`. The Claude control flow REVERSES that for marked-delivered routes: we DO create Shopify fulfillments + DELIVERED events now. This is intentional — the user specifically asked for it this session. Memory may need updating.
- **`mark-all-today` lookback is 24h sliding window**, not strict UTC midnight. Intentional — Brazil timezone + late-day runs cross UTC midnight.
- **`getLalamoveOrderDetails` (live-status fetch) might 404 for terminal orders.** Handled gracefully in the state loader via try/catch — fetch failure just means we return DB status, not live.
- **ECS task def lifecycle issue:** `aws_ecs_task_definition.gebeauty` has `ignore_changes = [container_definitions]` — Terraform won't fight the deploy script over env/image. But this also means Terraform's ECS task def resource effectively only matters on first creation; all subsequent env/secret changes require the deploy script to pick them up. This is the root cause of the "deploy script hole" above.
- **Shopify fulfillmentEventCreate requires `write_fulfillments` scope** — docs explicit about this. We have it now.
- **Why auto-cron + Claude control can clash on route slots:** cron's Phase A assigns `ld_rota-NN` based on cluster count (1, 2, 3…). Claude's `optimize` also starts from slot 0. If cron ran earlier in the day and filled slots 0-2, then those orders completed and tags archived, THEN Claude runs optimize on new unassigned orders — Claude gets slot 0-1 fresh. That's why today had two separate "rota-01" cohorts (one cron, one Claude) with the same Shopify tag but distinct DB jobs. `mark-all-today`'s job-iteration approach (not slot-iteration) is the right sweep.
- **Recife case precedent:** when a driver doesn't come, `reorder` cancels and re-requests. Lalamove sometimes returns 422 on cancel (order is already terminal at their side) — handled gracefully, operation continues.
