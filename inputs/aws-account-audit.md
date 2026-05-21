# AWS Account Audit — 2026-04-22

Account: `477780048372` (us-east-1). IAM user: `cpg-labs`.
Performed while setting up NAMI Works infra; found an unexpected
condition in the CPG Labs side of the shared account that warrants
action.

## TL;DR

The ECS side of this account runs **two clusters** — `omnify-cluster`
(older) and `cpg-labs` (newer) — with **the same two services
duplicated in each**. Both duplicate services are registered in the
ALB target groups and serve live production traffic concurrently. The
task definitions reference **different image tags**, so production
requests for `www.cpg-labs.io` and `*/full/*` are being load-balanced
across two meaningfully-different versions of the app. This is a
silent production risk, not a cost quirk.

NAMI Works is unaffected — its service runs only in the `cpg-labs`
cluster with its own target group (`nami-works-gw`) bound to a single
listener rule for `mcp.nami.works`.

## What's actually live

### Services and task definitions

| Cluster | Service | Desired / Running | Task def | Image tag | Registered |
|---|---|---|---|---|---|
| `omnify-cluster` | `omnify-service` | 1 / 1 | `omnify-task:31` | `omnify-app:vX` | 2026-04-18 |
| `omnify-cluster` | `omnify-gebeauty-service` | 1 / 1 | `omnify-gebeauty-task:225` | `omnify-app:full-v36` | 2026-04-18 |
| `cpg-labs` | `omnify-service` | 1 / 1 | `omnify-task:38` | `omnify-app:v9` | 2026-04-20 |
| `cpg-labs` | `omnify-gebeauty-service` | 1 / 1 | `omnify-gebeauty-task:247` | `omnify-app:claude-control-v18` | 2026-04-22 |
| `cpg-labs` | `nami-works-gateway` | 1 / 1 | `nami-works-gateway:2` | `…nami-works:<sha>` | 2026-04-22 |

Note the image tags for the duplicated services are **not the same
build**:

- `omnify-service`: `vX` (placeholder-looking) vs `v9` (sequential).
- `omnify-gebeauty-service`: `full-v36` vs `claude-control-v18` —
  these read like entirely different branches or feature streams,
  not sequential releases.

### ALB listener rules (`omnify-alb:443`)

| Priority | Host/Path | Target group | Registered targets |
|---|---|---|---|
| 2 | `cpg-labs.io` | (redirect → `https://www.cpg-labs.io`) | — |
| 3 | `www.cpg-labs.io` | `omnify-tg` | 2 IPs |
| 10 | path `/full`, `/full/*` | `omnify-gebeauty-tg` | 2 IPs |
| 500 | `mcp.nami.works` | `nami-works-gw` | 1 IP |
| default | (anything else) | `omnify-tg` | 2 IPs |

### Target-group → task correlation

| Target IP | Cluster | Service | Task def |
|---|---|---|---|
| `172.31.30.98` (in `omnify-tg`) | `omnify-cluster` | `omnify-service` | `:31` (`vX`) |
| `172.31.43.56` (in `omnify-tg`) | `cpg-labs` | `omnify-service` | `:38` (`v9`) |
| `172.31.0.233` (in `omnify-gebeauty-tg`) | `omnify-cluster` | `omnify-gebeauty-service` | `:225` (`full-v36`) |
| `172.31.18.183` (in `omnify-gebeauty-tg`) | `cpg-labs` | `omnify-gebeauty-service` | `:247` (`claude-control-v18`) |
| `172.31.94.210` (in `nami-works-gw`) | `cpg-labs` | `nami-works-gateway` | `:2` (today) |

Both ALB target groups have one IP from each cluster. Every request
to `www.cpg-labs.io` round-robins between `vX` and `v9`. Every
`/full/*` request round-robins between `full-v36` and
`claude-control-v18`.

## What this means in practice

1. **Production inconsistency.** Every other request hits a different
   codebase version. If those versions diverged on bug fixes,
   features, or DB-schema assumptions, users see flapping behavior
   and it's nearly impossible to reproduce bugs ("works for me" vs
   "reliably broken for me" split by which backend answered).
2. **Deploy ambiguity.** When you run `scripts/deploy-omnify.ps1`,
   which cluster does it target? If only one, the other cluster is
   running stale code indefinitely, and fixes you think shipped are
   only live for 50% of users. If both, the script should be
   rewritten to make that explicit.
3. **Cost of the duplicates.** Two extra Fargate tasks at 256 CPU /
   512 MB ≈ **~$20-25/mo** of unnecessary spend. Not the main
   concern, but worth reclaiming.
4. **Rollback is broken.** If a bad `cpg-labs` deploy ships, rolling
   back the `cpg-labs` service doesn't revert the `omnify-cluster`
   copy (which may still have the OLD code that "worked"). You get a
   partial rollback, which is worse than either state.

## Recommended remediation

A safe sequence, cheapest step first, most destructive step last.
Run the commands from a machine with AWS CLI + the `cpg-labs` IAM
credentials that already exist on this laptop.

### Step 1 — confirm which image tag you intend to be live (5 minutes)

Decide, per service, which cluster is "right." The heuristic:
`cpg-labs` is newer across the board (revisions 38, 247; registered
2 and 0 days ago), and `omnify-cluster` is older (revisions 31, 225,
registered 4 days ago). Assuming `cpg-labs` is canonical:

- Canonical `omnify-service` image: `omnify-app:v9` (task def `:38`).
- Canonical `omnify-gebeauty-service` image: `omnify-app:claude-control-v18`
  (task def `:247`).

Verify by checking your deploy script
(`..\cpg-labs\scripts\deploy-omnify.ps1`): which cluster does it
target with `aws ecs update-service --cluster ...`? That's the
canonical cluster.

### Step 2 — deregister `omnify-cluster` tasks from the target groups (2 minutes, reversible in seconds)

This removes `omnify-cluster` task IPs from the ALB target groups so
they stop receiving new traffic, without stopping the tasks. If
anything breaks, re-register them and you're back to the split-brain
state. Low-risk.

```powershell
# Deregister omnify-cluster/omnify-service IP from omnify-tg
aws elbv2 deregister-targets `
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:477780048372:targetgroup/omnify-tg/5960ead268e4864c `
  --targets Id=172.31.30.98,Port=3000

# Deregister omnify-cluster/omnify-gebeauty-service IP from omnify-gebeauty-tg
aws elbv2 deregister-targets `
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:477780048372:targetgroup/omnify-gebeauty-tg/dc1496da5df89eba `
  --targets Id=172.31.0.233,Port=3000
```

**Verify:** wait 60 seconds, then:

```powershell
aws elbv2 describe-target-health `
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:477780048372:targetgroup/omnify-tg/5960ead268e4864c
```

Should show only `172.31.43.56` as healthy. Run the same for
`omnify-gebeauty-tg` expecting only `172.31.18.183`.

### Step 3 — scale `omnify-cluster` services to 0 (5 minutes, still reversible)

With no traffic reaching them, stop the tasks:

```powershell
aws ecs update-service --cluster omnify-cluster `
  --service omnify-service --desired-count 0

aws ecs update-service --cluster omnify-cluster `
  --service omnify-gebeauty-service --desired-count 0
```

The service definitions remain in case you want to scale them back
up quickly. At this point you've stopped paying for the duplicates.
Leave like this for a few days and watch `www.cpg-labs.io` / `/full/*`
error rates and behavior — if nothing breaks, you've confirmed
`cpg-labs` is the canonical cluster.

### Step 4 — delete the services and cluster (final, destructive)

Once you're confident (days, not hours):

```powershell
aws ecs delete-service --cluster omnify-cluster --service omnify-service
aws ecs delete-service --cluster omnify-cluster --service omnify-gebeauty-service
aws ecs delete-cluster --cluster omnify-cluster
```

The cluster is empty at this point, so deletion is trivial.

### Step 5 — audit your deploy scripts

In the CPG Labs repo, search `scripts/` for every `--cluster` flag
and confirm they all name `cpg-labs`. If any still reference
`omnify-cluster`, fix them and commit. This prevents the split-brain
from regenerating on the next deploy.

Also audit Terraform state in the CPG Labs repo for the old cluster
— if Terraform still manages `aws_ecs_cluster.omnify_cluster`, remove
the resource block (or move it out of state) before the next apply.

## Open questions you should answer before remediating

1. **Is `cpg-labs` actually your canonical cluster?** My inference
   rests on "more recent revisions and registration dates." Check
   your deploy script before committing to this.
2. **What do the image tags mean?** `vX` vs `v9` vs `full-v36` vs
   `claude-control-v18` — are these branches, features, broken
   states, manual uploads? Knowing the tag scheme tells you whether
   the split was an accident or a half-finished dual-track deploy.
3. **Are there dependents on the old cluster** besides the ECS
   services? CloudWatch alarms bound to the cluster name, IAM roles
   with cluster-scoped ARNs, etc. `aws iam list-roles` + grep for
   `omnify-cluster` would surface any. I didn't check this yet.

## What I found for NAMI Works

All green, no concerns:

- `nami-works-gateway:2` is deployed on `cpg-labs` cluster.
- `nami-works-gw` target group has one healthy IP (`172.31.94.210`).
- Listener rule priority 500 correctly routes `mcp.nami.works` →
  `nami-works-gw`.
- Dedicated RDS, dedicated SSM namespace — no shared state with CPG
  Labs.

NAMI Works is isolated from whatever decision you make about the
CPG Labs duplicates.

## Commands used for this audit (all read-only)

```powershell
aws ecs list-clusters
aws ecs list-services --cluster <name>
aws ecs describe-services --cluster <name> --services <svc>
aws ecs describe-task-definition --task-definition <family:rev>
aws ecs list-tasks --cluster <name> --service-name <svc>
aws ecs describe-tasks --cluster <name> --tasks <arns>
aws elbv2 describe-load-balancers
aws elbv2 describe-listeners --load-balancer-arn <arn>
aws elbv2 describe-rules --listener-arn <arn>
aws elbv2 describe-target-groups
aws elbv2 describe-target-health --target-group-arn <arn>
aws logs describe-log-groups --log-group-name-prefix /ecs/
aws logs describe-log-streams --log-group-name <name> --order-by LastEventTime --descending
```
