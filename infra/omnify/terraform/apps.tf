# Consolidated Shopify-app declarations — Phase 6 target state.
#
# Each module block is a full app: ECS service, task def, target group, listener
# rule, log group, SSM. The structure lives exactly once in
# modules/shopify-app/main.tf.
#
# Coexists with ecs.tf + gebeauty.tf + storytelling.tf until the main session
# runs `terraform state mv` to re-anchor live resources onto these module
# addresses, at which point the hand-rolled files are deleted.

# ─────────────────────────────────────────────────────────────────────────────
# Omnify — focused delivery app at omnify.cpg-labs.io
# Marketing site (www.cpg-labs.io) piggybacks on this service via host-aware
# dispatch in app/routes/_site.*.tsx. Second listener rule at priority 21.
# ─────────────────────────────────────────────────────────────────────────────

module "omnify" {
  source = "./modules/shopify-app"

  app_name           = "omnify"
  domain             = "omnify.cpg-labs.io"
  additional_domains = ["www.cpg-labs.io"]
  app_identity       = "omnify"

  shopify_api_key    = var.shopify_api_key
  shopify_api_secret = var.shopify_api_secret
  database_url       = local.database_url
  shopify_scopes     = var.shopify_scopes_omnify
  image_tag          = var.image_tag_omnify

  # Shared infra references
  name_prefix            = local.name_prefix
  ecs_cluster_id         = aws_ecs_cluster.app.id
  ecr_repository_url     = aws_ecr_repository.app.repository_url
  execution_role_arn     = var.create_iam ? aws_iam_role.ecs_execution[0].arn : var.execution_role_arn
  task_role_arn          = var.create_iam ? aws_iam_role.ecs_task[0].arn : var.task_role_arn
  vpc_id                 = data.aws_vpc.default.id
  subnet_ids             = data.aws_subnets.default.ids
  security_group_id      = aws_security_group.ecs.id
  alb_listener_arn       = aws_lb_listener.https.arn
  listener_rule_priority = 20
  aws_region             = var.aws_region
  create_ssm             = var.create_ssm
  ssm_prefix             = local.ssm_prefix
  database_url_ssm_arn   = var.create_ssm ? aws_ssm_parameter.database_url[0].arn : ""
}

# ─────────────────────────────────────────────────────────────────────────────
# CPG Labs full — full feature set at app.cpg-labs.io
# Dedicated hostname kills BASE_PATH entirely; the whole /full/full/ bug class
# is structurally impossible once this lands. Shopify app config
# (shopify.app.toml) must be updated to application_url = https://app.cpg-labs.io
# and re-installed on GE Beauty.
# ─────────────────────────────────────────────────────────────────────────────

module "full" {
  source = "./modules/shopify-app"

  app_name     = "full"
  domain       = "app.cpg-labs.io"
  app_identity = "cpg-labs"

  # TODO(phase-6-rename): swap to var.shopify_api_key_full /
  # var.shopify_api_secret_full once the tfvars rename pass lands. For now we
  # reuse the existing _gebeauty inputs so the live secret value doesn't move.
  shopify_api_key    = var.shopify_api_key_gebeauty
  shopify_api_secret = var.shopify_api_secret_gebeauty
  database_url       = local.database_url
  shopify_scopes     = var.shopify_scopes_full
  image_tag          = var.image_tag_full

  # No BASE_PATH — dedicated hostname. CLAUDE_CONTROL_TOKEN is injected as an
  # extra env var (the claude_control_token var is declared in claude-control.tf).
  extra_env = var.enable_claude_control && var.claude_control_token != "" ? [
    { name = "CLAUDE_CONTROL_TOKEN", value = var.claude_control_token },
  ] : []

  # Shared infra references
  name_prefix            = local.name_prefix
  ecs_cluster_id         = aws_ecs_cluster.app.id
  ecr_repository_url     = aws_ecr_repository.app.repository_url
  execution_role_arn     = var.create_iam ? aws_iam_role.ecs_execution[0].arn : var.execution_role_arn
  task_role_arn          = var.create_iam ? aws_iam_role.ecs_task[0].arn : var.task_role_arn
  vpc_id                 = data.aws_vpc.default.id
  subnet_ids             = data.aws_subnets.default.ids
  security_group_id      = aws_security_group.ecs.id
  alb_listener_arn       = aws_lb_listener.https.arn
  listener_rule_priority = 10
  aws_region             = var.aws_region
  create_ssm             = var.create_ssm
  ssm_prefix             = local.ssm_prefix
  database_url_ssm_arn   = var.create_ssm ? aws_ssm_parameter.database_url[0].arn : ""
}

# ─────────────────────────────────────────────────────────────────────────────
# Storytelling — focused content & SEO app at storytelling.cpg-labs.io
# Duplicated from storytelling.tf for the Phase 6 consolidation; the legacy
# file is kept on disk until the main session completes `terraform state mv`
# and then deletes it.
# ─────────────────────────────────────────────────────────────────────────────

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
  name_prefix            = local.name_prefix
  ecs_cluster_id         = aws_ecs_cluster.app.id
  ecr_repository_url     = aws_ecr_repository.app.repository_url
  execution_role_arn     = var.create_iam ? aws_iam_role.ecs_execution[0].arn : var.execution_role_arn
  task_role_arn          = var.create_iam ? aws_iam_role.ecs_task[0].arn : var.task_role_arn
  vpc_id                 = data.aws_vpc.default.id
  subnet_ids             = data.aws_subnets.default.ids
  security_group_id      = aws_security_group.ecs.id
  alb_listener_arn       = aws_lb_listener.https.arn
  listener_rule_priority = 40
  aws_region             = var.aws_region
  create_ssm             = var.create_ssm
  ssm_prefix             = local.ssm_prefix
  database_url_ssm_arn   = var.create_ssm ? aws_ssm_parameter.database_url[0].arn : ""
}
