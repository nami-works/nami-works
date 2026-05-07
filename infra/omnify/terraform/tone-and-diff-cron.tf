# ─────────────────────────────────────────────────────────────────────────────
# Hourly tone-source refresh + draft-diff cron (Storytelling Phase 6)
# ─────────────────────────────────────────────────────────────────────────────
#
# Fires GET https://app.cpg-labs.io/api/cron/weekly-tone-and-diff every hour
# at :45 with header `X-Cron-Secret: <secret>`. The endpoint iterates every
# installed shop and only acts on shops where current local time (per shop's
# IANA timezone, fetched from Shopify Shop) is Monday between 09:00 and
# 09:59. For each gated shop:
#   - Refresh Shopify blog samples
#   - Refresh Monday.com samples (if configured)
#   - Run Claude inference on the new BrandToneSource batch
#   - Run BlogPostDraft -> live article diff detection (Storytelling learnings)
#
# Offset to :45 so it doesn't collide with:
#   - retail-goals-cron   at :00
#   - shop-ingest-cron    at :15
#   - affiliates-cron     at :30
#
# Default: resources NOT created. Enable via `enable_tone_cron = true`
# in terraform.tfvars. Reuses the shared `var.cron_secret` (declared in
# delivery-cron.tf) and `var.app_base_url` (declared in retail-goals-cron.tf).

variable "enable_tone_cron" {
  description = "Whether to create the hourly tone-source + diff cron (EventBridge rule + ApiDestination)."
  type        = bool
  default     = false
}

resource "aws_cloudwatch_event_connection" "tone_cron" {
  count = var.enable_tone_cron ? 1 : 0

  name               = "tone-cron-connection"
  description        = "API key auth for the weekly tone-and-diff cron."
  authorization_type = "API_KEY"

  auth_parameters {
    api_key {
      key   = "X-Cron-Secret"
      value = var.cron_secret
    }
  }
}

resource "aws_cloudwatch_event_api_destination" "tone_cron" {
  count = var.enable_tone_cron ? 1 : 0

  name                             = "tone-cron-destination"
  description                      = "HTTPS target for the weekly tone-and-diff cron."
  invocation_endpoint              = "${var.app_base_url}/api/cron/weekly-tone-and-diff"
  http_method                      = "GET"
  invocation_rate_limit_per_second = 1
  connection_arn                   = aws_cloudwatch_event_connection.tone_cron[0].arn
}

resource "aws_cloudwatch_event_rule" "tone_cron_hourly" {
  count = var.enable_tone_cron ? 1 : 0

  name                = "tone-cron-hourly"
  description         = "Fires the weekly tone-and-diff cron every hour at :45."
  schedule_expression = "cron(45 * * * ? *)"
}

data "aws_iam_policy_document" "tone_cron_assume" {
  count = var.enable_tone_cron ? 1 : 0

  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "tone_cron" {
  count              = var.enable_tone_cron ? 1 : 0
  name               = "tone-cron-invoke"
  assume_role_policy = data.aws_iam_policy_document.tone_cron_assume[0].json
}

resource "aws_iam_role_policy" "tone_cron_invoke" {
  count = var.enable_tone_cron ? 1 : 0
  name  = "tone-cron-invoke"
  role  = aws_iam_role.tone_cron[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["events:InvokeApiDestination"]
        Resource = aws_cloudwatch_event_api_destination.tone_cron[0].arn
      },
    ]
  })
}

resource "aws_cloudwatch_event_target" "tone_cron" {
  count = var.enable_tone_cron ? 1 : 0

  rule      = aws_cloudwatch_event_rule.tone_cron_hourly[0].name
  target_id = "tone-cron-http"
  arn       = aws_cloudwatch_event_api_destination.tone_cron[0].arn
  role_arn  = aws_iam_role.tone_cron[0].arn
}
