terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }

  # Local state, same as infra/connector/. Upgrade to S3+DynamoDB backend
  # when fulfillment has a second operator. terraform.tfstate* is gitignored.
}

provider "aws" {
  region = var.region
}

data "aws_caller_identity" "current" {}
