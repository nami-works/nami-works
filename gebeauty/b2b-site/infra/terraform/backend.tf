# Terraform state backend.
#
# Reuses the EXISTING cpg-labs-terraform-state bucket + cpg-labs-terraform-locks
# DynamoDB table (see infra/omnify/terraform/backend.tf for how it was
# bootstrapped; nami/site/infra/terraform/backend.tf does the same). This
# module gets its own state file via a distinct key, so it shares no state
# with any other stack -- no new bootstrap bucket/table needed for a single
# small static-site module.
#
# After this file lands, run `terraform init` once from this directory.

terraform {
  backend "s3" {
    bucket         = "cpg-labs-terraform-state"
    key            = "gebeauty/b2b-site/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "cpg-labs-terraform-locks"
    encrypt        = true
  }
}
