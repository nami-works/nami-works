# ─────────────────────────────────────────────────────────────────────────────
# Hourly Affiliates reconciliation cron
# ─────────────────────────────────────────────────────────────────────────────
#
# Fires GET https://app.cpg-labs.io/api/cron/affiliates-sync every
# hour at :30 with header `X-Cron-Secret: <secret>`. The endpoint:
#   - Runs reconcileAffiliatesIncremental (updated_at:>=T-2mo) — catches any
#     dropped webhook or out-of-band admin edit.
#   - Rebuilds AffiliateMonthly for the whole shop (cheap raw SQL).
#   - Refreshes AttributionQueueSnapshot so the Attribution tab paints
#     instantly on page load.
#   - Logs forgotten claims (>7 days unconfirmed) for ops awareness.
#
# Offset to :30 so it doesn't collide with:
#   - retail-goals-cron at :00
#   - shop-ingest-cron   at :15
#
# Default: resources NOT created. Enable via `enable_affiliates_cron = true`
# in terraform.tfvars. Reuses the shared `var.cron_secret` (declared in
# delivery-cron.tf) and `var.app_base_url` (declared in retail-goals-cron.tf).

variable "enable_affiliates_cron" {
  description = "Whether to create the hourly Affiliates reconciliation cron (EventBridge rule + ApiDestination)."
  type        = bool
  default     = false
}

resource "aws_cloudwatch_event_connection" "affiliates_cron" {
  count = var.enable_affiliates_cron ? 1 : 0

  name               = "affiliates-cron-connection"
  description        = "API key auth for the Affiliates hourly reconciliation cron."
  authorization_type = "API_KEY"

  auth_parameters {
    api_key {
      key   = "X-Cron-Secret"
      value = var.cron_secret
    }
  }
}

resource "aws_cloudwatch_event_api_destination" "affiliates_cron" {
  count = var.enable_affiliates_cron ? 1 : 0

  name                             = "affiliates-cron-destination"
  description                      = "HTTPS target for the Affiliates hourly reconciliation cron."
  invocation_endpoint              = "${var.app_base_url}/api/cron/affiliates-sync"
  http_method                      = "GET"
  invocation_rate_limit_per_second = 1
  connection_arn                   = aws_cloudwatch_event_connection.affiliates_cron[0].arn
}

resource "aws_cloudwatch_event_rule" "affiliates_cron_hourly" {
  count = var.enable_affiliates_cron ? 1 : 0

  name                = "affiliates-cron-hourly"
  description         = "Fires the Affiliates reconciliation cron every hour at :30."
  schedule_expression = "cron(30 * * * ? *)"
}

data "aws_iam_policy_document" "affiliates_cron_assume" {
  count = var.enable_affiliates_cron ? 1 : 0

  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "affiliates_cron" {
  count              = var.enable_affiliates_cron ? 1 : 0
  name               = "affiliates-cron-invoke"
  assume_role_policy = data.aws_iam_policy_document.affiliates_cron_assume[0].json
}

resource "aws_iam_role_policy" "affiliates_cron_invoke" {
  count = var.enable_affiliates_cron ? 1 : 0
  name  = "affiliates-cron-invoke"
  role  = aws_iam_role.affiliates_cron[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["events:InvokeApiDestination"]
        Resource = aws_cloudwatch_event_api_destination.affiliates_cron[0].arn
      },
    ]
  })
}

resource "aws_cloudwatch_event_target" "affiliates_cron" {
  count = var.enable_affiliates_cron ? 1 : 0

  rule      = aws_cloudwatch_event_rule.affiliates_cron_hourly[0].name
  target_id = "affiliates-cron-http"
  arn       = aws_cloudwatch_event_api_destination.affiliates_cron[0].arn
  role_arn  = aws_iam_role.affiliates_cron[0].arn
}
