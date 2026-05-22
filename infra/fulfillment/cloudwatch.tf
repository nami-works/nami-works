resource "aws_cloudwatch_log_group" "fulfillment" {
  name              = "/ecs/nami-works-fulfillment"
  retention_in_days = var.log_retention_days
}
