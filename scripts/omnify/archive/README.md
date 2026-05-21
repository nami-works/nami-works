# scripts/archive/

This directory holds retired deploy/migration scripts. **Do not run anything in here.**
They are kept for audit trail and to document what the current consolidated
flow replaced.

## Migration history

On 2026-04-22 the CPG Labs AWS account was carrying two parallel ECS clusters
(`omnify-cluster` legacy + `cpg-labs` new) with duplicate services registered
against shared ALB target groups — the "split-brain" incident. Traffic was
round-robining between stale and current code, producing intermittent nav,
auth, and `/full/full/...` bugs that no code-level fix could eliminate.

The remediation plan (`.claude/plans/i-think-my-latest-eventual-sutton.md`)
collapses everything under a single canonical cluster (`cpg-labs`), a single
Terraform module (`modules/shopify-app/`), and a single deploy entry point
(`scripts/deploy.ps1` reading `scripts/apps.psd1`). Phases 6–7 archive the
old per-service scripts.

## What lives here

### `migrate-cluster.ps1` — one-shot migration, NEVER run again

This is the script that performed the original cluster migration. It creates
a new cluster, recreates each service against it, and (only after a manual
`yes` confirmation in step 5) drains + deletes the old cluster. The
confirmation step was never run in the original migration window, which is
how the split-brain state was created.

Re-running this script against today's AWS state would create a *third*
cluster and recreate services against it — guaranteeing a worse split-brain.
If a future migration is ever needed, write a new one-shot script, don't
resurrect this.

Reference: `scripts/deploy-queue.md` entry documenting the Phase 1/2/4/5
AWS remediation and the Phase 7 script consolidation.

### `deploy-cpg-labs.ps1`, `deploy-omnify.ps1`, `deploy-storefront.ps1` — superseded

The three per-app deploy scripts, each ~280 lines and ~80% identical.
Replaced by the single `scripts/deploy.ps1 -App <name>` entry point plus the
`scripts/apps.psd1` manifest.

Key behavior change: the in-script Python "reconcile secrets from SSM" block
(present in `deploy-cpg-labs.ps1:200-221`) is gone. Terraform now owns the
task-def `secrets[]` field per-service via the shared module; the deploy
script only registers a new revision with the new image tag and copies
env + secrets from the previous revision verbatim. This removes the root
cause of the 2026-04-18 SHOPIFY_API_KEY mis-mapping that first exposed the
split-brain symptoms.

**Do not reintroduce these scripts.** If a feature seems missing from
`scripts/deploy.ps1`, extend that file — don't bring back per-service
copy-paste.

### `deploy-cpg-labs-creds.ps1`, `deploy-omnify-creds.ps1` — superseded

Credential-only deploy helpers. These used to write Shopify API key/secret
pairs into SSM before a code deploy. Terraform now manages SSM parameters
declaratively via the shared `modules/shopify-app/` module + `terraform.tfvars`,
so a credential change is a `terraform apply` rather than a script run.

### `deploy-ecr.ps1` — superseded

Generic ECR build/tag/push helper. `scripts/deploy.ps1` performs ECR login,
build, and push inline (with NoCache + retry behavior); the standalone helper
became unused after Phase 7. Kept for reference if a manual ECR push is ever
needed outside the consolidated deploy flow.

### `health-check.ps1` — defaulted to deleted resources

Hard-coded `$Cluster = "omnify-cluster"` (deleted in Phase 4) and
`$Service = "omnify-gebeauty-service"` (deleted in Phase 6j). Running it
post-Phase-6j would just error. The CloudWatch alarms in
`infra/terraform/delivery-alarms.tf` cover the same observability surface
declaratively against the live `omnify-full` service.

## How deploys work today

```
./scripts/deploy.ps1 -App full         # CPG Labs full app (app.cpg-labs.io)
./scripts/deploy.ps1 -App omnify       # Omnify focused app (omnify.cpg-labs.io)
./scripts/deploy.ps1 -App storytelling # Story-telling (storytelling.cpg-labs.io)
```

Adding a new app: `./scripts/new-app.ps1 -Name <slug> -Domain <host> -Identity <id>`.
See `docs/adding-a-new-app.md` (written by the `docs` subagent).
