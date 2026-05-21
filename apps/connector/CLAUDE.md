# NAMI Works Connector — Per-App Rules

The **MCP gateway** at `mcp.nami.works`. Exposes curated Shopify + Omie business actions to non-technical ops teams at customer brands, via Claude Desktop / claude.ai and org-level custom connectors.

For cross-cutting monorepo rules (parallel sessions, deploy queue, brand model), see the root `/CLAUDE.md`.

## Stack

Node 20+ · TypeScript strict · Fastify 5 · Prisma (custom output `@prisma/client-connector`) · `@modelcontextprotocol/sdk` · Pino · Zod · AWS ECS Fargate + SSM + RDS Postgres.

ES modules (`"type": "module"`), `NodeNext` module resolution. Schema at `prisma/connector/schema.prisma`, client emitted to `node_modules/@prisma/client-connector` (NOT the default `@prisma/client` — that one is the omnify client).

## Code conventions

- Zod for all tool input schemas.
- Structured logs via Pino. Prefix `[nami:<tenant>]` for tenant-scoped calls. Include `requestId`, `toolName`, `durationMs`, `status` on tool invocations.
- Never log tokens, PII, or full customer data.
- Never hardcode tenant-specific values. All per-tenant config comes from the `IntegrationTenant` DB row + SSM Parameter Store under `/nami-works/tenants/<slug>/*`.
- Write-tools use two-step confirmation (`src/lib/confirm.ts`). First call returns `{ preview, requiresConfirmation: true }`; second call with `confirm: true` executes. Applies to ALL write ops regardless of blast radius.
- Strict TypeScript flags enforced in `tsconfig.json` — don't relax them.
- Prisma imports: `import { PrismaClient } from "@prisma/client-connector"` — NEVER `from "@prisma/client"` (that resolves to the omnify schema's client).

## Tenant isolation

- Every request carries a tenant slug as URL path param (`POST /:tenant`).
- `src/auth/tenant-auth.ts` resolves bearer → tenant row via constant-time compare.
- `status !== 'active'` → 401. This is the billing kill switch, not just a toggle.
- Every tool call receives `ctx.tenant`. Tools MUST NOT access state outside their tenant's scope.

## Git + deploy

- Deploy via `scripts/deploy-connector.ps1` from the repo root.
- Build context = repo root; Dockerfile = `apps/connector/Dockerfile`; build uses workspace `npm ci` and `prisma generate -w @nami/connector`.
- Smoke: `curl https://mcp.nami.works/health` → `{"ok":true}`.

## Scope discipline

- Don't add features, refactors, or abstractions beyond what the current phase calls for.
- Don't add error handling / validation / feature flags for scenarios that can't happen.
- Don't write no-op comments. Comment only when the WHY is non-obvious.
- Confirm before taking risky actions — destructive git, external API writes, production deploys.
