# Consolidated Shopify-app declarations.
#
# `module "full"` is the canonical home for the CPG Labs full app at
# app.cpg-labs.io. It uses `modules/shopify-app/main.tf` for ECS service,
# task def, target group, listener rule, log group, and SSM parameters.
#
# ── Why the legacy Omnify app is NOT consolidated into this file ─────────────
# An earlier note here said "Coexists with ecs.tf + gebeauty.tf + storytelling.tf
# until the main session runs `terraform state mv` to re-anchor live resources
# onto these module addresses, at which point the hand-rolled files are
# deleted." That plan worked for `module "full"` (net-new app at a new
# hostname — no migration needed) but does NOT work for Omnify because the
# module's naming convention `${name_prefix}-${app_name}-*` would produce:
#   omnify-tg          → omnify-omnify-tg
#   omnify-task        → omnify-omnify-task
#   omnify-service     → omnify-omnify-service
#   /omnify/SHOPIFY_*  → /omnify/OMNIFY_SHOPIFY_*
#   /ecs/omnify        → /ecs/omnify-omnify
# All of those names are immutable AWS primary identifiers — you can't
# rename a target group, an ECS service, or an SSM parameter; you destroy
# and recreate. That would mean Omnify service downtime + a window where
# omnify.cpg-labs.io has no listener rule. Not worth it.
#
# Decision (2026-05-02): legacy `ecs.tf` + `alb.tf` are the canonical home
# for the Omnify app. They use the names that match production. The
# `module "omnify"` block was removed from this file alongside that decision.
# Phase-6-style consolidation for Omnify would need a parameterized module
# (e.g. an optional `name_override` variable) AND a coordinated downtime
# migration; both are out of scope for the marketing-admin split work.
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

  shopify_api_key    = var.shopify_api_key_full
  shopify_api_secret = var.shopify_api_secret_full
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
  # Priority 11 — set during Phase 6 cutover when the legacy
  # `aws_lb_listener_rule.gebeauty` (path_pattern /full + /full/*) still held
  # priority 10. After Phase 6j retired that rule, priority 10 is free, but
  # priority 11 is kept to avoid an unnecessary listener-rule mutation.
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
