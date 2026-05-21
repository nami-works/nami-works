## AWS Terraform Deployment (ECS Fargate + RDS Postgres)

This Terraform config provisions the core AWS infrastructure for Omnify:
- ECS Fargate service behind an ALB
- RDS PostgreSQL
- ECR repository
- CloudWatch logs
- SSM parameters for secrets

### Prerequisites
- AWS CLI configured with access to the target account.
- Terraform installed (>= 1.5).
- An ACM certificate already issued for `omnify.cpg-labs.io` in the same region.

### Setup
1. Copy `terraform.tfvars.example` to `terraform.tfvars` and fill values.
2. Run:
   - `terraform init`
   - `terraform plan`
   - `terraform apply`

### After Apply
- Use the output `alb_dns_name` to create a CNAME record in GoDaddy for `omnify.cpg-labs.io`.
- Build and push your Docker image to the `ecr_repository_url` output.
- Update the ECS service by re-running `terraform apply` with the `image_tag` updated.

### Notes
- This uses the default VPC and subnets. For production hardening, move to private subnets and add NAT.
- Secrets are stored as SecureString SSM parameters. Rotate as needed.

### Deploying Omnify | Custom (custom app at /full)
Host the custom app at **omnify.cpg-labs.io/full** on the same ALB. See **[DEPLOY-GEBEAUTY-SUBPATH.md](./DEPLOY-GEBEAUTY-SUBPATH.md)**.
