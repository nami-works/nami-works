resource "aws_cloudwatch_log_group" "gateway" {
  name              = "/ecs/nami-works-gateway"
  retention_in_days = var.log_retention_days
}
