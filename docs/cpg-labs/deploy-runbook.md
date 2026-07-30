# Deploy Runbook — CPG Labs

Operator runbook for every deploy scenario. If you are about to touch AWS or ship an image, start here. For the why/what of the topology, see [docs/aws-topology.md](aws-topology.md).

## Principles

- **Production and `main` must stay in sync.** Anything shipped must be committed in the same session. See [CLAUDE.md](../CLAUDE.md) hard rules.
- **Terraform owns the task-def shape.** Env vars, secrets, CPU, memory, `extra_env` — all live in `infra/terraform/apps.tf` per-app module. The deploy script only swaps the image tag and registers a new revision.
- **One canonical cluster:** `cpg-labs`. Never run another.
- **`plan` before `apply`**, always. Never approve an `apply` whose plan wants to destroy something you did not explicitly ask for.

## Scenario 1 — Normal deploy

Ship a code change for one of the Shopify apps.

```powershell
./scripts/deploy.ps1 -App cpg-labs       # CPG Labs full app
./scripts/deploy.ps1 -App omnify         # Omnify focused app
./scripts/deploy.ps1 -App storytelling   # Storytelling app
```

What the script does (consolidated entry point, reads [scripts/apps.psd1](../scripts/apps.psd1)):

1. **Pre-flight assertions** (from [scripts/_deploy-common.psm1](../scripts/_deploy-common.psm1)):
   - `Assert-CleanWorkingTree` — fails if `git status --porcelain` is non-empty. Commit or stash first. This exists because we have twice shipped uncommitted work via `COPY .` in the Dockerfile.
   - `Assert-NoSplitBrain` — enumerates ECS clusters, fails if any non-canonical cluster has `runningCount > 0`.
2. **Build** the Docker image with `--build-arg APP_NAME=<app>` and `--build-arg BASE_PATH=""` (post-consolidation — no subpath).
3. **Tag** as `<tag_prefix>-<yyyymmdd>-<short-sha>` (e.g. `cpg-labs-full-20260422-abcdef0`). Script rejects legacy `vN`, `full-vN`, `claude-control-vN` patterns.
4. **Push** to ECR (`477780048372.dkr.ecr.us-east-1.amazonaws.com/omnify-app:<tag>`).
5. **Register** a new task-def revision — copies env + secrets from the current live revision, only swaps the image URI. (Terraform owns the shape; deploy script never rewrites env/secrets.)
6. **Update** the ECS service to the new revision.
7. **Wait** for the service to reach steady state.
8. **Post-deploy check** — query the TG, assert exactly one distinct task-def revision is healthy. Hits `<health_url>` and expects `200 OK`.

### Verify after

```powershell
# Healthy targets (should be exactly one IP, newest task-def revision)
aws elbv2 describe-target-health `
  --target-group-arn <tg-arn> --region us-east-1

# Current service state
aws ecs describe-services `
  --cluster cpg-labs --services <service-name> --region us-east-1

# Tail logs
aws logs tail /ecs/<log-group> --since 5m --region us-east-1 --follow
```

Smoke-test the app in the browser (hard-refresh; look for `/full/full/...` or 401 blips — neither should occur).

## Scenario 2 — Rollback to a previous revision

If a deploy is broken, roll back before debugging.

```powershell
# List recent revisions
aws ecs list-task-definitions `
  --family-prefix <task-family> --status ACTIVE --sort DESC `
  --region us-east-1 | Select-Object -First 5

# Point the service at a previous revision
aws ecs update-service `
  --cluster cpg-labs `
  --service <service-name> `
  --task-definition <task-family>:<rev> `
  --region us-east-1

# Wait for steady state
aws ecs wait services-stable `
  --cluster cpg-labs --services <service-name> --region us-east-1
```

Rollback reaches steady state in ~2–3 minutes. After rollback, investigate in logs; do NOT re-deploy until root cause is understood and fixed.

## Scenario 3 — Emergency image pin

A bad image is live and blocking auth/users. You need to ship a hand-patched task def immediately, bypassing the normal build.

Pattern (mirrors what the main session did in task-def rev 238 to unblock auth during the split-brain incident):

```powershell
# 1. Describe the current broken revision
aws ecs describe-task-definition `
  --task-definition <task-family>:<current-rev> `
  --region us-east-1 > current.json

# 2. Edit current.json — swap the image URI to a known-good tag, strip non-registrable fields
#    (taskDefinitionArn, revision, status, requiresAttributes, compatibilities, registeredAt, registeredBy)

# 3. Register the patched revision
aws ecs register-task-definition `
  --cli-input-json file://current.json `
  --region us-east-1

# 4. Point the service at the new revision
aws ecs update-service `
  --cluster cpg-labs --service <service-name> `
  --task-definition <task-family>:<new-rev> `
  --region us-east-1
```

After the emergency patch lands, **commit the equivalent Terraform change** (image tag pin, env var fix, whatever the patch was) within the same session. Uncommitted emergency patches drift production from `main` — exactly the condition CLAUDE.md's hard rule forbids.

## Scenario 4 — Adding a new env var

1. Open [infra/terraform/apps.tf](../infra/terraform/apps.tf) (or `ecs.tf` / `gebeauty.tf` until Phase 6 of the remediation plan lands).
2. Add to the `extra_env` list on the relevant `module "<app>"` block:
   ```hcl
   extra_env = [
     { name = "MY_NEW_VAR", value = "some-value" },
   ]
   ```
3. `cd infra/terraform && terraform plan`. Expected plan: updates `aws_ecs_task_definition.<app>` only.
4. **Watch for `lifecycle { ignore_changes = [container_definitions] }`.** Both `aws_ecs_task_definition.app` and `.gebeauty` carry this. Without `-replace`, `terraform apply` will see no drift and the env var will not reach the running task:
   ```powershell
   terraform apply -replace=aws_ecs_task_definition.gebeauty[0]   # CPG Labs full
   terraform apply -replace=aws_ecs_task_definition.app[0]         # Omnify focused
   ```
5. Redeploy via `./scripts/deploy.ps1 -App <name>` so the new revision is picked up by the service.
6. Verify in the task-def JSON:
   ```powershell
   aws ecs describe-task-definition --task-definition <task-family>:<rev> --region us-east-1 `
     | Select-String MY_NEW_VAR
   ```

## Scenario 5 — Adding a new SSM secret

1. Put the secret in SSM Parameter Store:
   ```powershell
   aws ssm put-parameter `
     --name /omnify/<APP>/<SECRET_NAME> `
     --type SecureString `
     --value "<secret-value>" `
     --region us-east-1
   ```
2. Reference it in Terraform on the relevant `module "<app>"` block (via the module's `secrets` variable). The module wires SSM → task-def `secrets` field automatically.
3. `terraform plan`, then `terraform apply` with `-replace` on the task def (same gotcha as Scenario 4).
4. Redeploy.
5. Verify the container can read it (the app will fail health-check if the SSM param is missing or the IAM task role lacks `ssm:GetParameters` on it).

**Never put secret values in Terraform inputs or commit them to the repo.** Terraform stores the SSM parameter *name*; SSM holds the value.

## Scenario 6 — Terraform apply discipline

Before any `terraform apply`:

1. **Run `terraform plan` and read every line.** Do not trust summaries.
2. **If the plan shows `destroy`:** STOP. Understand what will be destroyed. If it's a service, target group, listener rule, or cluster that you did not explicitly ask to destroy, the state is wrong — use `terraform state mv` or `terraform import` to re-anchor before applying. Destroying a live ECS service drops the service for ~60s minimum and drops all running tasks.
3. **If the plan shows `replace`:** understand whether in-place would work. Many AWS resources can be updated in place; Terraform chooses replace when an immutable attribute changes. Check the `# forces replacement` annotations.
4. **Apply with `-target=`** to scope down when you are iterating on one resource. `terraform apply -target=module.omnify.aws_ecs_task_definition.app`.
5. **After apply:** `terraform plan` again. Expected: `No changes.` If it still wants to do things, state is out of sync; investigate before moving on.
6. **Never apply from a dirty working tree.** `git status` in `infra/terraform/` should be clean (or show only the intended `.tf` changes) before apply.

## Scenario 7 — Split-brain alarms

Three CloudWatch alarms live in [infra/terraform/drift-alarms.tf](../infra/terraform/drift-alarms.tf). Each indicates a specific failure mode:

### Alarm A — Cluster drift (composite alarm)

Fires when both `omnify-cluster` and `cpg-labs` report `ClusterRunningTaskCount > 0` simultaneously.

**Meaning:** the old cluster is running tasks again. Either someone scaled a service back up, or a deploy script regressed and targeted the old cluster.

**Actions:**
1. `aws ecs list-services --cluster omnify-cluster --region us-east-1` — which service is up?
2. Scale it to 0: `aws ecs update-service --cluster omnify-cluster --service <name> --desired-count 0 --region us-east-1`.
3. `git log scripts/deploy-*.ps1` — did a recent commit reintroduce `--cluster omnify-cluster`? If yes, revert.
4. `aws elbv2 describe-target-health` on both shared TGs — are stale-cluster IPs registered again? Deregister.

After Phase 4 of the remediation plan, `omnify-cluster` no longer exists; this alarm then fires only if someone recreates it manually, which should never happen.

### Alarm B — Target-group cross-cluster membership

Lambda (5-min schedule) lists healthy TG targets, resolves each IP → ENI → task → cluster. Fires if any single TG has healthy members in more than one cluster.

**Meaning:** a TG is dual-registered. This is the exact condition that caused the 2026-04-22 split-brain incident — users get round-robined across two different code versions.

**Actions:**
1. Identify the TG: alarm description names it.
2. `aws elbv2 describe-target-health --target-group-arn <arn> --region us-east-1` — list healthy IPs.
3. For each IP, resolve to cluster (`aws ec2 describe-network-interfaces --filters Name=addresses.private-ip-address,Values=<ip>`).
4. Deregister the stale-cluster IP: `aws elbv2 deregister-targets --target-group-arn <arn> --targets Id=<ip>,Port=3000 --region us-east-1`.
5. Investigate how the stale-cluster task got registered — usually `migrate-cluster.ps1` ran, or a deploy script targeted the wrong cluster.

### Alarm C — Task-def revision drift

Same Lambda checks each service family. Fires if more than one distinct task-def revision is healthy for a single service name.

**Meaning:** a rolling deploy stalled (old and new revision both healthy), OR two clusters are running the same service with different revisions.

**Actions:**
1. `aws ecs describe-services --cluster cpg-labs --services <service> --region us-east-1` — check `deployments`. If there's a `PRIMARY` and an `ACTIVE`, the deploy is mid-flight; wait a few minutes and re-check.
2. If stuck: `aws ecs update-service --force-new-deployment --cluster cpg-labs --service <service>` to restart the rollout.
3. If the two revisions are across two clusters, see Alarm A.

## Reference: today → post-consolidation resource names

| Today | Post-consolidation (Phase 6) |
|---|---|
| `omnify-service` (cluster `cpg-labs`) | `cpg-labs-omnify-service` |
| `omnify-gebeauty-service` | `cpg-labs-full-service` |
| `omnify-task` | `cpg-labs-omnify-task` |
| `omnify-gebeauty-task` | `cpg-labs-full-task` |
| `omnify-tg` | `cpg-labs-omnify-tg` |
| `omnify-gebeauty-tg` | `cpg-labs-full-tg` |
| `/ecs/omnify-gebeauty` (log group) | `/ecs/cpg-labs-full` |
| Hostname: `omnify.cpg-labs.io/full/*` | `app.cpg-labs.io` |

Both names will appear in logs and historical scripts for a while; the rename happens via `terraform state mv`, not destroy+create.

## Cross-references

- Topology and rationale: [docs/aws-topology.md](aws-topology.md)
- Adding a new Shopify app: [docs/adding-a-new-app.md](adding-a-new-app.md)
- Project rules and hard constraints: [CLAUDE.md](../CLAUDE.md)
- Raw investigation (2026-04-22): [inputs/aws-account-audit.md](../inputs/aws-account-audit.md)
