variable "aws_region" {
  description = "AWS region for the S3 bucket and (mandatorily, for CloudFront/ACM) the provider itself."
  type        = string
  default     = "us-east-1"
}

variable "domain" {
  description = "Apex domain served by this site. Must match a zone already delegated in Route53 and covered by an ISSUED ACM cert in us-east-1."
  type        = string
  default     = "nami.works"
}

variable "bucket_name" {
  description = "S3 bucket holding the static Astro build output. Must be globally unique."
  type        = string
  default     = "nami-works-site"
}

variable "lead_from_address" {
  description = "SES sending identity for lead-capture emails. Does not need to be a real receivable mailbox -- ReplyToAddresses is set per-message to the actual visitor's email, so a human hitting reply in their mail client replies to the lead, not to this address."
  type        = string
  default     = "leads@nami.works"
}

variable "lead_to_address" {
  description = "Where lead-capture form submissions are emailed. Must be an address covered by the verified nami.works domain identity."
  type        = string
  default     = "lucas@nami.works"
}
