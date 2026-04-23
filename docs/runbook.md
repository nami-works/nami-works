# Operator Runbook — NAMI Works

Practical playbook for the day-to-day operator (currently Lucas; future contractors). Step-by-step for the operations you'll run repeatedly. Each section is self-contained — go straight to the heading you need.

---

## Onboard a new tenant

End-to-end: from a signed contract to a working `claude.ai` connector.

### 1. Provision the tenant

```powershell
npm run provision-tenant -- `
  --slug=<short-slug> `
  --brand=cpg-labs `
  --display-name="<Customer Display Name>" `
  --shop=<storehandle>.myshopify.com `
  --contact=<contact-email>
```

Outputs:
- A new bearer (shown ONCE — copy to password manager)
- 3 SSM SecureString placeholders at `/nami-works/tenants/<slug>/`

### 2. Get the customer's Shopify access token

In the customer's Shopify admin → Settings → Apps and sales channels → Develop apps → **Create custom app**. Required scopes:

```
read_orders, read_customers, read_products, write_products,
read_discounts, write_discounts, read_locations
```

(Add `read_inventory, write_inventory` if you'll port delivery dispatch tools.)

Reveal the token (`shpat_...`) and stash in your password manager.

### 3. Push the credentials to SSM

```powershell
aws ssm put-parameter `
  --name "/nami-works/tenants/<slug>/shopify/access_token" `
  --value "shpat_..." `
  --type SecureString --overwrite

# If the customer uses Omie:
aws ssm put-parameter `
  --name "/nami-works/tenants/<slug>/omie/app_key" `
  --value "..." --type SecureString --overwrite
aws ssm put-parameter `
  --name "/nami-works/tenants/<slug>/omie/app_secret" `
  --value "..." --type SecureString --overwrite
```

(In Git Bash prefix with `MSYS_NO_PATHCONV=1`.)

### 4. Customer registers the connector in claude.ai

Have the customer's Primary Owner go to claude.ai → Connectors → Add custom connector:
- **URL**: `https://mcp.nami.works/<slug>`
- **Auth**: leave OAuth Client ID / Secret empty
- Click **Add**

Claude.ai redirects them to a NAMI Works consent page. They paste the bearer (you sent it via the agreed secure channel — Signal / 1Password share). They click **Authorize**. Done.

### 5. Smoke test

```powershell
$env:NAMI_BEARER = "<bearer>"
curl.exe -X POST https://mcp.nami.works/<slug> `
  -H "Authorization: Bearer $env:NAMI_BEARER" `
  -H "Content-Type: application/json" `
  -H "Accept: application/json, text/event-stream" `
  -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}'
```

Should return ~20 tools. If 401, recheck the SSM token. If 503, recheck the DB has the tenant row. If "no tools", the deploy may be stuck on bootstrap image — see "Redeploy" section.

---

## Suspend / activate a tenant (kill switch)

Use when:
- Customer is past due → `--` (default) suspends.
- Customer offboarded → `--disable`.
- Reactivate after payment → `--activate`.

```powershell
npm run suspend-tenant -- --slug=<slug>            # → suspended
npm run suspend-tenant -- --slug=<slug> --activate # → active
npm run suspend-tenant -- --slug=<slug> --disable  # → disabled (terminal)
```

Effect is immediate: next request returns 401. No gateway restart.

---

## Rotate a tenant's bearer

Use when:
- Bearer was leaked (chat transcript, email, ticket).
- Periodic rotation (recommended every 90-180 days).
- Customer requested rotation.

```powershell
# 1. Open RDS to your IP (one-time bootstrap pattern)
$myIp = (Invoke-WebRequest https://checkip.amazonaws.com).Content.Trim()
cd infra\terraform
terraform apply `
  "-var=enable_operator_db_access=true" `
  "-var=operator_ip_cidr=$myIp/32"

# 2. Pull DSN, rotate
cd ..\..
$env:DATABASE_URL = aws ssm get-parameter `
  --name /nami-works/app/database_url --with-decryption `
  --query Parameter.Value --output text
npm run rotate-bearer -- --slug=<slug>

# 3. Close RDS back up
cd infra\terraform
terraform apply
```

Save the new bearer immediately. The old one is invalid the moment Step 2 finishes. The customer must re-do the OAuth consent flow in claude.ai (Connectors → click their connector → reauthorize, paste the new bearer).

---

## Apply Prisma schema changes (e.g. new tables for Affiliates)

When a feature branch lands a new migration in `prisma/migrations/`:

```powershell
# 1. Open RDS to your IP (see Rotate Bearer for the full open/close cycle)

# 2. Pull DSN, apply migrations
cd "c:\Users\Lucas Guimarães\Desktop\nami-works"
$env:DATABASE_URL = aws ssm get-parameter `
  --name /nami-works/app/database_url --with-decryption `
  --query Parameter.Value --output text
npx prisma migrate deploy

# 3. Close RDS back up
```

Prisma is idempotent — already-applied migrations are no-ops. Safe to run after any merge.

---

## Deploy a new container image

```powershell
.\scripts\deploy.ps1
```

Expected: builds the image, pushes to ECR with the current git SHA tag, registers a new task-def revision, rolls the service, waits for stability. ~3-5 min.

If the deploy script fails on:
- **ECR login** — re-run `aws sts get-caller-identity` to confirm AWS auth.
- **Task definition update** — usually a stale `prisma generate` cached layer. Rebuild with `docker buildx build --no-cache .` once.
- **Service stable timeout** — `aws logs tail /ecs/nami-works-gateway --since 10m` for the container's startup error.

---

## Add a new tenant secret (e.g. Lalamove credentials)

If a new tool you're adding needs a per-tenant credential not yet in SSM:

```powershell
# 1. Add to provision-tenant.ts (new SSM placeholder)
# 2. For existing tenants, manually:
aws ssm put-parameter `
  --name "/nami-works/tenants/<slug>/<service>/<key>" `
  --value "<value>" `
  --type SecureString --overwrite
```

Verify the IAM task role has read access to that path. Default policy in `infra/terraform/iam.tf` grants `ssm:GetParametersByPath` on `/nami-works/tenants/*` so anything under that prefix Just Works.

---

## Diagnose a failing tool call

```powershell
# Stream the gateway's CloudWatch logs
aws logs tail /ecs/nami-works-gateway --since 15m --region us-east-1 --follow

# Filter to one tenant
aws logs tail /ecs/nami-works-gateway --since 15m --region us-east-1 `
  --filter-pattern "[nami:gebeauty]"

# Filter to one request ID (from claude.ai's tool-call response)
aws logs tail /ecs/nami-works-gateway --since 1h --region us-east-1 `
  --filter-pattern "<request-id>"
```

Every tool invocation logs one structured line per attempt: `[nami:<slug>] tool=<name> status=ok|err durationMs=<n> requestId=<uuid>`.

---

## Bump the Shopify Admin API version

The gateway auto-detects the latest stable via `shopify_api_version` resolver. The pinned fallback (currently `2026-04`) lives in `src/clients/shopify-api-version.ts` and only kicks in when auto-detection fails. Bump the fallback once a year so a sustained outage during version-rotation doesn't downgrade us to a Shopify-deprecated handle.

---

## Common errors and fixes

| Symptom | Cause | Fix |
|---|---|---|
| 503 "Auth backend unavailable" | DB is unreachable or schema missing | Check RDS status; run `prisma migrate deploy` if a new branch landed schema changes |
| 401 "Unauthorized" on a known-good bearer | Tenant is suspended or wrong slug in URL | `npm run suspend-tenant -- --slug=<slug> --activate` if intentional |
| Connector add in claude.ai shows "couldn't reach the MCP server" | OAuth discovery flow missing or `WWW-Authenticate` header malformed | Check `/.well-known/oauth-authorization-server` returns valid JSON; deploy may not have picked up the latest task-def env vars (run `terraform apply -replace=aws_ecs_task_definition.gateway` then redeploy) |
| Tool returns "Tool invocation failed" | Handler threw — check CloudWatch logs for the stack | Usually a stale Shopify token or a Shopify API field that changed; check `shopify_*` queries against the current schema |
| `npm run dev` 5432 conflict | CPG Labs Postgres on the same machine | Local Postgres is on 5433 (see `docker-compose.yml`) |
