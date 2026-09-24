# ─────────────────────────────────────────────────────────────────────────────
# Access-notify Lambda: emails Lucas IMMEDIATELY when a client opens a deck.
# (Its once-daily sibling, access-digest.tf, sends the end-of-day rollup.)
#
# Triggered by S3 ObjectCreated on the CloudFront access-logs bucket
# (aws_s3_bucket.logs, defined in site.tf). Parses each new log object for
# real deck views (the ?_co=<company>[&_n=<name>] tracking hits
# viewer-request.js creates) and emails a summary via SES. See
# lambda/access-notify/index.py for the parsing/email logic.
#
# SES is in sandbox mode on this account (both sender and recipient must be
# verified identities) -- lucas@gebeauty.com.br is already verified, so this
# sends from and to that same address rather than standing up a new SES
# domain identity just for one notification email.
# ─────────────────────────────────────────────────────────────────────────────

variable "notify_email" {
  description = "Verified SES identity to send/receive access notifications. SES account is sandboxed, so this must already be a verified identity."
  type        = string
  default     = "lucas@gebeauty.com.br"
}

variable "excluded_ips" {
  description = "Client IPs (c-ip) to treat as noise, not real deck views -- e.g. Lucas's own IP so his own QA/demo visits don't trigger a notification or show up in the daily digest. No default committed here on purpose (an IP is a personal identifier); pass at apply time, e.g. -var 'excluded_ips=[\"203.0.113.7\"]'."
  type        = list(string)
  default     = []
}

data "archive_file" "access_notify" {
  type        = "zip"
  source_file = "${path.module}/lambda/access-notify/index.py"
  output_path = "${path.module}/lambda/access-notify.zip"
}

data "aws_iam_policy_document" "access_notify_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "access_notify" {
  name               = "${var.bucket_name}-access-notify"
  assume_role_policy = data.aws_iam_policy_document.access_notify_assume.json
}

data "aws_iam_policy_document" "access_notify_permissions" {
  statement {
    sid       = "ReadAccessLogs"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.logs.arn}/*"]
  }

  statement {
    sid       = "SendNotificationEmail"
    effect    = "Allow"
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "ses:FromAddress"
      values   = [var.notify_email]
    }
  }

  statement {
    sid    = "WriteOwnLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["arn:aws:logs:${var.aws_region}:*:log-group:/aws/lambda/${var.bucket_name}-access-notify*"]
  }
}

resource "aws_iam_role_policy" "access_notify" {
  name   = "${var.bucket_name}-access-notify"
  role   = aws_iam_role.access_notify.id
  policy = data.aws_iam_policy_document.access_notify_permissions.json
}

resource "aws_cloudwatch_log_group" "access_notify" {
  name              = "/aws/lambda/${var.bucket_name}-access-notify"
  retention_in_days = 30
}

resource "aws_lambda_function" "access_notify" {
  function_name = "${var.bucket_name}-access-notify"
  role          = aws_iam_role.access_notify.arn
  handler       = "index.handler"
  runtime       = "python3.12"
  timeout       = 30
  memory_size   = 128

  filename         = data.archive_file.access_notify.output_path
  source_code_hash = data.archive_file.access_notify.output_base64sha256

  environment {
    variables = {
      NOTIFY_EMAIL = var.notify_email
      EXCLUDED_IPS = join(",", var.excluded_ips)
    }
  }

  depends_on = [aws_cloudwatch_log_group.access_notify]
}

resource "aws_lambda_permission" "access_notify_s3" {
  statement_id  = "AllowS3Invoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.access_notify.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.logs.arn
}

resource "aws_s3_bucket_notification" "logs" {
  bucket = aws_s3_bucket.logs.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.access_notify.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "cloudfront/"
  }

  depends_on = [aws_lambda_permission.access_notify_s3]
}
