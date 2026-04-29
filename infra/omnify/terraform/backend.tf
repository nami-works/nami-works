# Terraform state backend.
#
# State lives in S3 with versioning + AES-256 server-side encryption + public-
# access-block. State-locking via a DynamoDB table prevents concurrent
# `terraform apply` from corrupting state. Bucket and table were bootstrapped
# manually (chicken-and-egg — Terraform can't create the resources that hold
# its own state).
#
# Bootstrap commands (one-shot, already run 2026-04-28):
#   aws s3api create-bucket --bucket cpg-labs-terraform-state --region us-east-1
#   aws s3api put-bucket-versioning --bucket cpg-labs-terraform-state \
#     --versioning-configuration Status=Enabled
#   aws s3api put-bucket-encryption --bucket cpg-labs-terraform-state \
#     --server-side-encryption-configuration \
#       '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
#   aws s3api put-public-access-block --bucket cpg-labs-terraform-state \
#     --public-access-block-configuration \
#       "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
#   aws dynamodb create-table --table-name cpg-labs-terraform-locks \
#     --attribute-definitions AttributeName=LockID,AttributeType=S \
#     --key-schema AttributeName=LockID,KeyType=HASH \
#     --billing-mode PAY_PER_REQUEST --region us-east-1
#
# After this file lands, run `terraform init -migrate-state` once to upload the
# local terraform.tfstate to S3. Then delete `terraform.tfstate*` from the
# working tree (already in .gitignore so they shouldn't recur).

terraform {
  backend "s3" {
    bucket         = "cpg-labs-terraform-state"
    key            = "cpg-labs/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "cpg-labs-terraform-locks"
    encrypt        = true
  }
}
