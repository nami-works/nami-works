# ─────────────────────────────────────────────────────────────────────────────
# Lead-intake Lambda: receives the Diagnostico form POST, emails it via SES
# (see ses.tf for the verified sending domain), redirects to /obrigado.
# Self-hosted alternative to a third-party form service (Formspree etc.) --
# no new account, stays inside AWS/this domain, fits the "we operate our own
# systems" positioning of the site itself.
# ─────────────────────────────────────────────────────────────────────────────

data "archive_file" "lead_intake" {
  type        = "zip"
  source_file = "${path.module}/lambda/lead-intake/index.mjs"
  output_path = "${path.module}/lambda/lead-intake.zip"
}

data "aws_iam_policy_document" "lead_intake_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lead_intake" {
  name               = "${var.bucket_name}-lead-intake"
  assume_role_policy = data.aws_iam_policy_document.lead_intake_assume.json
}

data "aws_iam_policy_document" "lead_intake_permissions" {
  statement {
    sid       = "SendLeadEmail"
    effect    = "Allow"
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = ["*"]

    # Scoped so this role can only send AS the one verified lead-capture
    # sender, not impersonate any other address in the SES account.
    condition {
      test     = "StringEquals"
      variable = "ses:FromAddress"
      values   = [var.lead_from_address]
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
    resources = ["arn:aws:logs:${var.aws_region}:*:log-group:/aws/lambda/${var.bucket_name}-lead-intake*"]
  }
}

resource "aws_iam_role_policy" "lead_intake" {
  name   = "${var.bucket_name}-lead-intake"
  role   = aws_iam_role.lead_intake.id
  policy = data.aws_iam_policy_document.lead_intake_permissions.json
}

resource "aws_cloudwatch_log_group" "lead_intake" {
  name              = "/aws/lambda/${var.bucket_name}-lead-intake"
  retention_in_days = 30
}

resource "aws_lambda_function" "lead_intake" {
  function_name = "${var.bucket_name}-lead-intake"
  role          = aws_iam_role.lead_intake.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 10
  memory_size   = 128

  filename         = data.archive_file.lead_intake.output_path
  source_code_hash = data.archive_file.lead_intake.output_base64sha256

  environment {
    variables = {
      FROM_ADDRESS    = var.lead_from_address
      TO_ADDRESS      = var.lead_to_address
      SUCCESS_REDIRECT = "https://${var.domain}/obrigado"
      ERROR_REDIRECT   = "https://${var.domain}/diagnostico"
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.lead_intake,
    aws_ses_domain_identity_verification.nami_works,
  ]
}

# Public, unauthenticated -- this is the intentional target of a public HTML
# form, not a general-purpose API. No CORS config: a plain form POST is a
# top-level navigation, not a fetch/XHR, so CORS does not apply.
resource "aws_lambda_function_url" "lead_intake" {
  function_name      = aws_lambda_function.lead_intake.function_name
  authorization_type = "NONE"
}
