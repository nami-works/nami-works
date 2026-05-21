# AWS Topology — CPG Labs

Canonical reference for the AWS side of the CPG Labs platform. If this doc disagrees with reality, the doc is wrong — fix the doc in the same session.

Raw investigation artifact that led to the current structure: [inputs/aws-account-audit.md](../inputs/aws-account-audit.md) (2026-04-22).

## Account

| Thing | Value |
|---|---|
| AWS account ID | `477780048372` |
| Region | `us-east-1` |
| IAM user (local CLI) | `cpg-labs` |
| ECS cluster (canonical) | `cpg-labs` |
| ECR repo | `omnify-app` (renameable — tag prefix distinguishes apps) |
| ALB | `omnify-alb` (HTTPS listener on `:443`) |
| RDS (app DB) | PostgreSQL, single instance |
| SSM Parameter Store prefix | `/omnify/` |

Related but out of scope here:
- **NAMI Works** — separate product, runs in the same `cpg-labs` cluster as service `nami-works-gateway` with its own target group (`nami-works-gw`), own RDS, own SSM namespace (`/nami-works/`). Not affected by any CPG Labs change. See the connector repo at `github.com/nami-works/nami-works`.

## Request flow

```
Internet
  │
  ▼
Route 53 (cpg-labs.io zone, nami.works zone)
  │
  ▼
ALB  omnify-alb:443  (ACM cert — ideally wildcard *.cpg-labs.io)
  │
  ├── Rule (priority 2)   Host == cpg-labs.io           → 301 redirect to https://www.cpg-labs.io
  │
  ├── Rule (priority 3)   Host == www.cpg-labs.io       → TG  cpg-labs-omnify-tg
  │                                                         (marketing site piggybacks on Omnify service
  │                                                          via host-aware dispatch — see _site.*.tsx routes)
  │
  ├── Rule (priority 10)  Host == app.cpg-labs.io       → TG  cpg-labs-full-tg
  │                       (post-consolidation; today the same traffic lands on omnify.cpg-labs.io/full/*
  │                        via path-based rule on omnify-gebeauty-tg)
  │
  ├── Rule (priority 20)  Host == omnify.cpg-labs.io    → TG  cpg-labs-omnify-tg
  │
  ├── Rule (priority 30)  Host == storytelling.cpg-labs.io → TG  cpg-labs-storytelling-tg
  │
  ├── Rule (priority 500) Host == mcp.nami.works         → TG  nami-works-gw
  │
  └── Default                                            → TG  cpg-labs-omnify-tg
           │
           ▼
      Target Group
           │  (health check: GET /health → 200)
           ▼
      ECS Service (on cluster `cpg-labs`)
           │
           ▼
      Fargate Task  (1 task per service, 256 CPU / 512 MB)
           │
           ▼
      Container  (node server.mjs, listens on :3000)
           │
           ▼
      React Router v7 app — routes filtered by APP_IDENTITY
```

Health check path on every TG: `GET /health` → expects `200 OK`. See [server.mjs](../server.mjs).

## Services per hostname

Each subsection explains what hits the hostname, which ECS service handles it, and why that separation exists.

### `app.cpg-labs.io` — CPG Labs "full" app

- **ECS service:** `cpg-labs-full-service` (post-consolidation; today lives as `omnify-gebeauty-service` on cluster `cpg-labs`).
- **Target group:** `cpg-labs-full-tg` (today: `omnify-gebeauty-tg`).
- **Task family:** `cpg-labs-full-task` (today: `omnify-gebeauty-task`).
- **Image tag prefix:** `cpg-labs-full-<yyyymmdd>-<sha>` going forward.
- **`APP_IDENTITY`:** `cpg-labs` — sees every route in [app/utils/app-identity.server.ts](../app/utils/app-identity.server.ts).
- **Shopify config:** [shopify.app.cpg-labs.toml](../shopify.app.cpg-labs.toml) / [shopify.app.toml](../shopify.app.toml). `application_url` target: `https://app.cpg-labs.io` (no `BASE_PATH`).
- **Installed on:** GE Beauty (only merchant today).
- **Why dedicated hostname:** historically served at `omnify.cpg-labs.io/full/*` with `BASE_PATH=/full`. The subpath caused recurring `/full/full/...` double-prefix bugs and `<s-link>` basePath asymmetries. Moving to the origin of a dedicated hostname makes that entire bug class structurally impossible.

### `omnify.cpg-labs.io` — Omnify focused app

- **ECS service:** `cpg-labs-omnify-service` (today: `omnify-service`).
- **Target group:** `cpg-labs-omnify-tg` (today: `omnify-tg`).
- **Task family:** `cpg-labs-omnify-task` (today: `omnify-task`).
- **Image tag prefix:** `cpg-labs-omnify-<yyyymmdd>-<sha>`.
- **`APP_IDENTITY`:** `omnify` — serves the local-delivery + retail slice only (see `IDENTITY_ROUTES.omnify` in [app-identity.server.ts](../app/utils/app-identity.server.ts)).
- **Shopify config:** [shopify.app.omnify.toml](../shopify.app.omnify.toml).
- **Why separate from `app.cpg-labs.io`:** Omnify is a focused product published independently on the Shopify App Store. Different `client_id`, different scopes, different branding.

### `www.cpg-labs.io` — Marketing/homepage

- **ECS service:** same as `omnify.cpg-labs.io` (`cpg-labs-omnify-service`) — no separate service.
- **Mechanism:** the Omnify service codebase contains `app/routes/_site.*.tsx` routes that render marketing content. A loader in the root layout sniffs the `Host` header and dispatches to the marketing routes when host starts with `www.` or is `cpg-labs.io`.
- **Why piggyback:** marketing site is small and ships with the same image as the Omnify app; no need for a separate ECS service, TG, or task def.
- **Post-consolidation:** expressed explicitly via `additional_domains = ["www.cpg-labs.io"]` on `module "omnify"` in `infra/terraform/apps.tf`, which spawns a second ALB listener rule pointing at the same TG. The conflation becomes infra-as-code instead of a hidden coincidence.

### `storytelling.cpg-labs.io` — Storytelling app

- **ECS service:** `cpg-labs-storytelling-service`.
- **Target group:** `cpg-labs-storytelling-tg`.
- **Task family:** `cpg-labs-storytelling-task`.
- **Image tag prefix:** `storytelling-<yyyymmdd>-<sha>`.
- **`APP_IDENTITY`:** `storytelling` — serves the blog-content + alt-text slice.
- **Shopify config:** [shopify.app.storytelling.toml](../shopify.app.storytelling.toml).
- **Already module-based:** [infra/terraform/storytelling.tf](../infra/terraform/storytelling.tf) is the reference implementation the other apps are migrating toward.

### `mcp.nami.works` — NAMI Works gateway (out of scope)

- **ECS service:** `nami-works-gateway` on the same `cpg-labs` cluster.
- **Target group:** `nami-works-gw`.
- Dedicated RDS, dedicated SSM namespace (`/nami-works/`). Does not share anything with CPG Labs apps other than the cluster, ALB, and VPC.

## APP_IDENTITY gating

One codebase serves multiple published Shopify apps. The per-app slice is chosen at runtime by the `APP_IDENTITY` environment variable, read in [app/utils/app-identity.server.ts](../app/utils/app-identity.server.ts).

- **Values:** `cpg-labs` (full feature set), `omnify`, `storytelling`, `storefront`. Default is `cpg-labs` if unset.
- **`IDENTITY_ROUTES`** — per-identity allowlist of React Router route IDs. Any request to a route not in the identity's list is rejected (or 404'd). `cpg-labs` sees everything.
- **`ALWAYS_ALLOWED`** — shared routes (auth, health, webhooks, layout) every identity can serve.
- **`getNavItems()` / `getHomeRoute()`** — drive nav rendering and post-login redirect per identity.

Implications for AWS:
- Every ECS service sets `APP_IDENTITY` via its task definition.
- Same Docker image, different env → different surface area. You do NOT need to rebuild to change what an identity serves — you change `IDENTITY_ROUTES` in code + redeploy.
- Adding a new published app with a different feature slice = new `APP_IDENTITY` + new `IDENTITY_ROUTES` entry + new ECS service with that env var set. No codebase fork. See [docs/adding-a-new-app.md](adding-a-new-app.md).

## Anti-patterns and historical notes

### The split-brain incident (2026-04-22)

For ~4 days the account ran **two ECS clusters** — `omnify-cluster` (older) and `cpg-labs` (newer) — with duplicate `omnify-service` and `omnify-gebeauty-service` in each. Both duplicate services were registered in `omnify-tg` and `omnify-gebeauty-tg`, so every request round-robined across two different code versions. Symptoms: `/full/full/...` from the old pod, `/app/foo` from the new pod, 401s on auth from the stale-secrets pod, "second refresh works" because refresh flipped the load-balancer coin.

Root cause: [scripts/migrate-cluster.ps1](../scripts/migrate-cluster.ps1) ran step 3 (recreate services on `cpg-labs` re-using the same TG ARNs → dual registration) but not step 5 (drain + delete old). Dual registration was permanent until manually removed.

Remediation: [inputs/aws-account-audit.md](../inputs/aws-account-audit.md) documents the full investigation. The plan at `.claude/plans/i-think-my-latest-eventual-sutton.md` describes the 8-phase fix. Key artifacts:

- [infra/terraform/drift-alarms.tf](../infra/terraform/drift-alarms.tf) — three CloudWatch alarms (see [deploy-runbook.md](deploy-runbook.md) for what each one means).
- [scripts/_deploy-common.psm1](../scripts/_deploy-common.psm1) — `Assert-NoSplitBrain` + `Assert-CleanWorkingTree` guards.
- `scripts/migrate-cluster.ps1` → moving to `scripts/archive/` (do not re-run).

### Why `gebeauty-*` naming persists in places

The CPG Labs "full" app was historically named after its only merchant, GE Beauty. Legacy names still appearing in the repo:

- `omnify-gebeauty-service`, `omnify-gebeauty-task`, `omnify-gebeauty-tg` — today's AWS resource names for the full app. Renamed to `cpg-labs-full-*` during the Terraform consolidation (Phase 6 of the remediation plan) via `terraform state mv`, not destroy+create.
- `/ecs/omnify-gebeauty` — the CloudWatch log group name referenced in `CLAUDE.md` logging guidance. Will become `/ecs/cpg-labs-full` post-consolidation. Both names may appear in historical logs.
- [infra/terraform/gebeauty.tf](../infra/terraform/gebeauty.tf) — the hand-rolled app block, slated for deletion once migrated to `module "full"` in `apps.tf`.

This naming will be fully retired in Phase 6 of the remediation plan.

### Image-tag chaos (pre-remediation)

Four co-existing schemes — `vX` (placeholder-looking), `vN` (sequential Omnify), `full-vN` (CPG Labs full), `claude-control-vN` (CPG Labs full after Claude Control API shipped) — with no git-SHA link and no enforced monotonicity. Post-remediation scheme: `<tag_prefix>-<yyyymmdd>-<short-sha>`, enforced by the deploy script guard. See [deploy-runbook.md](deploy-runbook.md).

### Terraform state drift

`terraform.tfstate` is checked into git today (`infra/terraform/terraform.tfstate`). Phase 8 of the remediation plan migrates this to an S3 backend with DynamoDB locking (`cpg-labs-terraform-state` bucket, `cpg-labs-terraform-locks` table). Until then, Terraform state is a single-writer file — only one person applies at a time, and `terraform.tfstate` diffs in PRs must be reviewed carefully.

The state used to reference the old `omnify-cluster` resource (`aws_ecs_cluster.app` with `name = "${local.name_prefix}-cluster"`) while the live cluster is `cpg-labs` (no `-cluster` suffix). Reconciled via `terraform state rm` + `terraform import` in Phase 5 of the plan.

## Cross-references

- Project conventions and hard rules: [CLAUDE.md](../CLAUDE.md)
- Deploy scenarios and runbook: [docs/deploy-runbook.md](deploy-runbook.md)
- Adding a new Shopify app: [docs/adding-a-new-app.md](adding-a-new-app.md)
- Per-feature sync architecture (webhooks, crons, canonical tables): [docs/data-sync-architecture.md](data-sync-architecture.md)
- Carrier service integrations: [docs/carrier-services.md](carrier-services.md)
