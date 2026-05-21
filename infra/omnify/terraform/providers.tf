terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    # archive is consumed by infra/terraform/drift-alarms.tf to zip the
    # drift-check Lambda source. Kept here (the single required_providers
    # block) per Terraform's constraint that required_providers can only
    # appear once per module.
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}
