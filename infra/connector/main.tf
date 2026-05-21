terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Local state for the solo-operator phase. Upgrade to S3+DynamoDB backend
  # when you onboard a second engineer or CI. Keep terraform.tfstate* out of
  # git (see .gitignore in this directory).
}

provider "aws" {
  region = var.region
}

data "aws_caller_identity" "current" {}
