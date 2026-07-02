---
id: connector-team-enablement
name: Resurrect mcp.nami.works connector for GE ops team
owner: cto
status: in-progress
priority: normal
created: 2026-06-30
target: null
current_phase: 3-dns-tls
next_blocker: DNS A-record `0ac9b7010588 → 54.221.23.142` must be added in the Registro.br panel for gebeauty.com.br (manual — not in our Route53). Caddy vhost + public smoke + onboarding follow once it resolves.
next_owner: lucas
stakeholders:
  - GE Beauty (3 ops operators — claude.ai/Desktop users)
working_agreement: ~/.claude/projects/c--Users-Lucas-Guimar-es-Desktop-nami-works/memory/feedback_cto_contract.md
---

## Why

Give the GE Beauty ops team shared access to the GE systems Lucas can reach, without
distributing the `sandbox/gebeauty/.env` to anyone's machine. The custom MCP connector is the
right vehicle: credentials never leave the server, operators only get a curated tool surface
(no arbitrary script access against the live store), and access is revocable by flipping one
tenant's `status` — no re-issuing creds to everyone. Operators work through claude.ai / Claude
Desktop, not Claude Code, so they need zero local files. This resurrects the team-enablement
plan recorded on 2026-06-08 (`project_connector_single_tenant_pivot`) that was paused, then the
connector was torn down for cost on 2026-06-29 (`project_lean_infra_2026_06_29`).

## Decision record (2026-06-30)

- **Custom connector over file distribution** — chosen vs sharing the `.env`, an SSM-bootstrap
  script, a secrets manager (1Password/Doppler), or SOPS-in-repo. Reason: those all put live
  GE credentials (write-scoped Shopify token, Omie, Lalamove) on operator machines and give
  arbitrary API access. The connector keeps secrets server-side and limits the blast radius to
  the shipped tool set.
- **Auth = one shared gebeauty bearer** (not per-person). Simplest onboarding for a 3-person
  trusted team. Trade-off accepted: no per-person attribution; revoking one means rotating the
  bearer for all three.
- **Scope = the existing 87-tool surface.** Lucas confirmed operators do NOT run local
  deliveries, so the dispatch/fulfillment gap (below) stays deferred.

## Tool surface audit (2026-06-30) — ~87 tools registered

Source of truth: `apps/connector/src/tools/*/index.ts` (side-effect registration).

| Vertical | Count | Coverage |
|----------|-------|----------|
| Shopify  | 74 | orders, customers, products, inventory, discounts, collections, revenue/KPI analytics, PDP tooling, + GE-specific audits (BEAUTYBACK, campaign-consistency, excluded-in-campaign, discount/shipping combine, stale markdowns) |
| Omie     | 3  | consultar-cliente, listar-pedidos, consultar-financeiro |
| Instagram| 7  | voice card, recent/top posts, caption search, draft-caption, ingest refresh, account link |
| Affiliates | 1 | list-profiles |
| Brand    | 1  | tone-current (brand voice) |
| Nami     | 1  | feedback |

- ~10 Shopify write tools (price, discount, store credit, order/customer tags, notes, PDP
  files). All writes gated by two-step confirmation (`src/lib/confirm.ts`): preview first,
  `confirm:true` to execute — regardless of blast radius. Good fit for a shared-bearer ops team.
- Tenant auth: bearer → tenant row, constant-time compare, `status !== 'active'` → 401 (kill
  switch). Per-tenant config from `IntegrationTenant` DB row + SSM `/nami-works/tenants/<slug>/*`.

## Known gap — DEFERRED (not in initial scope)

Local-delivery dispatch / fulfillment is **not** on the connector. The connector has the reads
(`list-pending-local-delivery`, `list-carrier-services`, `list-delivery-profiles`,
`shipping-journal`) but the operations (optimize routes, dispatch, mark-delivered, fulfill) live
in the **omnify-admin Claude Control API** (`cpg_control.py`). Lucas confirmed operators don't
need this. Revisit as a phase-2 build (connector tools wrapping the control API, or a second
connector) only if that changes.

## Infra facts for the rebuild (from `project_lean_infra_2026_06_29`)

- **Target box:** `cpg-labs-lean` (small_3_0, 2GB/2vCPU) at **54.221.23.142**, key
  `~/.ssh/cpg-labs-lightsail.pem`. Ubuntu 22.04 + Docker + Caddy. Compose at
  `/srv/cpg-labs/docker-compose.yml` (currently 3 app vhosts + self-hosted Postgres).
- **Rebuildable from:** ECR repo `nami-works` (13 images kept) + RDS snapshot
  `nami-works-final-2026-06-29` (connector DB).
- **DB:** connector needs Postgres (schema has `Json`/`@db.Text`). Simplest path: create a
  `connector` database inside the existing self-hosted `cpg-labs-postgres` container rather than
  restoring the whole RDS snapshot or running a second PG container. Decide at phase 2.
- **DNS:** `nami.works` Route53 zone is KEPT; the `mcp.nami.works` A-record was deleted —
  re-create it → 54.221.23.142. Caddy auto-TLS issues the cert once DNS resolves.
- **Deploy mechanic changed:** the old `scripts/deploy-connector.ps1` targeted ECS Fargate
  (now torn down) — it's invalid as-is. Resurrection folds the connector into the Lightsail
  docker-compose deploy (build → push ECR → SSH → edit compose tag → `docker compose pull && up -d`).
  ECR auth is a deploy-time `docker login` (box has no standing AWS creds).
- **Cost:** colocates on the existing $12/mo box → marginal cost ≈ 0 (vs the old ~$49/mo idle
  ECS stack that triggered the decommission).

## Phases

- [x] 1. Audit tool surface — done 2026-06-30
  - 87 tools across 6 verticals; ~10 gated write tools; tenant kill-switch auth confirmed
  - Local-delivery dispatch confirmed out of scope
- [x] 2. Infra resurrection onto `cpg-labs-lean` — done 2026-06-30
  - Image `nami-works:connector-20260630-44d00a4-p2` built from current source + pushed to ECR
  - **Dockerfile bug fixed**: runtime stage didn't copy the custom-output `@prisma/client-connector`
    → ERR_MODULE_NOT_FOUND at boot. Added the COPY (the `-p2` tag). MUST land on main.
  - `connector` DB created in self-hosted Postgres; 6 migrations applied (12 tables); `gebeauty`
    tenant seeded (status active, bearer hash stored)
  - `/etc/cpg-labs/connector.env` written (root 600). OAUTH_SIGNING_KEY freshly generated (HS256
    symmetric; `cpg-labs` IAM user lacks SSM GetParameter so the stored key was unreadable, and
    there were zero issued tokens, so a fresh key is clean). Scoped `nami-connector-ssm` key minted
    straight into the env file. SSM read of GE tenant creds verified working with the scoped key.
  - compose service `connector` added (`127.0.0.1:3003`, `mem_limit: 384m`); container Up, using
    ~47MB. Smoke: `/health` ok, no-bearer → 401, valid bearer → MCP initialize result.
  - `scripts/deploy-connector.ps1` NOT yet rewritten for Lightsail (still ECS). Follow-up — the
    deploy was done by hand this session (build/push local → ssh compose pull/up). See phase 6.
- [ ] 3. DNS + TLS — owner: lucas (DNS) + cto (Caddy)
  - Lucas adds `A  0ac9b7010588 → 54.221.23.142` in the Registro.br panel for gebeauty.com.br
  - CTO adds Caddy vhost `0ac9b7010588.gebeauty.com.br` → `127.0.0.1:3003`; confirm auto-TLS issues
- [ ] 4. Auth + onboarding readiness — owner: cto
  - Verify OAuth discovery/authorize/token endpoints respond post-redeploy
  - Confirm/mint the single shared gebeauty `IntegrationTenant` bearer, status `active`
  - Smoke: `curl https://mcp.nami.works/health` → `{"ok":true}` + one read tool + one confirmed write
- [ ] 5. Onboard the 3 operators — owner: lucas + cto
  - Each: claude.ai or Claude Desktop → add custom connector `https://mcp.nami.works/gebeauty`
    → OAuth → paste shared bearer once
  - Verify each can run a read and a two-step confirmed write against GE prod
- [ ] 6. Handover + memory — owner: cto
  - Update memory: connector is live again (supersede the "decommissioned/idle" note in
    `project_lean_infra_2026_06_29`); record bearer location (not value) + kill-switch procedure
  - Deploy-queue entry moved Pending → Deployed with image tag

## Notes

- 2026-06-30 (phase 2 DONE) — Connector live on the box, internal smoke green. Remaining:
  Lucas adds the Registro.br A-record → then CTO adds the Caddy vhost (cert auto-issues),
  public smoke at `https://0ac9b7010588.gebeauty.com.br/health`, then onboard the 3 operators
  (claude.ai → add connector URL → OAuth → paste shared bearer). **Bearer** is saved locally in
  this session's scratchpad (`connector-gebeauty-bearer.txt`) — hand it to Lucas out of band;
  it is NOT in git/memory/transcript. Kill switch: `UPDATE "IntegrationTenant" SET status='disabled'
  WHERE slug='gebeauty';` in the `connector` DB (rotate the bearer to re-enable per-person).
  Deploy was manual (build/push local → ssh compose); `scripts/deploy-connector.ps1` rewrite is
  deferred to phase 6.
- 2026-06-30 (execution start) — Phase 2 in progress. Locked config:
  - **Public host: `0ac9b7010588.gebeauty.com.br`** (random subdomain, Lucas's call, to defeat
    casual/brand-based enumeration). `mcp.nami.works` stays dead. CT-log exposure accepted —
    obscurity is a speed bump; the bearer + `status` kill-switch are the real control. Wildcard
    cert (to hide the name from CT) was rejected as too heavy (needs DNS-01 on Registro.br).
  - `OAUTH_ISSUER=https://0ac9b7010588.gebeauty.com.br`; onboarding URL
    `https://0ac9b7010588.gebeauty.com.br/gebeauty`; Caddy vhost → `127.0.0.1:3003`.
  - **DNS is manual at Registro.br** (gebeauty.com.br is NOT in our Route53; NS = a/b.sec.dns.br).
    Record to add: `A  0ac9b7010588  →  54.221.23.142`. Action: lucas.
  - **SSM confirmed intact** — `/nami-works/app/oauth_signing_key` (reuse) + gebeauty tenant creds
    present. `/nami-works/app/database_url` exists but points at the DELETED RDS → repoint to the
    self-hosted PG (`postgresql://omnify:<pw>@postgres:5432/connector`, new `connector` DB).
  - **Box AWS creds:** new scoped IAM user `nami-connector-ssm` CREATED (least-privilege:
    `ssm:GetParameter*` + KMS-decrypt-via-SSM on `/nami-works/*`). Keyless until deploy — the
    access key gets minted directly into `/etc/cpg-labs/connector.env` so the secret never hits
    the transcript.
  - **Build:** ECR image is stale (2026-05-21) → rebuild from current source. Box too RAM-tight
    to build on (~1.0Gi free) → build locally + push ECR. Connector compose service gets
    `mem_limit: 384m`.
  - **Blockers right now:** (1) Docker Desktop not running locally — needed for the build;
    (2) Registro.br A-record — owner lucas, needed only for the public smoke + onboarding.
- 2026-06-30 — Initiative created from a session deciding how to give the GE ops team shared
  access. Audit completed same session (phase 1). Next move is the infra rebuild, which is
  deploy-gated: needs Lucas to greenlight a window before the service goes up. No `.env` ends up
  on any operator machine — the whole point.

## Done means

- `https://0ac9b7010588.gebeauty.com.br/health` returns `{"ok":true}` served from the Lightsail box
- All 3 operators have the connector live in claude.ai/Desktop and can each run a read + a
  two-step confirmed write against GE Beauty prod
- Shared gebeauty bearer documented (location only, never the value) and the `status`-flip kill
  switch verified to 401 a revoked tenant
- Memory updated so no file still claims the connector is decommissioned
