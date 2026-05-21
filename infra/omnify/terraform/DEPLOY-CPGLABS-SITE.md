# Deploy cpg-labs.io Marketing Website

The marketing website is served by the same ECS service as the Omnify app.
Public routes (`/`, `/pricing`, `/about`, `/contact`, `/terms`, `/security`, `/privacy`)
don't require Shopify auth.

## Prerequisites

### 1. ACM Certificate
Request a certificate in AWS ACM (us-east-1) covering:
- `cpg-labs.io`
- `www.cpg-labs.io`

Validate via DNS (add the CNAME records ACM provides to GoDaddy).

### 2. Update terraform.tfvars
```hcl
site_certificate_arn = "arn:aws:acm:us-east-1:477780048372:certificate/<new-cert-id>"
```

### 3. Apply Terraform
```bash
cd infra/terraform
terraform plan
terraform apply
```

This adds:
- The new SSL cert to the ALB HTTPS listener
- A listener rule routing `cpg-labs.io` to the omnify target group
- A 301 redirect from `www.cpg-labs.io` to `cpg-labs.io`

### 4. DNS in GoDaddy
Add these records:
- `cpg-labs.io` -- CNAME to ALB DNS name (or use ALIAS/ANAME if GoDaddy supports it for apex)
- `www.cpg-labs.io` -- CNAME to ALB DNS name

Note: GoDaddy doesn't support ALIAS records for apex domains. Options:
- Use GoDaddy's domain forwarding for the apex to www, then CNAME www to ALB
- Or transfer DNS to Route53/Cloudflare which support ALIAS/CNAME flattening
