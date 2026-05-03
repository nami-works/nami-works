# Reusable module for deploying a Shopify app as an ECS Fargate service
# behind an existing ALB with host-based routing.

locals {
  container_name = "${var.name_prefix}-${var.app_name}-app"
  log_group_name = "/ecs/${var.name_prefix}-${var.app_name}"
}

# ---------- CloudWatch ----------

resource "aws_cloudwatch_log_group" "app" {
  name              = local.log_group_name
  retention_in_days = 30
}

# ---------- SSM Parameters ----------

resource "aws_ssm_parameter" "shopify_api_key" {
  count = var.create_ssm ? 1 : 0
  name  = "${var.ssm_prefix}/${upper(replace(var.app_name, "-", "_"))}_SHOPIFY_API_KEY"
  type  = "SecureString"
  value = var.shopify_api_key
}

resource "aws_ssm_parameter" "shopify_api_secret" {
  count = var.create_ssm ? 1 : 0
  name  = "${var.ssm_prefix}/${upper(replace(var.app_name, "-", "_"))}_SHOPIFY_API_SECRET"
  type  = "SecureString"
  value = var.shopify_api_secret
}

# DATABASE_URL is shared across all apps — use the existing SSM parameter
# rather than creating per-app duplicates. The ARN is passed via var.database_url_ssm_arn.

# ---------- Target Group ----------

resource "aws_lb_target_group" "app" {
  name        = "${var.name_prefix}-${var.app_name}-tg"
  port        = var.app_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    matcher             = "200"
  }
}

# ---------- ALB Listener Rule (host-based) ----------

resource "aws_lb_listener_rule" "app" {
  listener_arn = var.alb_listener_arn
  priority     = var.listener_rule_priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }

  condition {
    host_header {
      values = [var.domain]
    }
  }
}

# Additional hostnames → same target group. One listener rule per extra
# hostname, each at its own priority slot immediately after the primary rule.
# Used for the marketing-on-Omnify conflation (www.cpg-labs.io piggybacks on
# the omnify service via host-aware dispatch in app/routes/_site.*.tsx).
resource "aws_lb_listener_rule" "app_additional" {
  for_each = { for idx, domain in var.additional_domains : domain => idx }

  listener_arn = var.alb_listener_arn
  priority     = var.listener_rule_priority + 1 + each.value

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }

  condition {
    host_header {
      values = [each.key]
    }
  }
}

# ---------- ECS Task Definition ----------

resource "aws_ecs_task_definition" "app" {
  family                   = "${var.name_prefix}-${var.app_name}-task"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  container_definitions = jsonencode([
    {
      name      = local.container_name
      image     = "${var.ecr_repository_url}:${var.image_tag}"
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
          { name = "APP_IDENTITY", value = var.app_identity },
          { name = "SHOPIFY_APP_URL", value = "https://${var.domain}" },
          { name = "SCOPES", value = var.shopify_scopes },
          { name = "APP_ENCRYPTION_KEY_VERSION", value = var.app_encryption_key_version },
        ],
        var.extra_env,
        var.create_ssm ? [] : concat(
          [
            { name = "SHOPIFY_API_KEY", value = var.shopify_api_key },
            { name = "SHOPIFY_API_SECRET", value = var.shopify_api_secret },
            { name = "DATABASE_URL", value = var.database_url },
          ],
          var.google_maps_api_key != "" ? [{ name = "GOOGLE_MAPS_API_KEY", value = var.google_maps_api_key }] : [],
          var.google_maps_map_id != "" ? [{ name = "GOOGLE_MAPS_MAP_ID", value = var.google_maps_map_id }] : [],
          var.app_encryption_key != "" ? [{ name = "APP_ENCRYPTION_KEY", value = var.app_encryption_key }] : [],
        )
      )
      secrets = var.create_ssm ? concat(
        [
          { name = "SHOPIFY_API_KEY", valueFrom = aws_ssm_parameter.shopify_api_key[0].arn },
          { name = "SHOPIFY_API_SECRET", valueFrom = aws_ssm_parameter.shopify_api_secret[0].arn },
          { name = "DATABASE_URL", valueFrom = var.database_url_ssm_arn },
        ],
        var.shared_secrets,
      ) : []
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.app.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = var.app_name
        }
      }
    }
  ])
}

# ---------- ECS Service ----------

resource "aws_ecs_service" "app" {
  name            = "${var.name_prefix}-${var.app_name}-service"
  cluster         = var.ecs_cluster_id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  # Match the existing live setting (auto-rebalance Fargate tasks across AZs
  # after a failure). AWS console enables this by default for new services.
  availability_zone_rebalancing = "ENABLED"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [var.security_group_id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = local.container_name
    container_port   = var.app_port
  }

  # The deploy script (`scripts/deploy.ps1 -App <key>`) registers new task-
  # definition revisions and points the service at them. Terraform's state
  # freezes at whatever revision was current when terraform last applied,
  # which can be many revisions behind production. Without this lifecycle
  # ignore, a `terraform apply` would silently roll the running service
  # BACK to the stale revision in state, blowing away weeks of deploys.
  # Same pattern as `aws_ecs_task_definition.app`'s `ignore_changes =
  # [container_definitions]` — the deploy script owns these fields.
  lifecycle {
    ignore_changes = [task_definition]
  }

  depends_on = [aws_lb_listener_rule.app]
}
