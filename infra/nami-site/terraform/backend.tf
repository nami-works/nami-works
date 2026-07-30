# Terraform state backend.
#
# Reuses the EXISTING cpg-labs-terraform-state bucket + cpg-labs-terraform-locks
# DynamoDB table (already versioned, AES-256 encrypted, public-access-blocked,
# lock-protected — see infra/omnify/terraform/backend.tf for how it was
# bootstrapped). This module gets its own state file via a distinct key, so it
# shares no state with the omnify/CPG-Labs stack or the connector stack — no
# new bootstrap bucket/table needed for a single small static-site module.
#
# After this file lands, run `terraform init` once from this directory.

terraform {
  backend "s3" {
    bucket         = "cpg-labs-terraform-state"
    key            = "nami-works/nami-site/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "cpg-labs-terraform-locks"
    encrypt        = true
  }
}
