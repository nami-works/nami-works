# ─────────────────────────────────────────────────────────────────────────────
# Claude Control API — bearer-auth-gated external control surface
# ─────────────────────────────────────────────────────────────────────────────
#
# Exposes /api/control/* endpoints so Claude Code (or any authorized client)
# can observe + drive the Local Delivery pipeline headlessly, without the
# Shopify embedded session.
#
# Auth model:
#   - CLAUDE_CONTROL_TOKEN — bearer secret. Clients send Authorization: Bearer
#   - CLAUDE_CONTROL_SHOP  — shop domain this token is scoped to.
#                            Server derives shop from env, not from request.
#
# Enabling:
#   enable_claude_control = true
#   claude_control_token  = "<generate a long random string>"
#   claude_control_shop   = "ge-beauty-cosmeticos.myshopify.com"
# in terraform.tfvars.

variable "enable_claude_control" {
  description = "Whether to wire CLAUDE_CONTROL_TOKEN + SHOP into the ECS task."
  type        = bool
  default     = false
}

variable "claude_control_token" {
  description = "Bearer secret for /api/control/* endpoints. Rotate by changing here + redeploying."
  type        = string
  sensitive   = true
  default     = ""
}

variable "claude_control_shop" {
  description = "Shop domain authorized by claude_control_token (e.g. ge-beauty-cosmeticos.myshopify.com)."
  type        = string
  default     = ""
}

resource "aws_ssm_parameter" "claude_control_token" {
  count = var.enable_claude_control && var.claude_control_token != "" ? 1 : 0
  name  = "${local.ssm_prefix}/CLAUDE_CONTROL_TOKEN"
  type  = "SecureString"
  value = var.claude_control_token
}

resource "aws_ssm_parameter" "claude_control_shop" {
  count = var.enable_claude_control && var.claude_control_shop != "" ? 1 : 0
  name  = "${local.ssm_prefix}/CLAUDE_CONTROL_SHOP"
  type  = "String"
  value = var.claude_control_shop
}
