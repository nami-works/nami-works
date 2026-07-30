# nami.works — public site infra (S3 + CloudFront)

Provisions the hosting for `nami/site` (static Astro build). Deliberately
its own Terraform root module — separate from `infra/connector` (the MCP
gateway's ECS/RDS/ALB stack) and `infra/omnify/terraform` (the CPG Labs/Omnify
family's stack) — because this is a NAMI-Works-level asset with its own
lifecycle, not part of either product's infrastructure.

## What already exists (reused, not created by this module)

- **Route53 zone for `nami.works`** — owned by `infra/connector/route53.tf`,
  already delegated (real DNS resolution works). This module only reads it
  via a data source and adds its own `A`/`AAAA` alias records — no ownership
  conflict, no changes to the connector's state.
- **ACM certificate** covering `nami.works` + `*.nami.works` (us-east-1,
  `ISSUED`, currently unused since the old `mcp.nami.works` CloudFront/ALB
  listener was retired) — reused via a data lookup. No new cert request, no
  DNS validation roundtrip needed.
- **Terraform state backend** — reuses the existing
  `cpg-labs-terraform-state` S3 bucket + `cpg-labs-terraform-locks` DynamoDB
  table (see `infra/omnify/terraform/backend.tf` for how that pair was
  bootstrapped) under a distinct state key
  (`nami-works/nami-site/terraform.tfstate`) so this module's state never
  touches the omnify or connector state files.

## What this module creates

- S3 bucket (private, versioned, SSE-encrypted, 30-day noncurrent-version
  lifecycle) holding the static build output.
- CloudFront distribution (OAC to the bucket, security headers policy,
  clean-URL rewrite function, `nami.works` as the sole alias, PriceClass_100).
- Route53 `A` + `AAAA` alias records pointing the apex `nami.works` at the
  distribution.

## Setup

```bash
cd nami/site/infra/terraform
terraform init
terraform plan
terraform apply
```

No `terraform.tfvars` needed — every variable has a sensible default
(`variables.tf`). Override only if the bucket name collides globally or the
domain changes.

## After apply

- `terraform output site_cloudfront_domain_name` — smoke-test this
  `*.cloudfront.net` hostname directly before/independent of DNS (DNS is
  already wired by this same apply, but the edge hostname is useful for
  isolating CloudFront-vs-DNS issues).
- Deploy the actual site content with `scripts/deploy-nami-site.ps1` from the
  repo root — it builds `nami/site`, syncs `dist/` to the bucket, and
  invalidates the CloudFront cache, resolving the bucket name and
  distribution ID from this module's outputs automatically.

## Notes

- `www.nami.works` is NOT covered (no alias, cert does cover
  `*.nami.works` if it's ever wanted — add an alias entry + a second pair of
  Route53 records).
- Astro's `build.format: "file"` output (flat `.html` files) is why the
  CloudFront Function exists — see `cloudfront-functions/site-url-rewrite.js`.
