# NAMI Works — Architecture

High-level map of how the system fits together. Read this before touching infra; it answers "where does X live?" in 60 seconds.

---

## Big picture

```
┌──────────────────────────────────────────────┐
│  claude.ai user (gebeauty ops member)        │
│  ↳ enables "NAMI Works for GE Beauty"        │
│    in conversation sidebar                   │
└─────────────────┬────────────────────────────┘
                  │  HTTPS + Bearer JWT
                  ▼
┌──────────────────────────────────────────────┐
│  Shared ALB (omnify-alb, CPG Labs account)   │
│  Listener rule: Host: mcp.nami.works         │
│       → target group nami-works-gw            │
└─────────────────┬────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────┐
│  ECS Fargate task (cpg-labs cluster)         │
│   Container: 477...amazonaws.com/nami-works  │
│   Stack: Node 20 + Fastify + Prisma          │
│   Env from SSM (DATABASE_URL,                │
│                  OAUTH_SIGNING_KEY)          │
│                                              │
│   Routes:                                    │
│     GET  /health                             │
│     GET  /favicon.ico, /icon.svg             │
│     GET  /.well-known/oauth-*                │
│     POST /oauth/{register,authorize,token}   │
│     POST /:tenant            ← MCP transport │
└────┬───────────────┬─────────────────────────┘
     │               │
     │ Prisma        │ HTTPS
     ▼               ▼
┌─────────────┐  ┌────────────────────────────┐
│ RDS         │  │ Per-tenant external APIs:  │
│ db.t4g.micro│  │  - Shopify Admin GraphQL   │
│ Postgres 16 │  │    (creds in SSM:          │
│             │  │     /nami-works/tenants/   │
│ Schema:     │  │     <slug>/shopify/...)    │
│ - Tenant    │  │  - Omie REST (creds in SSM)│
│ - Logs      │  │  - (future: Lalamove,      │
│ - Affiliate │  │     Google Maps, etc.)     │
└─────────────┘  └────────────────────────────┘
```

---

## Tenant isolation model

- One container, many tenants.
- Each request to `POST /<slug>` resolves the tenant via the JWT (or legacy bearer hash) → produces a `TenantContext` with `id`, `slug`, `brand`, `shopifyShop`, `ssmPrefix`.
- The `ssmPrefix` (e.g. `/nami-works/tenants/gebeauty`) is the gate to that tenant's secrets. Each tool that needs Shopify/Omie credentials calls `getSecret(prefix + "/...")` — secrets are never read across tenants.
- Tools register globally at boot, but each request creates a fresh `McpServer` instance bound to one tenant's context. There's no shared mutable state between concurrent tenants.

---

## Auth flows (two layers, both alive)

### Path 1 — OAuth 2.1 (used by claude.ai)

```
claude.ai → POST /<slug>          (no auth)
gateway  → 401 + WWW-Authenticate: resource_metadata=<.well-known/oauth-protected-resource/<slug>>
claude.ai → GET /.well-known/oauth-protected-resource/<slug>
gateway  → { resource: "<issuer>/<slug>", authorization_servers: ["<issuer>"] }
claude.ai → GET /.well-known/oauth-authorization-server
gateway  → { authorization_endpoint, token_endpoint, registration_endpoint, ... }
claude.ai → POST /oauth/register   (RFC 7591 dynamic registration)
gateway  → { client_id: <signed JWT containing the registered metadata> }
claude.ai → opens user browser at /oauth/authorize?client_id=...&resource=<issuer>/<slug>&code_challenge=...
user     → sees consent page, pastes tenant bearer, clicks Authorize
gateway  → verifies bearer hash, mints auth code, redirects back to claude.ai with code+state
claude.ai → POST /oauth/token (code + PKCE verifier)
gateway  → verifies PKCE, mints JWT bound to tenant slug, returns it
claude.ai → POST /<slug> with Authorization: Bearer <JWT>
gateway  → verifies JWT, looks up tenant, processes MCP request
```

JWT signing key lives in SSM at `/nami-works/app/oauth_signing_key`. HMAC-SHA256, 24h token TTL.

### Path 2 — Legacy bearer (used by curl, Claude Desktop, tests)

```
client   → POST /<slug> with Authorization: Bearer <raw-bearer>
gateway  → SHA-256 the bearer, constant-time compare to tenant.bearerTokenHash
gateway  → if match + status=active, processes MCP request
```

Both paths land in the same `authorizeTenantRequest` function in `src/auth/tenant-auth.ts`. JWT is preferred (looks-like-JWT detected from the 3-segment-base64url shape); the legacy hash compare is the fallback.

---

## Storage map

| Where | What | Mutable by |
|---|---|---|
| RDS Postgres `IntegrationTenant` | tenant slug, brand, bearerTokenHash, ssmPrefix, status | provision-tenant.ts, suspend-tenant.ts, rotate-bearer.ts |
| RDS `ToolInvocationLog` | per-call audit (toolName, durationMs, status, requestId) | gateway runtime (best-effort) |
| RDS `AffiliateProfile`, `AffiliateMonthly` | affiliate metadata + monthly stats (post-Item-4) | TBD: cron sync (not built yet) |
| SSM `/nami-works/app/database_url` | RDS connection string | Terraform |
| SSM `/nami-works/app/oauth_signing_key` | HMAC key for OAuth JWTs | Terraform (random_password, ignore_changes) |
| SSM `/nami-works/tenants/<slug>/shopify/access_token` | per-tenant Shopify token | operator (`aws ssm put-parameter --overwrite`) |
| SSM `/nami-works/tenants/<slug>/omie/app_key` and `/app_secret` | per-tenant Omie credentials | operator |
| ECR `nami-works:*` | container images, 10-image lifecycle | scripts/deploy.ps1 |
| Route 53 hosted zone `nami.works` | A `mcp` → ALB, MX records (mirrored from prior GoDaddy DNS) | Terraform |
| ACM cert `*.nami.works` + apex | TLS for ALB | Terraform (DNS validated) |

---

## Code organization

```
src/
├── server.ts              # Fastify boot, mounts everything
├── auth/
│   └── tenant-auth.ts     # JWT or bearer → TenantContext
├── clients/
│   ├── shopify.ts         # per-tenant Admin API client
│   ├── shopify-shop-info.ts # cached shop timezone lookup
│   ├── shopify-api-version.ts # auto-detect latest stable version
│   └── omie.ts            # per-tenant Omie JSON-RPC client
├── db/prisma.ts           # PrismaClient singleton
├── lib/
│   ├── confirm.ts         # confirmation preview helper for write tools
│   ├── icon-routes.ts     # /favicon.ico + /icon.svg routes
│   └── logger.ts          # pino root + per-tenant child loggers
├── mcp/
│   ├── registry.ts        # ToolDefinition catalog + per-request McpServer factory
│   ├── transport.ts       # POST /:tenant adapter (auth → SDK transport)
│   └── types.ts           # ToolContext, ToolResult, ToolDefinition
├── oauth/
│   ├── jwt.ts             # access-token + client_id JWT helpers
│   ├── codes.ts           # in-memory auth code store (10-min TTL)
│   ├── discovery.ts       # /.well-known/* routes
│   ├── register.ts        # POST /oauth/register
│   ├── authorize.ts       # GET/POST /oauth/authorize (consent UI)
│   ├── token.ts           # POST /oauth/token (PKCE + JWT mint)
│   └── index.ts           # mountOAuthRoutes barrel
├── secrets/ssm.ts         # cached SSM SecureString loader
└── tools/
    ├── index.ts           # imports each surface barrel
    ├── shopify/           # ~20 Shopify tools, see tool-catalog.md
    ├── omie/              # 3 Omie tools (consultar-cliente, listar-pedidos, consultar-financeiro)
    └── affiliates/        # 1 read tool (list-profiles); requires Affiliates migration
```

Tools register themselves at import time via `registerToolDefinition`. The `tools/index.js` chain is the load-bearing import — drop it and the catalog is empty.

---

## Deployment

Single command: `.\scripts\deploy.ps1`. Builds linux/amd64 image with buildx, pushes to ECR with current git SHA tag, registers a new task-def revision (preserving env via describe-task-definition), updates the service with `--force-new-deployment`, waits for stability.

Terraform's `aws_ecs_task_definition.gateway` has `ignore_changes = [container_definitions]` so re-applies don't fight the deploy script over the image tag. The trade-off: when secrets/env CHANGE in the TF spec, you have to `terraform apply -replace=aws_ecs_task_definition.gateway` to force a new revision — documented in `infra/terraform/README.md`.

RDS is `publicly_accessible = false` by default. The bootstrap pattern (`enable_operator_db_access = true` + `operator_ip_cidr` toggle in `infra/terraform/bootstrap.tf`) flips it temporarily for migrations + provisioning, then closes back. See `runbook.md`.

---

## What this architecture optimizes for

- **One deploy, many tenants.** Adding tenant #2 is a `provision-tenant` + SSM credential paste. No code, no infra change.
- **Tenant isolation by construction.** Per-request McpServer + ssmPrefix-scoped secret reads — no cross-tenant data path possible.
- **Spec-compliant OAuth.** claude.ai's connector UI works; future MCP clients (Claude Desktop, third-party hosts) will too.
- **Operator-first.** Every recurring operation has a `npm run` script or a Terraform variable. No "remember which AWS console to click" runbook.

## What it does NOT optimize for

- **Per-user authorization.** All members of a customer's claude.ai org share one access token. Per-user access control is a v2 concern.
- **Horizontal scale.** One Fargate task today; the auth-code in-memory store would need Redis if we go to >1 replica. Not urgent at the current customer count.
- **Multi-region.** us-east-1 only. Latency to Brazil is ~120ms; acceptable.
- **Bulk-import jobs.** No cron framework yet. The Affiliates monthly aggregation, the proposed footprint sync, and similar background work all need this — cleanly added once the first such tool needs it.
