locals {
  name_prefix    = var.project_name
  container_name = "${var.project_name}-app"
  log_group_name = "/ecs/${var.project_name}"
  database_url   = var.create_rds ? "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.app[0].address}:${aws_db_instance.app[0].port}/${var.db_name}?schema=public" : var.database_url
  ssm_prefix     = "/${var.project_name}"
}
