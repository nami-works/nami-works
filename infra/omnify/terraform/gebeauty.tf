# Custom app CPG Labs at omnify.cpg-labs.io${var.gebeauty_base_path}.
# Set enable_gebeauty = true and shopify_api_key_gebeauty, shopify_api_secret_gebeauty in tfvars.

resource "aws_lb_target_group" "gebeauty" {
  count = var.enable_gebeauty ? 1 : 0

  name        = "${local.name_prefix}-gebeauty-tg"
  port        = var.app_port
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.default.id
  target_type = "ip"

  health_check {
    path                = "${var.gebeauty_base_path}/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    matcher             = "200"
  }
}

resource "aws_lb_listener_rule" "gebeauty" {
  count = var.enable_gebeauty ? 1 : 0

  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.gebeauty[0].arn
  }

  condition {
    path_pattern {
      values = [var.gebeauty_base_path, "${var.gebeauty_base_path}/*"]
    }
  }
}

resource "aws_cloudwatch_log_group" "gebeauty" {
  count = var.enable_gebeauty ? 1 : 0

  name              = "/ecs/${local.name_prefix}-gebeauty"
  retention_in_days  = 30
}

resource "aws_ecs_task_definition" "gebeauty" {
  count = var.enable_gebeauty ? 1 : 0

  family                   = "${local.name_prefix}-gebeauty-task"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = var.create_iam ? aws_iam_role.ecs_execution[0].arn : var.execution_role_arn
  task_role_arn            = var.create_iam ? aws_iam_role.ecs_task[0].arn : var.task_role_arn

  container_definitions = jsonencode([
    {
      name      = "${local.name_prefix}-gebeauty-app"
      image     = "${aws_ecr_repository.app.repository_url}:${var.image_tag_gebeauty}"
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
          { name = "BASE_PATH", value = var.gebeauty_base_path },
          { name = "SHOPIFY_APP_URL", value = "https://${var.domain_name}${var.gebeauty_base_path}" },
          { name = "SCOPES", value = var.shopify_scopes },
          { name = "APP_ENCRYPTION_KEY_VERSION", value = var.app_encryption_key_version }
        ],
        var.create_ssm ? [] : concat(
          [
            { name = "SHOPIFY_API_KEY", value = var.shopify_api_key_gebeauty },
            { name = "SHOPIFY_API_SECRET", value = var.shopify_api_secret_gebeauty },
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
          { name = "SHOPIFY_API_KEY", valueFrom = aws_ssm_parameter.shopify_api_key_gebeauty[0].arn },
          { name = "SHOPIFY_API_SECRET", valueFrom = aws_ssm_parameter.shopify_api_secret_gebeauty[0].arn },
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
          awslogs-group         = aws_cloudwatch_log_group.gebeauty[0].name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "gebeauty"
        }
      }
    }
  ])

  # The deploy script (`scripts/deploy-cpg-labs.ps1`) is the single source of
  # truth for the running image. Each deploy registers a new task definition
  # revision via `aws ecs register-task-definition` with the new image tag and
  # carries forward env/secrets from the previous revision. Terraform creates
  # the initial task def and provisions structural changes; never let it
  # silently revert the image after a deploy.
  #
  # When schema-level fields change (env vars, secrets, cpu, memory),
  # explicitly force the update with:
  #   terraform apply -replace=aws_ecs_task_definition.gebeauty[0]
  lifecycle {
    ignore_changes = [container_definitions]
  }
}

resource "aws_ssm_parameter" "shopify_api_key_gebeauty" {
  count = var.enable_gebeauty && var.create_ssm ? 1 : 0

  name  = "${local.ssm_prefix}/GEBEAUTY_SHOPIFY_API_KEY"
  type  = "SecureString"
  value = var.shopify_api_key_gebeauty
}

resource "aws_ssm_parameter" "shopify_api_secret_gebeauty" {
  count = var.enable_gebeauty && var.create_ssm ? 1 : 0

  name  = "${local.ssm_prefix}/GEBEAUTY_SHOPIFY_API_SECRET"
  type  = "SecureString"
  value = var.shopify_api_secret_gebeauty
}

resource "aws_ecs_service" "gebeauty" {
  count = var.enable_gebeauty ? 1 : 0

  name            = "${local.name_prefix}-gebeauty-service"
  cluster         = aws_ecs_cluster.app.id
  task_definition = aws_ecs_task_definition.gebeauty[0].arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.gebeauty[0].arn
    container_name   = "${local.name_prefix}-gebeauty-app"
    container_port   = var.app_port
  }

  depends_on = [aws_lb_listener_rule.gebeauty]
}