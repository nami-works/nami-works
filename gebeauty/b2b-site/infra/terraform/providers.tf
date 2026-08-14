terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# CloudFront requires the ACM certificate and the distribution itself to be
# managed from us-east-1 regardless of where traffic actually lands. The S3
# bucket has no meaningful region requirement, so it stays in the same region
# for simplicity (matches nami/site/infra and infra/omnify/terraform's
# convention).
provider "aws" {
  region = var.aws_region
}
