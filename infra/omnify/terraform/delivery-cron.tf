# ─────────────────────────────────────────────────────────────────────────────
# Local-delivery cron jobs (EventBridge → HTTPS)
# ─────────────────────────────────────────────────────────────────────────────
#
# Two 5-minute crons that power the automatic delivery pipeline:
#
# 1. Auto-delivery  — /api/cron/auto-delivery
#    Phase A (auto-assign): after cutoff + delay, cluster orders into routes.
#    Phase B (auto-dispatch): at dispatch time, quote + place Lalamove orders.
#
# 2. Lalamove watchdog — /api/cron/lalamove-watchdog
#    Detects stuck ON_GOING orders (30+ min without PICKED_UP) → cancel & retry.
#    Runs escalation checks for ASSIGNING_DRIVER jobs (priority fees, reorder).
#
# Both endpoints verify X-Cron-Secret against process.env.CRON_SECRET.
#
# ── Enabling ────────────────────────────────────────────────────────────────
#   enable_delivery_cron = true
#   cron_secret          = "some-long-random-string"
# in terraform.tfvars. The cron_secret value is stored in SSM and injected
# into ECS containers via ecs.tf; the same value is sent as the
# X-Cron-Secret header by EventBridge.

variable "enable_delivery_cron" {
  description = "Whether to create the 5-minute auto-delivery and watchdog EventBridge crons."
  type        = bool
  default     = false
}

variable "cron_secret" {
  description = "Shared secret for cron endpoint authentication (X-Cron-Secret header). Must match CRON_SECRET env var in ECS."
  type        = string
  sensitive   = true
  default     = ""
}

# ── SSM Parameter (injected into ECS containers by ecs.tf) ─────────────────

resource "aws_ssm_parameter" "cron_secret" {
  count = var.enable_delivery_cron && var.cron_secret != "" ? 1 : 0
  name  = "${local.ssm_prefix}/CRON_SECRET"
  type  = "SecureString"
  value = var.cron_secret
}

# ── Shared EventBridge connection ──────────────────────────────────────────
# API_KEY auth — sends the literal cron_secret as the X-Cron-Secret header.

resource "aws_cloudwatch_event_connection" "delivery_cron" {
  count = var.enable_delivery_cron ? 1 : 0

  name               = "delivery-cron-connection"
  description        = "API key auth for local-delivery cron endpoints."
  authorization_type = "API_KEY"

  auth_parameters {
    api_key {
      key   = "X-Cron-Secret"
      value = var.cron_secret
    }
  }
}

# ── Auto-delivery (every 5 minutes) ───────────────────────────────────────

resource "aws_cloudwatch_event_api_destination" "auto_delivery" {
  count = var.enable_delivery_cron ? 1 : 0

  name                             = "auto-delivery-cron-destination"
  description                      = "HTTPS target for auto-delivery cron (assign + dispatch)."
  invocation_endpoint              = "${var.app_base_url}/full/api/cron/auto-delivery"
  http_method                      = "GET"
  invocation_rate_limit_per_second = 1
  connection_arn                   = aws_cloudwatch_event_connection.delivery_cron[0].arn
}

resource "aws_cloudwatch_event_rule" "auto_delivery" {
  count = var.enable_delivery_cron ? 1 : 0

  name                = "auto-delivery-cron-5min"
  description         = "Fires auto-delivery cron every 5 minutes."
  schedule_expression = "rate(5 minutes)"
}

resource "aws_cloudwatch_event_target" "auto_delivery" {
  count = var.enable_delivery_cron ? 1 : 0

  rule      = aws_cloudwatch_event_rule.auto_delivery[0].name
  target_id = "auto-delivery-cron-http"
  arn       = aws_cloudwatch_event_api_destination.auto_delivery[0].arn
  role_arn  = aws_iam_role.delivery_cron[0].arn
}

# ── Lalamove watchdog (every 5 minutes) ───────────────────────────────────

resource "aws_cloudwatch_event_api_destination" "lalamove_watchdog" {
  count = var.enable_delivery_cron ? 1 : 0

  name                             = "lalamove-watchdog-cron-destination"
  description                      = "HTTPS target for Lalamove watchdog cron (stuck order retry + escalation)."
  invocation_endpoint              = "${var.app_base_url}/full/api/cron/lalamove-watchdog"
  http_method                      = "GET"
  invocation_rate_limit_per_second = 1
  connection_arn                   = aws_cloudwatch_event_connection.delivery_cron[0].arn
}

resource "aws_cloudwatch_event_rule" "lalamove_watchdog" {
  count = var.enable_delivery_cron ? 1 : 0

  name                = "lalamove-watchdog-cron-5min"
  description         = "Fires Lalamove watchdog cron every 5 minutes."
  schedule_expression = "rate(5 minutes)"
}

resource "aws_cloudwatch_event_target" "lalamove_watchdog" {
  count = var.enable_delivery_cron ? 1 : 0

  rule      = aws_cloudwatch_event_rule.lalamove_watchdog[0].name
  target_id = "lalamove-watchdog-cron-http"
  arn       = aws_cloudwatch_event_api_destination.lalamove_watchdog[0].arn
  role_arn  = aws_iam_role.delivery_cron[0].arn
}

# ── IAM role (shared by both crons) ──────────────────────────────────────

data "aws_iam_policy_document" "delivery_cron_assume" {
  count = var.enable_delivery_cron ? 1 : 0

  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "delivery_cron" {
  count              = var.enable_delivery_cron ? 1 : 0
  name               = "delivery-cron-invoke"
  assume_role_policy = data.aws_iam_policy_document.delivery_cron_assume[0].json
}

resource "aws_iam_role_policy" "delivery_cron_invoke" {
  count = var.enable_delivery_cron ? 1 : 0
  name  = "delivery-cron-invoke"
  role  = aws_iam_role.delivery_cron[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["events:InvokeApiDestination"]
        Resource = [
          aws_cloudwatch_event_api_destination.auto_delivery[0].arn,
          aws_cloudwatch_event_api_destination.lalamove_watchdog[0].arn,
        ]
      },
    ]
  })
}
