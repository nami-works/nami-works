variable "app_name" {
  type        = string
  description = "Short name for the app (e.g. 'omnify', 'storytelling', 'storefront')."
}

variable "domain" {
  type        = string
  description = "Public domain for this app (e.g. 'omnify.cpg-labs.io')."
}

variable "app_identity" {
  type        = string
  description = "APP_IDENTITY env var value (omnify, retail, storytelling, cpg-labs)."
}

variable "shopify_api_key" {
  type      = string
  sensitive = true
}

variable "shopify_api_secret" {
  type      = string
  sensitive = true
}

variable "database_url" {
  type      = string
  sensitive = true
}

variable "shopify_scopes" {
  type        = string
  description = "Comma-separated Shopify scopes for this app."
}

variable "image_tag" {
  type    = string
  default = "latest"
}

variable "app_port" {
  type    = number
  default = 3000
}

variable "task_cpu" {
  type    = number
  default = 512
}

variable "task_memory" {
  type    = number
  default = 1024
}

# Passed from root module
variable "name_prefix" {
  type = string
}

variable "ecs_cluster_id" {
  type = string
}

variable "ecr_repository_url" {
  type = string
}

variable "execution_role_arn" {
  type = string
}

variable "task_role_arn" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_id" {
  type = string
}

variable "alb_listener_arn" {
  type = string
}

variable "listener_rule_priority" {
  type        = number
  description = "Priority for the ALB host-based listener rule."
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "create_ssm" {
  type    = bool
  default = true
}

variable "ssm_prefix" {
  type    = string
  default = "/omnify"
}

variable "database_url_ssm_arn" {
  type        = string
  description = "ARN of the shared DATABASE_URL SSM parameter (used when create_ssm=true)."
  default     = ""
}

variable "extra_env" {
  type        = list(object({ name = string, value = string }))
  default     = []
  description = "Additional environment variables for the container."
}

variable "app_encryption_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "app_encryption_key_version" {
  type    = string
  default = "1"
}

variable "google_maps_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "google_maps_map_id" {
  type      = string
  sensitive = true
  default   = ""
}
