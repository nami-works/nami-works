# Adding a New Shopify App

Runbook for spinning up a new Shopify app on the CPG Labs platform. Post-consolidation this is a **config-only** exercise — zero code changes, zero new Docker images, zero bespoke deploy scripts. One codebase serves many published apps, gated at runtime by `APP_IDENTITY`.

Before you start, read [docs/aws-topology.md](aws-topology.md) for context and [docs/deploy-runbook.md](deploy-runbook.md) for the mechanics.

## Decision tree: what kind of new app is this?

Three tiers. Pick one before touching any files.

### Tier 1 — Same feature set, different merchant

Example: a new CPG Labs Custom App for another beauty client. Identical feature surface to the existing "full" app; only Shopify credentials, branding, and install target change.

- **`APP_IDENTITY`:** reuse existing (`cpg-labs`, `omnify`, `storytelling`, etc.).
- **Code changes:** none.
- **New infra:** new ECS service, new target group, new listener rule, new hostname.

### Tier 2 — Different feature slice, same codebase

Example: a stripped-down variant that only has Local Delivery, or a storefront-only tool.

- **`APP_IDENTITY`:** new value (e.g. `delivery-only`).
- **Code changes:** one new entry in `IDENTITY_ROUTES` and (optionally) `IDENTITY_NAV` inside [app/utils/app-identity.server.ts](../app/utils/app-identity.server.ts). Also update the `AppIdentity` union type and `APP_DISPLAY_NAMES`.
- **New infra:** same as Tier 1.

### Tier 3 — New app, new vertical

Example: NAMI Works (already implemented — separate repo at `Desktop/nami-works/`).

- Probably a new repo.
- Only overlap is sharing the AWS account, cluster, and ALB if convenient.
- Out of scope for this runbook.

If unsure: default to Tier 1 if the new app reuses existing features, Tier 2 if the feature list differs, Tier 3 if the product is fundamentally different (different industry, different user, different data model).

## The five config-only steps (Tier 1 / Tier 2)

### Step 1 — Shopify Partner Dashboard (~5 min)

1. Open Partner Dashboard → Apps → Create app → Custom or Public per use case.
2. Copy the `client_id` and `client_secret`.
3. Decide the hostname. Convention: `<slug>.cpg-labs.io`. Examples: `app.cpg-labs.io` (full), `omnify.cpg-labs.io`, `storytelling.cpg-labs.io`.

### Step 2 — Add a Shopify config TOML (~1 min)

Create `shopify.app.<slug>.toml` at the repo root. Copy from [shopify.app.storytelling.toml](../shopify.app.storytelling.toml) as the template. Fill in:

- `client_id` = the value from Step 1.
- `application_url` = `https://<slug>.cpg-labs.io` (or for the full app: `https://app.cpg-labs.io`).
- `[access_scopes]` = minimum required for this app's feature surface.
- `[webhooks]` — subscriptions this app needs. Always include compliance webhooks (`customers/data_request`, `customers/redact`, `shop/redact`).

This file is what the Shopify CLI pushes to the Partner Dashboard via `shopify app deploy --config shopify.app.<slug>.toml`. It does not affect AWS.

### Step 3 — Add a Terraform module block (~1 min)

Append to [infra/terraform/apps.tf](../infra/terraform/apps.tf) (post-consolidation; until Phase 6 lands, copy [infra/terraform/storytelling.tf](../infra/terraform/storytelling.tf) as a template):

```hcl
module "<slug>" {
  source              = "./modules/shopify-app"

  app_name            = "<slug>"                     # drives resource names: cpg-labs-<slug>-*
  domain              = "<slug>.cpg-labs.io"         # primary hostname (host-based ALB rule)
  additional_domains  = []                           # extra hostnames pointing at the same TG (rare)

  app_identity        = "<identity>"                 # Tier 1: reuse. Tier 2: new identity + IDENTITY_ROUTES entry.

  shopify_api_key     = var.shopify_api_key_<slug>
  shopify_api_secret  = var.shopify_api_secret_<slug>
  shopify_scopes      = "<comma-separated-scopes>"

  image_tag           = var.image_tag_<slug>         # "<slug>-<yyyymmdd>-<sha>"

  extra_env           = []                           # any app-specific env vars
}
```

Also add the per-app variables to [infra/terraform/variables.tf](../infra/terraform/variables.tf) and the values to `terraform.tfvars` (never commit `terraform.tfvars` with real secrets — use SSM).

The module auto-creates: ECS service, task definition, target group, ALB listener rule(s), log group, SSM parameters for credentials. Everything follows the single pattern from [infra/terraform/modules/shopify-app/main.tf](../infra/terraform/modules/shopify-app/main.tf).

**Only for Tier 2** — add the identity to [app/utils/app-identity.server.ts](../app/utils/app-identity.server.ts):

```ts
export type AppIdentity = "cpg-labs" | "omnify" | "storytelling" | "storefront" | "<new-identity>";

// in APP_DISPLAY_NAMES:
"<new-identity>": "Display Name"

// in IDENTITY_ROUTES:
"<new-identity>": [
  "app.<route-prefix-1>",
  "app.<route-prefix-2>",
  // ...
]

// in IDENTITY_NAV:
"<new-identity>": ["/app/<route-1>", "/app/<route-2>"]

// in getHomeRoute() switch:
case "<new-identity>": return "/app/<home-route>";
```

### Step 4 — DNS + ACM (~5 min, one-time per hostname)

**DNS:** Route 53 (or your registrar) — add a CNAME/ALIAS from `<slug>.cpg-labs.io` to the ALB DNS name (`omnify-alb-*.us-east-1.elb.amazonaws.com`).

**ACM cert:**

- **Recommended:** use a wildcard `*.cpg-labs.io` certificate. One-time DNS validation; every future app works with zero cert churn.
- **Alternative:** add the new hostname as a SAN on the existing ALB cert and re-validate. More work, more churn.

If you're setting up the wildcard today, use DNS validation via Route 53 and attach to the ALB listener:

```powershell
aws acm request-certificate `
  --domain-name "*.cpg-labs.io" `
  --subject-alternative-names "cpg-labs.io" `
  --validation-method DNS `
  --region us-east-1
```

Then in Terraform, reference the new cert ARN on [infra/terraform/alb.tf](../infra/terraform/alb.tf)'s listener resource.

### Step 5 — Add to the deploy manifest + deploy (~5 min)

1. Append an entry to [scripts/apps.psd1](../scripts/apps.psd1):
   ```powershell
   '<slug>' = @{
     service     = 'cpg-labs-<slug>-service'
     task_family = 'cpg-labs-<slug>-task'
     health_url  = 'https://<slug>.cpg-labs.io/health'
     tag_prefix  = '<slug>'
   }
   ```

2. `terraform plan` (in `infra/terraform/`) — expected: creates SSM parameters, TG, listener rule, log group, task def, service for the new module. No destroys.

3. `terraform apply`.

4. Build + ship the first image:
   ```powershell
   ./scripts/deploy.ps1 -App <slug>
   ```
   Builds from the existing codebase, tags as `<slug>-<yyyymmdd>-<sha>`, pushes, updates the service.

5. Push Shopify config (scopes + webhooks):
   ```powershell
   shopify app deploy --config shopify.app.<slug>.toml
   ```

6. Install the app on a merchant store from the Partner Dashboard.

### Shortcut: the onboarding generator

`./scripts/new-app.ps1 -Name <slug> -Domain <host> -Identity <identity>` does Steps 2, 3, and the apps.psd1 portion of Step 5 automatically. It:

- Stubs `shopify.app.<slug>.toml` from a template.
- Appends a `module "<slug>"` block to `infra/terraform/apps.tf`.
- Appends an entry to `scripts/apps.psd1`.
- Prints the remaining manual steps (Partner Dashboard create, DNS, ACM, `terraform apply`).

The generator is not a substitute for understanding the 5 steps — but it removes the error-prone copy-paste.

## What does NOT change per new app

- **The codebase** (`app/routes/**`, `app/services/**`, `packages/**`). Zero edits for Tier 1.
- **The Docker image source.** One `Dockerfile`, one `npm run build`. Per-app differentiation happens at runtime via `APP_IDENTITY`.
- **The ECS cluster.** Everything runs on `cpg-labs`.
- **The ALB.** Everything routes through `omnify-alb:443` with host-based rules.
- **The ECR repo.** One repo (`omnify-app`); per-app tag prefix distinguishes images.
- **The deploy script.** `scripts/deploy.ps1 -App <slug>` reads `apps.psd1`; no new script.

## Verification

After the first deploy:

```powershell
# Service is healthy, running 1 task
aws ecs describe-services `
  --cluster cpg-labs --services cpg-labs-<slug>-service `
  --region us-east-1

# TG has exactly one healthy IP
aws elbv2 describe-target-health `
  --target-group-arn <new-tg-arn> --region us-east-1

# Hostname resolves and returns 200
curl https://<slug>.cpg-labs.io/health
```

Install on a test store, run the app end-to-end, verify OAuth + webhooks + the app's primary feature.

## When this runbook doesn't apply

- **Tier 3 (new vertical, probably new repo):** set up infra independently. NAMI Works at `Desktop/nami-works/` is the reference — its own repo, own domain (`mcp.nami.works`), shares only the cluster + ALB for convenience.
- **Non-Shopify apps:** the module targets Shopify app patterns (OAuth, webhooks, `client_id`/`client_secret`). For a generic service, use the module as inspiration but author a new one.
- **A published Public App (not Custom App) with marketplace listing:** add the listing flow to this runbook once experienced with it. The Shopify review process is orthogonal to infra.

## Cross-references

- Topology: [docs/aws-topology.md](aws-topology.md)
- Deploy mechanics and rollback: [docs/deploy-runbook.md](deploy-runbook.md)
- Project conventions: [CLAUDE.md](../CLAUDE.md)
- The `APP_IDENTITY` runtime gate: [app/utils/app-identity.server.ts](../app/utils/app-identity.server.ts)
- Storytelling app as the module template: [infra/terraform/storytelling.tf](../infra/terraform/storytelling.tf) and [infra/terraform/modules/shopify-app/main.tf](../infra/terraform/modules/shopify-app/main.tf)
