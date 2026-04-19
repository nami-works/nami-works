# ─────────────────────────────────────────────────────────────────────────────
# Hourly Shop Ingest reconciliation cron (Phase 1 drift safety net)
# ─────────────────────────────────────────────────────────────────────────────
#
# Fires GET https://omnify.cpg-labs.io/api/cron/shop-ingest-reconcile every
# hour with header `X-Cron-Secret: <secret>`. The endpoint queries Shopify for
# orders/customers/products with `updated_at > watermark`, paginates only when
# there's a delta, and upserts through the same canonical ingest service that
# webhooks use. Cost is near-zero on quiet shops.
#
# Webhooks remain the real-time path; this cron is the floor that catches
# dropped deliveries and out-of-band edits made directly in Shopify admin.
#
# ── Enabling ────────────────────────────────────────────────────────────────
# Default: resources NOT created. Toggle by setting:
#   enable_shop_ingest_cron = true
# in terraform.tfvars. Reuses the shared `var.cron_secret` (declared in
# delivery-cron.tf) and `var.app_base_url` (declared in retail-goals-cron.tf).

variable "enable_shop_ingest_cron" {
  description = "Whether to create the hourly Shop Ingest reconciliation cron (EventBridge rule + ApiDestination)."
  type        = bool
  default     = false
}

resource "aws_cloudwatch_event_connection" "shop_ingest_cron" {
  count = var.enable_shop_ingest_cron ? 1 : 0

  name               = "shop-ingest-cron-connection"
  description        = "API key auth for the Shop Ingest hourly reconciliation cron."
  authorization_type = "API_KEY"

  auth_parameters {
    api_key {
      key   = "X-Cron-Secret"
      value = var.cron_secret
    }
  }
}

resource "aws_cloudwatch_event_api_destination" "shop_ingest_cron" {
  count = var.enable_shop_ingest_cron ? 1 : 0

  name                             = "shop-ingest-cron-destination"
  description                      = "HTTPS target for the Shop Ingest hourly reconciliation cron."
  invocation_endpoint              = "${var.app_base_url}/full/api/cron/shop-ingest-reconcile"
  http_method                      = "GET"
  invocation_rate_limit_per_second = 1
  connection_arn                   = aws_cloudwatch_event_connection.shop_ingest_cron[0].arn
}

resource "aws_cloudwatch_event_rule" "shop_ingest_cron_hourly" {
  count = var.enable_shop_ingest_cron ? 1 : 0

  name                = "shop-ingest-cron-hourly"
  description         = "Fires the Shop Ingest reconciliation cron every hour at :15."
  # Offset by 15 min from retail-goals-cron (which runs at :00) to spread load.
  schedule_expression = "cron(15 * * * ? *)"
}

data "aws_iam_policy_document" "shop_ingest_cron_assume" {
  count = var.enable_shop_ingest_cron ? 1 : 0

  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "shop_ingest_cron" {
  count              = var.enable_shop_ingest_cron ? 1 : 0
  name               = "shop-ingest-cron-invoke"
  assume_role_policy = data.aws_iam_policy_document.shop_ingest_cron_assume[0].json
}

resource "aws_iam_role_policy" "shop_ingest_cron_invoke" {
  count = var.enable_shop_ingest_cron ? 1 : 0
  name  = "shop-ingest-cron-invoke"
  role  = aws_iam_role.shop_ingest_cron[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["events:InvokeApiDestination"]
        Resource = aws_cloudwatch_event_api_destination.shop_ingest_cron[0].arn
      },
    ]
  })
}

resource "aws_cloudwatch_event_target" "shop_ingest_cron" {
  count = var.enable_shop_ingest_cron ? 1 : 0

  rule      = aws_cloudwatch_event_rule.shop_ingest_cron_hourly[0].name
  target_id = "shop-ingest-cron-http"
  arn       = aws_cloudwatch_event_api_destination.shop_ingest_cron[0].arn
  role_arn  = aws_iam_role.shop_ingest_cron[0].arn
}
