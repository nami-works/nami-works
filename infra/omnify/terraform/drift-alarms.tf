# ─────────────────────────────────────────────────────────────────────────────
# CloudWatch alarms — catch ECS split-brain drift before it causes flakiness
# ─────────────────────────────────────────────────────────────────────────────
#
# Context: the week of 2026-04-22 we discovered both `omnify-cluster` and
# `cpg-labs` clusters were running live tasks registered against the same two
# shared target groups. Every request round-robined between two meaningfully
# different code versions. Nothing alerted on it — it took a manual audit.
#
# These alarms cover the three failure modes that allowed that to happen:
#
#   A. Cluster drift          — live tasks in BOTH clusters simultaneously.
#   B. Cross-cluster TG       — a shared target group has IPs from more than
#                               one cluster.
#   C. Task-def revision drift — a single service has more than one task-def
#                               revision backing live (healthy) targets.
#
# Alarm A reads AWS/ECS metrics directly. Alarms B and C require a Lambda
# because CloudWatch has no metric that maps target-IP → ENI → ECS task. The
# Lambda runs on a 5-minute schedule, walks each shared TG + each service,
# and publishes custom metrics to CPGLabs/Drift.
#
# All resources gated behind var.enable_drift_alarms (default true — on from
# day one but easy to disable if noisy).

# NOTE — providers.tf needs the `archive` provider added before first apply:
#
#   required_providers {
#     aws     = { source = "hashicorp/aws",     version = "~> 5.0" }
#     archive = { source = "hashicorp/archive", version = "~> 2.0" }   # add
#   }
#
# archive is used below for `data "archive_file" "drift_check_lambda"`.
# Terraform doesn't allow a second `required_providers` block in a sibling
# file (conflicts with providers.tf's block), so the root providers.tf is
# the single place to declare it. Run `terraform init -upgrade` after
# adding.

variable "enable_drift_alarms" {
  description = "Whether to create the drift-detection alarms and supporting Lambda."
  type        = bool
  default     = true
}

variable "drift_alert_email" {
  description = "Optional email address subscribed to the drift-alert SNS topic. Leave empty to set up the topic without a subscriber. The user should set this in terraform.tfvars."
  type        = string
  default     = ""
}

variable "drift_shared_target_groups" {
  description = "Names of target groups whose IP membership the Lambda verifies for cross-cluster drift. `omnify-gebeauty-tg` was retired in Phase 6j (2026-04-29) along with the gebeauty path-based subpath app — not in the list anymore. `omnify-full-tg` is the CPG Labs full app's TG (added when module.full became canonical at app.cpg-labs.io)."
  type        = list(string)
  default     = ["omnify-tg", "omnify-full-tg"]
}

variable "drift_monitored_services" {
  description = "List of {cluster, service} tuples to monitor for task-def revision drift among their live targets. `omnify-gebeauty-service` was retired alongside the gebeauty app in Phase 6j."
  type = list(object({
    cluster = string
    service = string
  }))
  default = [
    { cluster = "cpg-labs", service = "omnify-service" },
    { cluster = "cpg-labs", service = "omnify-full-service" },
  ]
}

# ── SNS topic ──────────────────────────────────────────────────────────────

resource "aws_sns_topic" "drift_alerts" {
  count = var.enable_drift_alarms ? 1 : 0

  name = "cpg-labs-drift-alerts"
}

# Set var.drift_alert_email in terraform.tfvars to receive alarm notifications.
# If empty, the topic exists but has no subscribers (alarms still fire in the
# CloudWatch console but nobody is paged).
resource "aws_sns_topic_subscription" "drift_alerts_email" {
  count = var.enable_drift_alarms && var.drift_alert_email != "" ? 1 : 0

  topic_arn = aws_sns_topic.drift_alerts[0].arn
  protocol  = "email"
  endpoint  = var.drift_alert_email
}

# ── Alarm A: cluster drift ────────────────────────────────────────────────
#
# Composite of two AWS/ECS metric alarms. Fires if BOTH clusters have at least
# one running task at the same time. The old cluster is expected to stay
# referenced by name even after Phase 4 cleanup, in case it ever gets
# re-created accidentally.

resource "aws_cloudwatch_metric_alarm" "drift_tasks_in_omnify_cluster" {
  count = var.enable_drift_alarms ? 1 : 0

  alarm_name          = "cpg-labs-drift-old-cluster-tasks"
  alarm_description   = "omnify-cluster has at least one running ECS task. The old cluster should be empty — this indicates split-brain."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  period              = 300
  statistic           = "Maximum"
  threshold           = 0
  metric_name         = "ClusterRunningTaskCount"
  namespace           = "AWS/ECS"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ClusterName = "omnify-cluster"
  }
}

resource "aws_cloudwatch_metric_alarm" "drift_tasks_in_cpg_labs_cluster" {
  count = var.enable_drift_alarms ? 1 : 0

  alarm_name          = "cpg-labs-drift-new-cluster-tasks"
  alarm_description   = "cpg-labs cluster has at least one running ECS task (expected — used only as a partner alarm for the cluster-drift composite)."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  period              = 300
  statistic           = "Maximum"
  threshold           = 0
  metric_name         = "ClusterRunningTaskCount"
  namespace           = "AWS/ECS"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ClusterName = "cpg-labs"
  }
}

resource "aws_cloudwatch_composite_alarm" "drift_cluster_split_brain" {
  count = var.enable_drift_alarms ? 1 : 0

  alarm_name        = "cpg-labs-drift-cluster-split-brain"
  alarm_description = "BOTH omnify-cluster and cpg-labs have running tasks simultaneously. Traffic is round-robining across two code versions. Deregister stale-cluster targets immediately."

  alarm_rule = join(" AND ", [
    "ALARM(${aws_cloudwatch_metric_alarm.drift_tasks_in_omnify_cluster[0].alarm_name})",
    "ALARM(${aws_cloudwatch_metric_alarm.drift_tasks_in_cpg_labs_cluster[0].alarm_name})",
  ])

  alarm_actions = [aws_sns_topic.drift_alerts[0].arn]
  ok_actions    = [aws_sns_topic.drift_alerts[0].arn]

  depends_on = [
    aws_cloudwatch_metric_alarm.drift_tasks_in_omnify_cluster,
    aws_cloudwatch_metric_alarm.drift_tasks_in_cpg_labs_cluster,
  ]
}

# ── Drift-check Lambda (feeds alarms B + C) ───────────────────────────────

data "archive_file" "drift_check_lambda" {
  count = var.enable_drift_alarms ? 1 : 0

  type        = "zip"
  source_dir  = "${path.module}/drift-check-lambda"
  output_path = "${path.module}/drift-check-lambda.zip"
}

data "aws_iam_policy_document" "drift_check_lambda_assume" {
  count = var.enable_drift_alarms ? 1 : 0

  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "drift_check_lambda" {
  count = var.enable_drift_alarms ? 1 : 0

  name               = "cpg-labs-drift-check-lambda"
  assume_role_policy = data.aws_iam_policy_document.drift_check_lambda_assume[0].json
}

resource "aws_iam_role_policy_attachment" "drift_check_lambda_basic" {
  count = var.enable_drift_alarms ? 1 : 0

  role       = aws_iam_role.drift_check_lambda[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "drift_check_lambda_policy" {
  count = var.enable_drift_alarms ? 1 : 0

  statement {
    actions = [
      "elasticloadbalancing:DescribeTargetHealth",
      "elasticloadbalancing:DescribeTargetGroups",
      "ec2:DescribeNetworkInterfaces",
      "ecs:ListTasks",
      "ecs:DescribeTasks",
      "ecs:ListClusters",
      "ecs:DescribeClusters",
      "ecs:DescribeServices",
      "ecs:DescribeTaskDefinition",
      "cloudwatch:PutMetricData",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "drift_check_lambda" {
  count = var.enable_drift_alarms ? 1 : 0

  name   = "cpg-labs-drift-check-lambda"
  role   = aws_iam_role.drift_check_lambda[0].id
  policy = data.aws_iam_policy_document.drift_check_lambda_policy[0].json
}

resource "aws_lambda_function" "drift_check" {
  count = var.enable_drift_alarms ? 1 : 0

  function_name    = "cpg-labs-drift-check"
  description      = "Walks shared target groups, maps target IPs to ECS tasks via ENIs, emits CrossClusterTargetCount + ActiveRevisionsPerService metrics to CPGLabs/Drift."
  role             = aws_iam_role.drift_check_lambda[0].arn
  handler          = "index.handler"
  runtime          = "python3.11"
  timeout          = 60
  memory_size      = 256
  filename         = data.archive_file.drift_check_lambda[0].output_path
  source_code_hash = data.archive_file.drift_check_lambda[0].output_base64sha256

  environment {
    variables = {
      TARGET_GROUPS_JSON = jsonencode(var.drift_shared_target_groups)
      SERVICES_JSON      = jsonencode(var.drift_monitored_services)
      METRIC_NAMESPACE   = "CPGLabs/Drift"
      AWS_REGION_NAME    = var.aws_region
    }
  }
}

resource "aws_cloudwatch_event_rule" "drift_check_schedule" {
  count = var.enable_drift_alarms ? 1 : 0

  name                = "cpg-labs-drift-check-5min"
  description         = "Invokes the drift-check Lambda every 5 minutes."
  schedule_expression = "rate(5 minutes)"
}

resource "aws_cloudwatch_event_target" "drift_check" {
  count = var.enable_drift_alarms ? 1 : 0

  rule      = aws_cloudwatch_event_rule.drift_check_schedule[0].name
  target_id = "cpg-labs-drift-check"
  arn       = aws_lambda_function.drift_check[0].arn
}

resource "aws_lambda_permission" "drift_check_invoke" {
  count = var.enable_drift_alarms ? 1 : 0

  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.drift_check[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.drift_check_schedule[0].arn
}

# ── Alarm B: cross-cluster target group membership ────────────────────────
#
# One alarm per shared TG. Lambda publishes CrossClusterTargetCount = number
# of DISTINCT clusters currently backing healthy targets. Alarm fires when
# that count > 1 (i.e. the TG is being served by more than one cluster).

resource "aws_cloudwatch_metric_alarm" "drift_cross_cluster_tg" {
  for_each = var.enable_drift_alarms ? toset(var.drift_shared_target_groups) : toset([])

  alarm_name          = "cpg-labs-drift-cross-cluster-${each.value}"
  alarm_description   = "Target group ${each.value} has healthy targets from more than one ECS cluster. Requests to this TG are round-robining across clusters. Deregister stale targets via `aws elbv2 deregister-targets`."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  period              = 300
  statistic           = "Maximum"
  threshold           = 1
  metric_name         = "CrossClusterTargetCount"
  namespace           = "CPGLabs/Drift"
  treat_missing_data  = "notBreaching"

  dimensions = {
    TargetGroup = each.value
  }

  alarm_actions = [aws_sns_topic.drift_alerts[0].arn]
  ok_actions    = [aws_sns_topic.drift_alerts[0].arn]
}

# ── Alarm C: task-def revision drift per service ──────────────────────────
#
# One alarm per monitored {cluster, service}. Lambda publishes
# ActiveRevisionsPerService = number of DISTINCT task-def revisions referenced
# by live (healthy) targets for the service. Alarm fires when > 1 (i.e. two
# revisions serving traffic simultaneously — usually mid-deploy drift or a
# stalled update).

resource "aws_cloudwatch_metric_alarm" "drift_active_revisions" {
  for_each = var.enable_drift_alarms ? { for svc in var.drift_monitored_services : "${svc.cluster}/${svc.service}" => svc } : {}

  alarm_name          = "cpg-labs-drift-active-revs-${replace(each.key, "/", "-")}"
  alarm_description   = "Service ${each.value.service} in cluster ${each.value.cluster} has more than one active task-def revision backing healthy targets. A deploy may be stuck, or a second cluster is running a stale revision against the same TG."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  period              = 300
  statistic           = "Maximum"
  threshold           = 1
  metric_name         = "ActiveRevisionsPerService"
  namespace           = "CPGLabs/Drift"
  treat_missing_data  = "notBreaching"

  dimensions = {
    Cluster = each.value.cluster
    Service = each.value.service
  }

  alarm_actions = [aws_sns_topic.drift_alerts[0].arn]
  ok_actions    = [aws_sns_topic.drift_alerts[0].arn]
}
