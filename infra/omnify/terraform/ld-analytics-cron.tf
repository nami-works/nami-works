# ─────────────────────────────────────────────────────────────────────────────
# Daily Local Delivery Analytics rollup cron
# ─────────────────────────────────────────────────────────────────────────────
#
# Fires GET https://app.cpg-labs.io/api/cron/ld-analytics-rollup every
# day at 04:00 UTC (01:00 BRT — off-peak for BR shops) with header
# `X-Cron-Secret: <secret>`. The endpoint:
#   - Iterates LdAnalyticsConfig rows where enabled = true.
#   - Per shop, computes yesterday's per-city LdAnalyticsDaily rollup.
#   - Idempotent (upsert keyed on (shop, cityNorm, date)).
#
# Schedule: 04:00 UTC chosen to land after shop-ingest:reconcile (which fires
# at :15 hourly) has reconciled the previous day's data, and well before
# merchants in BRT timezone open the panel.
#
# Default: resources NOT created. Enable via `enable_ld_analytics_cron = true`
# in terraform.tfvars. Reuses the shared `var.cron_secret` (declared in
# delivery-cron.tf) and `var.app_base_url` (declared in retail-goals-cron.tf).
#
# Brief: inputs/briefs/local-delivery-analytics.md
# Spec:  docs/plans/local-delivery-analytics.md §7

variable "enable_ld_analytics_cron" {
  description = "Whether to create the daily Local Delivery Analytics rollup cron (EventBridge rule + ApiDestination)."
  type        = bool
  default     = false
}

resource "aws_cloudwatch_event_connection" "ld_analytics_cron" {
  count = var.enable_ld_analytics_cron ? 1 : 0

  name               = "ld-analytics-cron-connection"
  description        = "API key auth for the daily LD Analytics rollup cron."
  authorization_type = "API_KEY"

  auth_parameters {
    api_key {
      key   = "X-Cron-Secret"
      value = var.cron_secret
    }
  }
}

resource "aws_cloudwatch_event_api_destination" "ld_analytics_cron" {
  count = var.enable_ld_analytics_cron ? 1 : 0

  name                             = "ld-analytics-cron-destination"
  description                      = "HTTPS target for the daily LD Analytics rollup cron."
  invocation_endpoint              = "${var.app_base_url}/api/cron/ld-analytics-rollup"
  http_method                      = "GET"
  invocation_rate_limit_per_second = 1
  connection_arn                   = aws_cloudwatch_event_connection.ld_analytics_cron[0].arn
}

resource "aws_cloudwatch_event_rule" "ld_analytics_cron_daily" {
  count = var.enable_ld_analytics_cron ? 1 : 0

  name                = "ld-analytics-cron-daily"
  description         = "Fires the LD Analytics rollup cron once per day at 04:00 UTC."
  schedule_expression = "cron(0 4 * * ? *)"
}

data "aws_iam_policy_document" "ld_analytics_cron_assume" {
  count = var.enable_ld_analytics_cron ? 1 : 0

  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ld_analytics_cron" {
  count              = var.enable_ld_analytics_cron ? 1 : 0
  name               = "ld-analytics-cron-invoke"
  assume_role_policy = data.aws_iam_policy_document.ld_analytics_cron_assume[0].json
}

resource "aws_iam_role_policy" "ld_analytics_cron_invoke" {
  count = var.enable_ld_analytics_cron ? 1 : 0
  name  = "ld-analytics-cron-invoke"
  role  = aws_iam_role.ld_analytics_cron[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["events:InvokeApiDestination"]
        Resource = aws_cloudwatch_event_api_destination.ld_analytics_cron[0].arn
      },
    ]
  })
}

resource "aws_cloudwatch_event_target" "ld_analytics_cron" {
  count = var.enable_ld_analytics_cron ? 1 : 0

  rule      = aws_cloudwatch_event_rule.ld_analytics_cron_daily[0].name
  target_id = "ld-analytics-cron-http"
  arn       = aws_cloudwatch_event_api_destination.ld_analytics_cron[0].arn
  role_arn  = aws_iam_role.ld_analytics_cron[0].arn
}
