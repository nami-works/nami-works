# Canonical manifest of Shopify apps deployed from this repo.
#
# Every Shopify app that ships from the cpg-labs codebase has ONE entry here.
# `scripts/deploy.ps1 -App <key>` looks up the ECS service, task-def family,
# post-deploy health URL, and tag prefix from this file.
#
# Adding a new app is a one-line append:
#   'newapp' = @{ service = 'omnify-newapp-service'; task_family = 'omnify-newapp-task'; health_url = 'https://newapp.cpg-labs.io/health'; tag_prefix = 'cpg-labs-newapp'; image_tag_var = 'image_tag_newapp' }
#
# Keys:
#   service       — ECS service name in the canonical cluster (`cpg-labs`)
#   task_family   — ECS task-definition family name
#   health_url    — absolute URL hit after deploy to validate the ALB sees a 200
#   tag_prefix    — prefix for image tags (`<prefix>-<yyyymmdd>-<short-sha>`)
#   image_tag_var — Terraform variable name that receives the image tag (matches
#                   `infra/terraform/variables.tf` entries)
#
# Note on prefix mismatch: services are named `omnify-*` (var.project_name =
# "omnify") while the cluster is `cpg-labs` and the brand/tag prefix is
# `cpg-labs-*`. This is intentional — flipping project_name to cpg-labs in
# Phase 5 would have destroy/recreated all live services in a cascade. The
# service names will be migrated in a future scheduled flip; until then,
# `omnify-*` IS the canonical service prefix.

@{
  'full'   = @{ service = 'omnify-full-service'; task_family = 'omnify-full-task'; health_url = 'https://app.cpg-labs.io/health';    tag_prefix = 'cpg-labs-full';   image_tag_var = 'image_tag_full' }
  'omnify' = @{ service = 'omnify-service';      task_family = 'omnify-task';      health_url = 'https://omnify.cpg-labs.io/health'; tag_prefix = 'cpg-labs-omnify'; image_tag_var = 'image_tag_omnify' }
  # 'storytelling' — currently NOT deployed (var.enable_storytelling = false in tfvars).
  # Re-enable when the Storytelling app is brought back online; service name will
  # be `omnify-storytelling-service` to match the existing project_name prefix.
}
