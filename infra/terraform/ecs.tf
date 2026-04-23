// Task definition holds a placeholder image tag. scripts/deploy.ps1 builds
// a new image, pushes to ECR, and registers a new revision with the real
// tag — so `container_definitions` is ignored after bootstrap.

resource "aws_ecs_task_definition" "gateway" {
  family                   = "nami-works-gateway"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task_app.arn

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([{
    name      = "gateway"
    image     = "${aws_ecr_repository.gateway.repository_url}:bootstrap"
    essential = true

    portMappings = [{
      containerPort = 3000
      protocol      = "tcp"
    }]

    environment = [
      { name = "NODE_ENV",   value = "production" },
      { name = "PORT",       value = "3000" },
      { name = "HOST",       value = "0.0.0.0" },
      { name = "LOG_LEVEL",  value = "info" },
      { name = "AWS_REGION", value = var.region },
    ]

    secrets = [
      { name = "DATABASE_URL",       valueFrom = aws_ssm_parameter.database_url.arn },
      { name = "OAUTH_SIGNING_KEY", valueFrom = aws_ssm_parameter.oauth_signing_key.arn },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.gateway.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "ecs"
      }
    }
  }])

  lifecycle {
    // The deploy script owns container_definitions — each deploy registers a
    // new revision, and we don't want Terraform rolling it back.
    ignore_changes = [container_definitions]
  }
}

resource "aws_ecs_service" "gateway" {
  name            = "nami-works-gateway"
  cluster         = var.ecs_cluster_name
  task_definition = aws_ecs_task_definition.gateway.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.ecs_task.id]
    assign_public_ip = true // VPC has no NAT; public IP is how tasks reach the internet.
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.gateway.arn
    container_name   = "gateway"
    container_port   = 3000
  }

  lifecycle {
    // Deploys bump task_definition to new revisions; Terraform shouldn't
    // fight the deploy script.
    ignore_changes = [task_definition, desired_count]
  }

  depends_on = [
    aws_lb_listener_rule.gateway,
    aws_lb_listener_certificate.gateway,
  ]
}
