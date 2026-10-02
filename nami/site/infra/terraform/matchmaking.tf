# ─────────────────────────────────────────────────────────────────────────────
# Matchmaking-funnel backend for nami.works: one DynamoDB table + one Lambda
# behind a public Function URL. The funnel (nami-works/site) POSTs a row when
# the quiz finishes and PATCHes it with contact info on confirm/waitlist.
#
# Deliberately isolated: own table, own role scoped to that table + the
# nami.works SES identity, no shared code or credentials with apps/connector
# (the GE Beauty MCP gateway). Separate from lambda.tf's lead-intake because
# the shape differs entirely (JSON + CORS + update vs form POST + redirect).
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_dynamodb_table" "matchmaking" {
  name         = "${var.bucket_name}-matchmaking"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  # Every row is a real lead. A stray `terraform destroy` must not take them.
  lifecycle {
    prevent_destroy = true
  }
}

data "archive_file" "matchmaking_api" {
  type        = "zip"
  source_file = "${path.module}/lambda/matchmaking-api/index.mjs"
  output_path = "${path.module}/lambda/matchmaking-api.zip"
}

data "aws_iam_policy_document" "matchmaking_api_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "matchmaking_api" {
  name               = "${var.bucket_name}-matchmaking-api"
  assume_role_policy = data.aws_iam_policy_document.matchmaking_api_assume.json
}

data "aws_iam_policy_document" "matchmaking_api_permissions" {
  statement {
    sid       = "WriteSubmissions"
    effect    = "Allow"
    actions   = ["dynamodb:PutItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.matchmaking.arn]
  }

  statement {
    sid       = "SendFromNamiWorksDomain"
    effect    = "Allow"
    actions   = ["ses:SendEmail"]
    resources = [aws_ses_domain_identity.nami_works.arn]
  }

  statement {
    sid    = "WriteOwnLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["arn:aws:logs:${var.aws_region}:*:log-group:/aws/lambda/${var.bucket_name}-matchmaking-api*"]
  }
}

resource "aws_iam_role_policy" "matchmaking_api" {
  name   = "${var.bucket_name}-matchmaking-api"
  role   = aws_iam_role.matchmaking_api.id
  policy = data.aws_iam_policy_document.matchmaking_api_permissions.json
}

resource "aws_cloudwatch_log_group" "matchmaking_api" {
  name              = "/aws/lambda/${var.bucket_name}-matchmaking-api"
  retention_in_days = 30
}

resource "aws_lambda_function" "matchmaking_api" {
  function_name = "${var.bucket_name}-matchmaking-api"
  role          = aws_iam_role.matchmaking_api.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 15
  memory_size   = 128

  filename         = data.archive_file.matchmaking_api.output_path
  source_code_hash = data.archive_file.matchmaking_api.output_base64sha256

  environment {
    variables = {
      TABLE_NAME   = aws_dynamodb_table.matchmaking.name
      FROM_ADDRESS = var.matchmaking_from_address
      TO_ADDRESS   = var.lead_to_address
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.matchmaking_api,
    aws_iam_role_policy.matchmaking_api,
    aws_ses_domain_identity_verification.nami_works,
  ]
}

# Public and unauthenticated by design: the funnel runs in the visitor's
# browser, so there is no secret to hold. The handler validates every field,
# caps sizes, and makes the PATCH one-shot per submission. CORS is enforced
# here at the Function URL, not in the handler.
resource "aws_lambda_function_url" "matchmaking_api" {
  function_name      = aws_lambda_function.matchmaking_api.function_name
  authorization_type = "NONE"

  cors {
    allow_origins = var.matchmaking_allowed_origins
    allow_methods = ["POST", "PATCH"]
    allow_headers = ["content-type"]
    max_age       = 86400
  }
}
