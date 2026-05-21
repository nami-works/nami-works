# Visibility — focused content & SEO app at storytelling.cpg-labs.io
# Set enable_storytelling = true and provide API keys in tfvars.

module "storytelling" {
  source = "./modules/shopify-app"
  count  = var.enable_storytelling ? 1 : 0

  app_name     = "storytelling"
  domain       = "storytelling.cpg-labs.io"
  app_identity = "storytelling"

  shopify_api_key    = var.shopify_api_key_storytelling
  shopify_api_secret = var.shopify_api_secret_storytelling
  database_url       = local.database_url
  shopify_scopes     = "read_content,write_content,read_products"
  image_tag          = var.image_tag_storytelling

  # Shared infra references
  name_prefix         = local.name_prefix
  ecs_cluster_id      = aws_ecs_cluster.app.id
  ecr_repository_url  = aws_ecr_repository.app.repository_url
  execution_role_arn  = var.create_iam ? aws_iam_role.ecs_execution[0].arn : var.execution_role_arn
  task_role_arn       = var.create_iam ? aws_iam_role.ecs_task[0].arn : var.task_role_arn
  vpc_id              = data.aws_vpc.default.id
  subnet_ids          = data.aws_subnets.default.ids
  security_group_id   = aws_security_group.ecs.id
  alb_listener_arn    = aws_lb_listener.https.arn
  listener_rule_priority = 40
  aws_region          = var.aws_region
  create_ssm           = var.create_ssm
  ssm_prefix           = local.ssm_prefix
  database_url_ssm_arn = var.create_ssm ? aws_ssm_parameter.database_url[0].arn : ""
}
