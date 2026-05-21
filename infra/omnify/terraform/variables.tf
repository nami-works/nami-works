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

# gebeauty path-based subpath app retired in Phase 6j (2026-04-29).
# CPG Labs full now lives at its own hostname (app.cpg-labs.io) via
# `module "full"` in apps.tf. The old `enable_gebeauty`, `gebeauty_base_path`,
# `shopify_api_key_gebeauty`, `shopify_api_secret_gebeauty`, and
# `image_tag_gebeauty` variables are no longer declared.

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

# ---------- Phase 6 consolidated apps.tf inputs ----------
# Forward-looking vars used by `apps.tf` via the shared modules/shopify-app
# module. As of Phase 6j (2026-04-29), `module "full"` reads `_full` vars
# directly; the old `_gebeauty` aliases are gone alongside gebeauty.tf.

variable "shopify_api_key_full" {
  type        = string
  description = "Shopify API key (Client ID) for the CPG Labs full app at app.cpg-labs.io."
  sensitive   = true
  default     = ""
}

variable "shopify_api_secret_full" {
  type        = string
  description = "Shopify API secret for the CPG Labs full app at app.cpg-labs.io."
  sensitive   = true
  default     = ""
}

variable "shopify_api_key_omnify" {
  type        = string
  description = "Shopify API key (Client ID) for the Omnify focused delivery app at omnify.cpg-labs.io."
  sensitive   = true
  default     = ""
}

variable "shopify_api_secret_omnify" {
  type        = string
  description = "Shopify API secret for the Omnify focused delivery app at omnify.cpg-labs.io."
  sensitive   = true
  default     = ""
}

variable "image_tag_full" {
  type        = string
  description = "Initial Docker image tag for the CPG Labs full app task def. Real image managed by the consolidated deploy script."
  default     = "managed-by-deploy-script"
}

variable "image_tag_omnify" {
  type        = string
  description = "Initial Docker image tag for the Omnify focused app task def. Real image managed by the consolidated deploy script."
  default     = "managed-by-deploy-script"
}

variable "shopify_scopes_full" {
  type        = string
  description = "Shopify scopes for the CPG Labs full app (previously implicit; now explicit per-app)."
  default     = "read_customers,read_locations,read_merchant_managed_fulfillment_orders,read_orders,write_orders,read_products,write_products,read_content,write_content"
}

variable "shopify_scopes_omnify" {
  type        = string
  description = "Shopify scopes for the Omnify focused delivery app."
  default     = "read_customers,read_locations,read_merchant_managed_fulfillment_orders,read_orders"
}
