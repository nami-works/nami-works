# Canonical manifest of Shopify apps deployed from this repo.
#
# Every Shopify app that ships from the cpg-labs codebase has ONE entry here.
# `scripts/deploy.ps1 -App <key>` looks up the ECS service, task-def family,
# post-deploy health URL, and tag prefix from this file.
#
# Adding a new app is a one-line append:
#   'newapp' = @{ service = 'cpg-labs-newapp-service'; task_family = 'cpg-labs-newapp-task'; health_url = 'https://newapp.cpg-labs.io/health'; tag_prefix = 'cpg-labs-newapp'; image_tag_var = 'image_tag_newapp' }
#
# Keys:
#   service       — ECS service name in the canonical cluster (`cpg-labs`)
#   task_family   — ECS task-definition family name
#   health_url    — absolute URL hit after deploy to validate the ALB sees a 200
#   tag_prefix    — prefix for image tags (`<prefix>-<yyyymmdd>-<short-sha>`)
#   image_tag_var — Terraform variable name that receives the image tag (matches
#                   `infra/terraform/variables.tf` entries)

@{
  'full'         = @{ service = 'cpg-labs-full-service';         task_family = 'cpg-labs-full-task';         health_url = 'https://app.cpg-labs.io/health';          tag_prefix = 'cpg-labs-full';         image_tag_var = 'image_tag_full' }
  'omnify'       = @{ service = 'cpg-labs-omnify-service';       task_family = 'cpg-labs-omnify-task';       health_url = 'https://omnify.cpg-labs.io/health';       tag_prefix = 'cpg-labs-omnify';       image_tag_var = 'image_tag_omnify' }
  'storytelling' = @{ service = 'cpg-labs-storytelling-service'; task_family = 'cpg-labs-storytelling-task'; health_url = 'https://storytelling.cpg-labs.io/health'; tag_prefix = 'cpg-labs-storytelling'; image_tag_var = 'image_tag_storytelling' }
}
