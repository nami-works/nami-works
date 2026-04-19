resource "aws_cloudwatch_log_group" "app" {
  name              = local.log_group_name
  retention_in_days = 30
}

resource "aws_ecs_cluster" "app" {
  name = "${local.name_prefix}-cluster"
}

resource "aws_ssm_parameter" "shopify_api_key" {
  count = var.create_ssm ? 1 : 0
  name  = "${local.ssm_prefix}/SHOPIFY_API_KEY"
  type  = "SecureString"
  value = var.shopify_api_key
}

resource "aws_ssm_parameter" "shopify_api_secret" {
  count = var.create_ssm ? 1 : 0
  name  = "${local.ssm_prefix}/SHOPIFY_API_SECRET"
  type  = "SecureString"
  value = var.shopify_api_secret
}

resource "aws_ssm_parameter" "database_url" {
  count = var.create_ssm ? 1 : 0
  name  = "${local.ssm_prefix}/DATABASE_URL"
  type  = "SecureString"
  value = local.database_url
}

resource "aws_ssm_parameter" "google_maps_api_key" {
  count = var.create_ssm ? 1 : 0
  name  = "${local.ssm_prefix}/GOOGLE_MAPS_API_KEY"
  type  = "SecureString"
  value = var.google_maps_api_key
}

resource "aws_ssm_parameter" "google_maps_map_id" {
  count = var.create_ssm ? 1 : 0
  name  = "${local.ssm_prefix}/GOOGLE_MAPS_MAP_ID"
  type  = "SecureString"
  value = var.google_maps_map_id
}

resource "aws_ssm_parameter" "app_encryption_key" {
  count  = var.create_ssm && var.app_encryption_key != "" ? 1 : 0
  name   = "${local.ssm_prefix}/APP_ENCRYPTION_KEY"
  type   = "SecureString"
  value  = var.app_encryption_key
}

resource "aws_ssm_parameter" "anthropic_api_key" {
  count = var.create_ssm && var.anthropic_api_key != "" ? 1 : 0
  name  = "${local.ssm_prefix}/ANTHROPIC_API_KEY"
  type  = "SecureString"
  value = var.anthropic_api_key
}

resource "aws_ecs_task_definition" "app" {
  family                   = "${local.name_prefix}-task"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = var.create_iam ? aws_iam_role.ecs_execution[0].arn : var.execution_role_arn
  task_role_arn            = var.create_iam ? aws_iam_role.ecs_task[0].arn : var.task_role_arn

  container_definitions = jsonencode([
    {
      name      = local.container_name
      image     = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"
      essential = true
      portMappings = [
        {
          containerPort = var.app_port
          hostPort      = var.app_port
          protocol      = "tcp"
        }
      ]
      environment = concat(
        [
          { name = "NODE_ENV", value = "production" },
          { name = "SHOPIFY_APP_URL", value = var.shopify_app_url },
          { name = "SCOPES", value = var.shopify_scopes },
          { name = "APP_ENCRYPTION_KEY_VERSION", value = var.app_encryption_key_version }
        ],
        var.create_ssm ? [] : concat(
          [
            { name = "SHOPIFY_API_KEY", value = var.shopify_api_key },
            { name = "SHOPIFY_API_SECRET", value = var.shopify_api_secret },
            { name = "DATABASE_URL", value = local.database_url },
            { name = "GOOGLE_MAPS_API_KEY", value = var.google_maps_api_key },
            { name = "GOOGLE_MAPS_MAP_ID", value = var.google_maps_map_id }
          ],
          var.app_encryption_key != "" ? [{ name = "APP_ENCRYPTION_KEY", value = var.app_encryption_key }] : [],
          var.anthropic_api_key != "" ? [{ name = "ANTHROPIC_API_KEY", value = var.anthropic_api_key }] : [],
          var.enable_delivery_cron && var.cron_secret != "" ? [{ name = "CRON_SECRET", value = var.cron_secret }] : [],
          var.enable_claude_control && var.claude_control_token != "" ? [{ name = "CLAUDE_CONTROL_TOKEN", value = var.claude_control_token }] : [],
          var.enable_claude_control && var.claude_control_shop != "" ? [{ name = "CLAUDE_CONTROL_SHOP", value = var.claude_control_shop }] : []
        )
      )
      secrets = var.create_ssm ? concat(
        [
          { name = "SHOPIFY_API_KEY", valueFrom = aws_ssm_parameter.shopify_api_key[0].arn },
          { name = "SHOPIFY_API_SECRET", valueFrom = aws_ssm_parameter.shopify_api_secret[0].arn },
          { name = "DATABASE_URL", valueFrom = aws_ssm_parameter.database_url[0].arn },
          { name = "GOOGLE_MAPS_API_KEY", valueFrom = aws_ssm_parameter.google_maps_api_key[0].arn },
          { name = "GOOGLE_MAPS_MAP_ID", valueFrom = aws_ssm_parameter.google_maps_map_id[0].arn }
        ],
        var.app_encryption_key != "" ? [{ name = "APP_ENCRYPTION_KEY", valueFrom = aws_ssm_parameter.app_encryption_key[0].arn }] : [],
        var.anthropic_api_key != "" ? [{ name = "ANTHROPIC_API_KEY", valueFrom = aws_ssm_parameter.anthropic_api_key[0].arn }] : [],
        var.enable_delivery_cron && var.cron_secret != "" ? [{ name = "CRON_SECRET", valueFrom = aws_ssm_parameter.cron_secret[0].arn }] : [],
        var.enable_claude_control && var.claude_control_token != "" ? [{ name = "CLAUDE_CONTROL_TOKEN", valueFrom = aws_ssm_parameter.claude_control_token[0].arn }] : [],
        var.enable_claude_control && var.claude_control_shop != "" ? [{ name = "CLAUDE_CONTROL_SHOP", valueFrom = aws_ssm_parameter.claude_control_shop[0].arn }] : []
      ) : []
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.app.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "app"
        }
      }
    }
  ])

  # Deploy script (`scripts/deploy-omnify.ps1`) owns image rollouts. See the
  # equivalent comment in gebeauty.tf for the full rationale and the
  # `terraform apply -replace=...` recipe for schema changes.
  lifecycle {
    ignore_changes = [container_definitions]
  }
}

resource "aws_ecs_service" "app" {
  name            = "${local.name_prefix}-service"
  cluster         = aws_ecs_cluster.app.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = local.container_name
    container_port   = var.app_port
  }

  depends_on = [aws_lb_listener.https]
}
