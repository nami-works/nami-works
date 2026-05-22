# infra/fulfillment — Rota Local AWS infrastructure

This directory provisions AWS infra for the Rota Local 3PL service
(`apps/fulfillment`). Mirrors `infra/connector/` conventions.

## What's here today

- `main.tf` — provider + Terraform version
- `variables.tf` — inputs (region, SSM prefix, sharing toggles)
- `ecr.tf` — ECR repository `nami-works-fulfillment` + 10-image lifecycle
- `iam.tf` — task-execution role (SSM-read on `/nami-works/fulfillment/*`) +
  app role (SSM-read on `/nami-works/fulfillment/tenants/*`)
- `cloudwatch.tf` — `/ecs/nami-works-fulfillment` log group
- `outputs.tf` — ECR URL + role ARNs + log group name (for the deploy script)

## What's NOT here yet (open decisions — gated on Lucas review)

These `.tf` files exist for `infra/connector/` but are deliberately omitted
here. Each one wraps a product/strategy decision that the CTO contract says I
escalate before laying down.

| Missing file | Decision needed |
|---|---|
| `rds.tf` | Share connector's existing RDS instance with a new logical DB `nami_works_fulfillment`, or provision a separate instance? `variables.tf` has `rds_shared_with_connector = true` as my recommendation. Sharing is cheaper, smaller blast radius for the v0; separate isolates scaling later. |
| `ecs.tf` | Share the existing `cpg-labs` ECS cluster, or provision a new cluster? Sharing matches connector's model. `variables.tf` has `ecs_cluster_name = "cpg-labs"` as the recommendation. |
| `alb.tf` | Add a host-based listener rule to the existing `omnify-alb` (cheap, fast) vs. provision a dedicated ALB. Connector rides the shared one. |
| `route53.tf` + `route53-records.tf` | What hostname? Candidates: `fulfillment.nami.works` (internal name, technical), `rota-local.nami.works` (customer brand), `api.rota-local.com.br` (if Rota Local gets its own domain). |
| `acm.tf` | Cert provisioned once Route53 decision settles. |

## How to apply (when ready)

```powershell
cd infra/fulfillment
terraform init
terraform plan -out tfplan
# Review the plan output, then:
terraform apply tfplan
```

**Do not `terraform apply` until the missing `.tf` files above are written.**
The current state would create an empty ECR + IAM roles + a log group — none
of those are dangerous, but they also don't run a service. Wait until the
ECS/ALB/RDS/Route53 set is complete and reviewed.

## Naming convention

All resources prefixed `nami-works-fulfillment-*` (mirrors connector's
`nami-works-*`). The `nami-works-` prefix is the internal/repo identity; the
customer-facing "Rota Local" brand never appears in AWS resource names.

## Cost note

Sharing RDS + ALB + ECS cluster with connector means the marginal monthly
cost of this app is approximately:

- ECR storage: ~$0.10/GB-month (10-image cap keeps this <$1/month)
- ECS Fargate task (256 CPU / 512 MB, 24/7): ~$8/month
- CloudWatch logs: ~$0.50/GB ingested + storage at retention

Plus whatever the new logical DB usage adds to connector's existing RDS bill
(minimal at v0 volumes).

If the sharing decisions flip to separate-instance, add roughly:
- Dedicated `db.t4g.micro` RDS: ~$13/month
- Dedicated ALB: ~$22/month
