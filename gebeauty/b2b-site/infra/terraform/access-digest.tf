# ─────────────────────────────────────────────────────────────────────────────
# Access-digest Lambda: once-daily rollup email of every deck view from the
# previous day. Sibling to access-notify.tf's per-hit immediate email.
#
# Runs on an EventBridge Scheduler cron (default 09:00 UTC = 06:00 BRT --
# change var.digest_schedule if a different time suits better). Reads all of
# yesterday's log objects directly from the access-logs bucket (S3 key names
# embed the date) rather than being triggered by them, since a digest needs
# the FULL day's data, not one log object at a time.
# ─────────────────────────────────────────────────────────────────────────────

variable "digest_schedule" {
  description = "EventBridge Scheduler cron expression (UTC) for the daily digest email."
  type        = string
  default     = "cron(0 9 * * ? *)" # 09:00 UTC = 06:00 BRT
}

data "archive_file" "access_digest" {
  type        = "zip"
  source_file = "${path.module}/lambda/access-digest/index.py"
  output_path = "${path.module}/lambda/access-digest.zip"
}

resource "aws_iam_role" "access_digest" {
  name               = "${var.bucket_name}-access-digest"
  assume_role_policy = data.aws_iam_policy_document.access_notify_assume.json # same lambda.amazonaws.com trust policy
}

data "aws_iam_policy_document" "access_digest_permissions" {
  statement {
    sid       = "ReadAccessLogs"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.logs.arn, "${aws_s3_bucket.logs.arn}/*"]
  }

  statement {
    sid       = "SendDigestEmail"
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
    resources = ["arn:aws:logs:${var.aws_region}:*:log-group:/aws/lambda/${var.bucket_name}-access-digest*"]
  }
}

resource "aws_iam_role_policy" "access_digest" {
  name   = "${var.bucket_name}-access-digest"
  role   = aws_iam_role.access_digest.id
  policy = data.aws_iam_policy_document.access_digest_permissions.json
}

resource "aws_cloudwatch_log_group" "access_digest" {
  name              = "/aws/lambda/${var.bucket_name}-access-digest"
  retention_in_days = 30
}

resource "aws_lambda_function" "access_digest" {
  function_name = "${var.bucket_name}-access-digest"
  role          = aws_iam_role.access_digest.arn
  handler       = "index.handler"
  runtime       = "python3.12"
  timeout       = 60 # a full day's logs can be several files
  memory_size   = 128

  filename         = data.archive_file.access_digest.output_path
  source_code_hash = data.archive_file.access_digest.output_base64sha256

  environment {
    variables = {
      NOTIFY_EMAIL = var.notify_email
      LOGS_BUCKET  = aws_s3_bucket.logs.id
    }
  }

  depends_on = [aws_cloudwatch_log_group.access_digest]
}

# ── EventBridge Scheduler: fires the Lambda daily ───────────────────────────
data "aws_iam_policy_document" "digest_scheduler_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "digest_scheduler" {
  name               = "${var.bucket_name}-access-digest-scheduler"
  assume_role_policy = data.aws_iam_policy_document.digest_scheduler_assume.json
}

data "aws_iam_policy_document" "digest_scheduler_invoke" {
  statement {
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.access_digest.arn]
  }
}

resource "aws_iam_role_policy" "digest_scheduler" {
  name   = "${var.bucket_name}-access-digest-scheduler"
  role   = aws_iam_role.digest_scheduler.id
  policy = data.aws_iam_policy_document.digest_scheduler_invoke.json
}

resource "aws_scheduler_schedule" "access_digest" {
  name                = "${var.bucket_name}-access-digest"
  schedule_expression = var.digest_schedule

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.access_digest.arn
    role_arn = aws_iam_role.digest_scheduler.arn
  }
}
