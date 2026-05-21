# ─────────────────────────────────────────────────────────────────────────────
# CloudWatch alarms — detect ECS crash-loops before they page someone
# ─────────────────────────────────────────────────────────────────────────────
#
# Alarms for the failure mode we hit on 2026-04-17: a Docker image built with
# the wrong BASE_PATH made the React Router basename mismatch the ALB path,
# which 404'd the health check, which crash-looped the ECS task every ~8 min.
#
# Phase 6j (2026-04-29) retired the legacy /full BASE_PATH path entirely —
# CPG Labs full now lives at app.cpg-labs.io with no basename. The
# basename_mismatch alarm is preserved as a defense-in-depth signal in case
# a future build accidentally re-introduces a basename mismatch.
#
# Two alarms target the new omnify-full service:
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

# ── Alarm 1: basename mismatch in omnify-full app logs ─────────────────────

resource "aws_cloudwatch_log_metric_filter" "full_basename_mismatch" {
  name           = "omnify-full-basename-mismatch"
  pattern        = "\"is not able to match the URL\""
  log_group_name = module.full.log_group_name

  metric_transformation {
    name          = "BasenameMismatch"
    namespace     = "CPGLabs/Full"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "full_basename_mismatch" {
  alarm_name          = "omnify-full-basename-mismatch"
  alarm_description   = "React Router basename doesn't match request URL on app.cpg-labs.io. Phase 6j removed BASE_PATH entirely, so any occurrence here is a regression — likely a build accidentally re-introduced a basename. Rebuild without --build-arg BASE_PATH."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  metric_name         = "BasenameMismatch"
  namespace           = "CPGLabs/Full"
  treat_missing_data  = "notBreaching"

  alarm_actions = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []
  ok_actions    = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []
}

# ── Alarm 2: ALB target group has no healthy hosts ─────────────────────────

resource "aws_cloudwatch_metric_alarm" "full_unhealthy_targets" {
  alarm_name          = "omnify-full-no-healthy-targets"
  alarm_description   = "omnify-full ALB target group has 0 healthy hosts for 3+ minutes on app.cpg-labs.io. Task is crash-looping, OOM, or stuck. Check ECS service events and /ecs/omnify-full logs."
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
    TargetGroup  = module.full.target_group_arn_suffix
  }

  alarm_actions = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []
  ok_actions    = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []
}
