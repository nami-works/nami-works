variable "aws_region" {
  description = "AWS region for the S3 bucket and (mandatorily, for CloudFront/ACM) the provider itself."
  type        = string
  default     = "us-east-1"
}

variable "domain" {
  description = "Subdomain served by this site. gebeauty.com.br's DNS is at registro.br (NOT Route53), so unlike nami.works this module cannot manage DNS records itself -- see README for the manual registro.br steps."
  type        = string
  default     = "b2b.gebeauty.com.br"
}

variable "bucket_name" {
  description = "S3 bucket holding the two static decks. Must be globally unique."
  type        = string
  default     = "b2b-gebeauty-site"
}

variable "basic_auth_username" {
  description = "Shared Basic Auth username for the CloudFront access gate. Not a real authz boundary -- these are unlisted sell-in decks, per the migration handoff's 'light access gate' decision."
  type        = string
  sensitive   = true
}

variable "basic_auth_password" {
  description = "Shared Basic Auth password for the CloudFront access gate. Pass via TF_VAR_basic_auth_password or a gitignored *.auto.tfvars -- never commit plaintext."
  type        = string
  sensitive   = true
}
