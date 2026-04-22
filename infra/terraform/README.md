# NAMI Works — Terraform

Infrastructure for the NAMI Works MCP gateway. Runs alongside CPG Labs in
the same AWS account, reuses the `omnify-alb` and `cpg-labs` ECS cluster,
owns its own ECR repo, RDS Postgres, task role, and `*.nami.works` cert.

State: **local** (`terraform.tfstate` on the operator laptop). Upgrade to
S3 + DynamoDB backend when you onboard a second operator or CI.

## First apply — order matters (the email-safe sequence)

Current state: `nami.works` DNS is served by **GoDaddy**. Email uses
Google Workspace MX records, an SPF TXT (currently via GoDaddy's "SPF
flattening" service), a Google site-verification TXT, and a strict
DMARC policy. All of those are mirrored in `route53-records.tf` so
they exist in Route 53 *before* we ask resolvers to use Route 53.

```powershell
cd infra/terraform
terraform init

# 1. Stage the DNS zone + email-critical records in Route 53. Nothing in
#    the world queries them yet (NS pointer still at GoDaddy).
terraform apply `
  -target=aws_route53_zone.main `
  -target=aws_route53_record.mx `
  -target=aws_route53_record.apex_txt `
  -target=aws_route53_record.dmarc

terraform output route53_name_servers
```

Copy the four `ns-###.awsdns-##.*` values. Open GoDaddy → Domains →
`nami.works` → DNS / Nameservers → "Usar nameservers personalizados" →
paste all four → Salvar. Wait 15-30 minutes. Verify:

```powershell
nslookup -type=NS nami.works 8.8.8.8
# Should list the AWS NS records, not ns11/ns12.domaincontrol.com.

# Confirm email records resolve from Route 53:
nslookup -type=MX nami.works 8.8.8.8
nslookup -type=TXT nami.works 8.8.8.8
```

```powershell
# 2. Apply the rest. ACM validation blocks until delegation resolves;
#    first run can take 5-60 minutes. Subsequent runs are fast.
terraform apply
```

## Outputs to grab

- `ecr_repository_url` — `scripts/deploy.ps1` uses this.
- `ecs_cluster_name`, `ecs_service_name`, `task_definition_family` — deploy script.
- `cloudwatch_log_group` — `aws logs tail <group>` for post-deploy debugging.
- `mcp_hostname` — should print `mcp.nami.works`; the alias points at `omnify-alb`.
- `database_url_ssm_param` — the path the task reads its DSN from.

## First deploy

After `terraform apply` is green, the task will flap (the
`:bootstrap` image tag doesn't exist in ECR). Run
`scripts/deploy.ps1` to build + push + roll the service with a real
image.

## Schema migrations

Terraform doesn't run `prisma migrate deploy`. When the Prisma schema
changes, run it manually against the RDS endpoint from the operator
laptop. RDS is **not publicly accessible** — reach it via:

- **Short-term:** a one-off EC2 "bastion" or SSM Session Manager
  port-forward.
- **Longer-term:** wire a small "migration task" into the deploy
  script that runs before the service is updated.

## Resource inventory

| Resource | Type |
|---|---|
| `nami-works` | ECR repo |
| `nami-works-task-execution` / `nami-works-task-app` | IAM roles |
| `nami-works-ecs-task` / `nami-works-rds` | Security groups |
| `nami-works` | RDS `db.t4g.micro` (Postgres 16.4) |
| `/nami-works/app/database_url` | SSM SecureString (DSN) |
| `/ecs/nami-works-gateway` | CloudWatch log group |
| `nami.works` | Route 53 public hosted zone |
| MX / SPF / Google verify / DMARC | `aws_route53_record`, mirroring existing GoDaddy records |
| `mcp.nami.works` | A-record alias → `omnify-alb` |
| `*.nami.works` + `nami.works` SAN | ACM cert (DNS validated) |
| `nami-works-gw` | ALB target group |
| `omnify-alb:443` rule (priority 500) | Host `mcp.nami.works` → `nami-works-gw` |
| `nami-works-gateway` | ECS Fargate task definition + service |

## What's intentionally NOT mirrored from GoDaddy's DNS

- GoDaddy NS + SOA records (auto-replaced by Route 53's own).
- `_domainconnect` CNAME (GoDaddy-proprietary service discovery).
- `A @` pointing at GoDaddy's WebsiteBuilder (never resolved publicly).
- `CNAME www → nami.works` (only useful once apex resolves to a site;
  add back when you launch a marketing landing).
- GoDaddy's SPF flattening chain (`dc-…_spfm.nami.works`). The flattened
  value is literally `v=spf1 include:_spf.google.com ~all`, which we
  inline directly — identical semantics, no GoDaddy indirection.

## Known gotchas

- **Listener rule priority.** Default is 500. If CPG Labs already uses that
  slot, `terraform apply` fails. Bump `alb_listener_rule_priority` to the
  next free number.
- **Deletion protection.** RDS has `deletion_protection = true`. To destroy
  it, set to false and apply first, then destroy.
- **`final_snapshot_identifier = "nami-works-final"`.** If you destroy and
  recreate, Terraform will fail until you delete the prior snapshot manually.
