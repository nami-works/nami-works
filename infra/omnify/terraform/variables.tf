variable "aws_region" {
  type        = string
  description = "AWS region for all resources."
  default     = "us-east-1"
}

variable "project_name" {
  type        = string
  description = "Project name prefix."
  default     = "omnify"
}

variable "domain_name" {
  type        = string
  description = "Public domain for the app."
  default     = "omnify.cpg-labs.io"
}

variable "acm_certificate_arn" {
  type        = string
  description = "ACM certificate ARN for the ALB HTTPS listener."
}

variable "app_port" {
  type        = number
  description = "Container port exposed by the app."
  default     = 3000
}

variable "image_tag" {
  type        = string
  description = "Docker image tag to deploy."
  default     = "latest"
}

variable "task_cpu" {
  type        = number
  description = "ECS task CPU units."
  default     = 512
}

variable "task_memory" {
  type        = number
  description = "ECS task memory in MiB."
  default     = 1024
}

variable "create_iam" {
  type        = bool
  description = "Whether to create IAM roles and policies."
  default     = true
}

variable "execution_role_arn" {
  type        = string
  description = "Existing ECS task execution role ARN (used when create_iam=false)."
  default     = ""
}

variable "task_role_arn" {
  type        = string
  description = "Existing ECS task role ARN (used when create_iam=false)."
  default     = ""
}

variable "create_ssm" {
  type        = bool
  description = "Whether to store secrets in SSM Parameter Store."
  default     = true
}

variable "db_name" {
  type        = string
  description = "Postgres database name."
  default     = "omnify"
}

variable "db_username" {
  type        = string
  description = "Postgres username."
  default     = "omnify"
}

variable "db_password" {
  type        = string
  description = "Postgres password."
  sensitive   = true
}

variable "create_rds" {
  type        = bool
  description = "Whether to create an RDS Postgres instance."
  default     = true
}

variable "database_url" {
  type        = string
  description = "Existing database URL (used when create_rds=false)."
  sensitive   = true
  default     = ""
}

variable "shopify_api_key" {
  type        = string
  description = "Shopify API key."
  sensitive   = true
}

variable "shopify_api_secret" {
  type        = string
  description = "Shopify API secret."
  sensitive   = true
}

variable "shopify_app_url" {
  type        = string
  description = "Public app URL."
  default     = "https://omnify.cpg-labs.io"
}

variable "shopify_scopes" {
  type        = string
  description = "Comma-separated Shopify scopes."
  default     = "read_customers,read_locations,read_merchant_managed_fulfillment_orders,read_orders"
}

variable "google_maps_api_key" {
  type        = string
  description = "Google Maps API key."
  sensitive   = true
}

variable "google_maps_map_id" {
  type        = string
  description = "Google Maps Map ID."
  sensitive   = true
}

variable "anthropic_api_key" {
  type        = string
  description = "Anthropic API key for LLM-powered promo field detection in Merchandising."
  sensitive   = true
  default     = ""
}

# Optional: host custom app (Omnify | Custom) at a subpath on the same ALB
variable "enable_gebeauty" {
  type        = bool
  description = "If true, add a second ECS service for the custom app at the given subpath."
  default     = false
}

variable "gebeauty_base_path" {
  type        = string
  description = "Subpath for the custom app (e.g. '/full'). Used for ALB routing, health checks, and BASE_PATH env var."
  default     = "/full"
}

variable "shopify_api_key_gebeauty" {
  type        = string
  description = "Shopify API key (Client ID) for the custom app when enable_gebeauty=true."
  sensitive   = true
  default     = ""
}

variable "shopify_api_secret_gebeauty" {
  type        = string
  description = "Shopify API secret for the custom app when enable_gebeauty=true."
  sensitive   = true
  default     = ""
}

variable "image_tag_gebeauty" {
  type        = string
  description = "Initial Docker image tag for gebeauty task def (only applied on first create — `lifecycle { ignore_changes = [container_definitions] }` prevents terraform from reverting deploy-script-registered images on subsequent applies). Real image is managed by scripts/deploy-cpg-labs.ps1."
  default     = "managed-by-deploy-script"
}

# Lalamove credential encryption (required for per-shop credential storage)
variable "app_encryption_key" {
  type        = string
  description = "Base64-encoded 32-byte key for AES-256-GCM. Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
  sensitive   = true
  default     = ""
}

variable "app_encryption_key_version" {
  type        = string
  description = "Encryption key version (e.g. 1). Used for key rotation."
  default     = "1"
}

# ---------- Omnify (uses deploy-omnify.ps1 with APP_IDENTITY=omnify) ----------
# These variables are kept for backwards compatibility but are no longer used.
# The Omnify deployment reuses the ECS service via deploy-omnify.ps1.

# ---------- Visibility ----------

variable "site_certificate_arn" {
  type        = string
  description = "ACM certificate ARN for cpg-labs.io (apex + www). Must be created manually and validated before terraform apply."
  default     = ""
}

variable "enable_storytelling" {
  type    = bool
  default = false
}

variable "shopify_api_key_storytelling" {
  type      = string
  sensitive = true
  default   = ""
}

variable "shopify_api_secret_storytelling" {
  type      = string
  sensitive = true
  default   = ""
}

variable "image_tag_storytelling" {
  type    = string
  default = "latest"
}
