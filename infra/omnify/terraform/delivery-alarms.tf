# ─────────────────────────────────────────────────────────────────────────────
# CloudWatch alarms — detect ECS crash-loops before they page someone
# ─────────────────────────────────────────────────────────────────────────────
#
# Alarms for the failure mode we hit on 2026-04-17: a Docker image built with
# the wrong BASE_PATH makes the React Router basename mismatch the ALB path,
# which 404s the health check, which crash-loops the ECS task every ~8 min.
#
# Two alarms:
#
# 1. basename_mismatch — counts log lines like:
#    `<Router basename="..."> is not able to match the URL "..."`
#    A single line means the deployed bundle is wrong. Fires within 5 min.
#
# 2. unhealthy_targets — ALB target group has 0 healthy hosts for 3 min.
#    Catches anything that makes the task unreachable (OOM, crash, etc.)
#    not just basename errors.
#
# Fires to SNS topic if var.alarm_sns_topic_arn is provided; otherwise the
# alarm exists in ALARM state but doesn't notify anyone.

variable "alarm_sns_topic_arn" {
  description = "Optional SNS topic ARN for alarm notifications. If empty, alarms exist but don't notify."
  type        = string
  default     = ""
}

# ── Alarm 1: basename mismatch in gebeauty app logs ────────────────────────

resource "aws_cloudwatch_log_metric_filter" "gebeauty_basename_mismatch" {
  count = var.enable_gebeauty ? 1 : 0

  name           = "gebeauty-basename-mismatch"
  pattern        = "\"is not able to match the URL\""
  log_group_name = aws_cloudwatch_log_group.gebeauty[0].name

  metric_transformation {
    name          = "BasenameMismatch"
    namespace     = "CPGLabs/Gebeauty"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "gebeauty_basename_mismatch" {
  count = var.enable_gebeauty ? 1 : 0

  alarm_name          = "gebeauty-basename-mismatch"
  alarm_description   = "React Router basename doesn't match request URL. The deployed image was built with wrong BASE_PATH. Rebuild with --no-cache and correct --build-arg BASE_PATH."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  metric_name         = "BasenameMismatch"
  namespace           = "CPGLabs/Gebeauty"
  treat_missing_data  = "notBreaching"

  alarm_actions = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []
  ok_actions    = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []
}

# ── Alarm 2: ALB target group has no healthy hosts ─────────────────────────

resource "aws_cloudwatch_metric_alarm" "gebeauty_unhealthy_targets" {
  count = var.enable_gebeauty ? 1 : 0

  alarm_name          = "gebeauty-no-healthy-targets"
  alarm_description   = "Gebeauty ALB target group has 0 healthy hosts for 3+ minutes. Task is crash-looping, OOM, or stuck. Check ECS service events and /ecs/omnify-gebeauty logs."
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 3
  period              = 60
  statistic           = "Minimum"
  threshold           = 1
  metric_name         = "HealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  treat_missing_data  = "breaching"

  dimensions = {
    LoadBalancer = aws_lb.app.arn_suffix
    TargetGroup  = aws_lb_target_group.gebeauty[0].arn_suffix
  }

  alarm_actions = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []
  ok_actions    = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []
}
