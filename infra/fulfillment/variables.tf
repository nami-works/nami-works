variable "region" {
  type        = string
  default     = "us-east-1"
  description = "AWS region. Matches connector + omnify."
}

variable "ssm_prefix" {
  type        = string
  default     = "/nami-works/fulfillment"
  description = "SSM Parameter Store prefix for per-tenant secrets (bearer tokens, HMAC keys, LD control tokens). Tasks have read-only IAM scoped to this prefix."
}

variable "log_retention_days" {
  type    = number
  default = 30
}

# ---- TODOs requiring product/strategy review (see README.md § Open decisions) ----
# These variables exist but the ECS / ALB / RDS / Route53 .tf files that consume
# them have NOT been written yet. Pinned here so the next infra PR can wire them
# without re-thinking the inputs.

variable "ecs_cluster_name" {
  type        = string
  default     = "cpg-labs"
  description = "If sharing the existing cluster (likely yes), use 'cpg-labs'. Otherwise provision a new cluster in ecs.tf."
}

variable "rds_shared_with_connector" {
  type        = bool
  default     = true
  description = "If true, create only a new logical database on connector's existing RDS instance. If false, provision a new RDS instance for fulfillment."
}

variable "task_cpu" {
  type    = string
  default = "256"
}

variable "task_memory" {
  type    = string
  default = "512"
}
