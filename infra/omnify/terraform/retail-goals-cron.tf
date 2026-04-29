# ─────────────────────────────────────────────────────────────────────────────
# Hourly Retail Goals reconciliation cron
# ─────────────────────────────────────────────────────────────────────────────
#
# Fires GET https://app.cpg-labs.io/api/cron/retail-goals-sync every hour
# with header `X-Cron-Secret: <secret>`. The endpoint iterates shops in
# SalesGoalsSyncMeta, calls unauthenticated.admin(shop) per shop, and runs
# runSalesGoalsSync(admin, shop, monthsBack=2) to reconcile any webhook
# drops and recompute monthly aggregates.
#
# Webhooks keep SalesOrder fresh in real time; this cron is the reconciliation
# floor. Cost is minimal (one lightweight cron per shop, no-op if shop has no
# new orders).
#
# ── Enabling ────────────────────────────────────────────────────────────────
# Default: resources NOT created. Toggle by setting the variable:
#   enable_retail_goals_cron = true
# in terraform.tfvars. The resources assume CRON_SECRET is already stored
# in AWS Secrets Manager under the name specified by `cron_secret_arn`.
#
# If no existing Secrets Manager secret holds CRON_SECRET, create one first:
#   resource "aws_secretsmanager_secret" "cron_secret" { name = "omnify/cron-secret" }
#   resource "aws_secretsmanager_secret_version" "cron_secret" {
#     secret_id     = aws_secretsmanager_secret.cron_secret.id
#     secret_string = var.cron_secret  # define in tfvars, do NOT commit
#   }
# Then pass aws_secretsmanager_secret.cron_secret.arn as cron_secret_arn.

variable "enable_retail_goals_cron" {
  description = "Whether to create the hourly Retail Goals reconciliation cron (EventBridge rule + ApiDestination)."
  type        = bool
  default     = false
}

# `var.cron_secret` is shared with delivery-cron.tf (declared there).

variable "app_base_url" {
  description = "Public base URL of the CPG Labs full app (used for cron target URLs). Shared across all cron modules. Moved from omnify.cpg-labs.io to app.cpg-labs.io in Phase 6 (2026-04-29) when CPG Labs full got its own dedicated hostname and BASE_PATH was killed."
  type        = string
  default     = "https://app.cpg-labs.io"
}

# ── EventBridge API Destination connection ──────────────────────────────────
# Uses API_KEY auth type; the 'API Key Name' is set to the header name the
# target expects (`X-Cron-Secret`). The value comes from Secrets Manager at
# resolution time — put the literal header value in that secret.

resource "aws_cloudwatch_event_connection" "retail_goals_cron" {
  count = var.enable_retail_goals_cron ? 1 : 0

  name               = "retail-goals-cron-connection"
  description        = "API key auth for the Retail Goals hourly reconciliation cron."
  authorization_type = "API_KEY"

  auth_parameters {
    api_key {
      key   = "X-Cron-Secret"
      value = var.cron_secret
    }
  }
}

resource "aws_cloudwatch_event_api_destination" "retail_goals_cron" {
  count = var.enable_retail_goals_cron ? 1 : 0

  name                             = "retail-goals-cron-destination"
  description                      = "HTTPS target for the Retail Goals hourly reconciliation cron."
  invocation_endpoint              = "${var.app_base_url}/api/cron/retail-goals-sync"
  http_method                      = "GET"
  invocation_rate_limit_per_second = 1
  connection_arn                   = aws_cloudwatch_event_connection.retail_goals_cron[0].arn
}

resource "aws_cloudwatch_event_rule" "retail_goals_cron_hourly" {
  count = var.enable_retail_goals_cron ? 1 : 0

  name                = "retail-goals-cron-hourly"
  description         = "Fires the Retail Goals reconciliation cron every hour at :00."
  schedule_expression = "cron(0 * * * ? *)"
}

# IAM role EventBridge assumes to invoke the ApiDestination.
data "aws_iam_policy_document" "retail_goals_cron_assume" {
  count = var.enable_retail_goals_cron ? 1 : 0

  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "retail_goals_cron" {
  count              = var.enable_retail_goals_cron ? 1 : 0
  name               = "retail-goals-cron-invoke"
  assume_role_policy = data.aws_iam_policy_document.retail_goals_cron_assume[0].json
}

resource "aws_iam_role_policy" "retail_goals_cron_invoke" {
  count = var.enable_retail_goals_cron ? 1 : 0
  name  = "retail-goals-cron-invoke"
  role  = aws_iam_role.retail_goals_cron[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["events:InvokeApiDestination"]
        Resource = aws_cloudwatch_event_api_destination.retail_goals_cron[0].arn
      },
    ]
  })
}

resource "aws_cloudwatch_event_target" "retail_goals_cron" {
  count = var.enable_retail_goals_cron ? 1 : 0

  rule      = aws_cloudwatch_event_rule.retail_goals_cron_hourly[0].name
  target_id = "retail-goals-cron-http"
  arn       = aws_cloudwatch_event_api_destination.retail_goals_cron[0].arn
  role_arn  = aws_iam_role.retail_goals_cron[0].arn
}
