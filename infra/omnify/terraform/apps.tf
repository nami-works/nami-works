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

  # No BASE_PATH — dedicated hostname.
  # CLAUDE_CONTROL_TOKEN comes through `shared_secrets` below as an SSM
  # passthrough so it's not embedded in the task def as plain text.
  extra_env = []

  # Passthrough wiring for the 6 shared SSM secrets that the legacy gebeauty
  # task def carries (declared in ecs.tf, delivery-cron.tf, claude-control.tf).
  # Without these, the new app.cpg-labs.io service silently breaks: no map,
  # no Lalamove credentials, no Anthropic, no cron auth, no Claude control.
  shared_secrets = concat(
    [
      { name = "GOOGLE_MAPS_API_KEY", valueFrom = aws_ssm_parameter.google_maps_api_key[0].arn },
      { name = "GOOGLE_MAPS_MAP_ID", valueFrom = aws_ssm_parameter.google_maps_map_id[0].arn },
      { name = "APP_ENCRYPTION_KEY", valueFrom = aws_ssm_parameter.app_encryption_key[0].arn },
      { name = "ANTHROPIC_API_KEY", valueFrom = aws_ssm_parameter.anthropic_api_key[0].arn },
    ],
    var.enable_delivery_cron && var.cron_secret != "" ? [
      { name = "CRON_SECRET", valueFrom = aws_ssm_parameter.cron_secret[0].arn },
    ] : [],
    var.enable_claude_control && var.claude_control_token != "" ? [
      { name = "CLAUDE_CONTROL_TOKEN", valueFrom = aws_ssm_parameter.claude_control_token[0].arn },
    ] : [],
    var.enable_claude_control && var.claude_control_shop != "" ? [
      { name = "CLAUDE_CONTROL_SHOP", valueFrom = aws_ssm_parameter.claude_control_shop[0].arn },
    ] : [],
  )

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
  # Priority 11 (not 10) because the legacy `aws_lb_listener_rule.gebeauty`
  # (path_pattern /full + /full/*, declared in gebeauty.tf) currently holds
  # priority 10 and is retired after the Shopify-side application_url cuts
  # over to app.cpg-labs.io. Once retired, this can be moved back to 10 if
  # desired — but priority 11 is fine, host_header rules don't compete with
  # path_pattern rules semantically.
  listener_rule_priority = 11
  aws_region             = var.aws_region
  create_ssm             = var.create_ssm
  ssm_prefix             = local.ssm_prefix
  database_url_ssm_arn   = var.create_ssm ? aws_ssm_parameter.database_url[0].arn : ""
}

# Storytelling stays declared in `storytelling.tf` (already in Terraform state
# via `module.storytelling[0].*` addresses). Re-declaring it here would be a
# duplicate-module-call error. The Phase 6 consolidation uses storytelling.tf
# as the canonical declaration; apps.tf only owns omnify + full.
