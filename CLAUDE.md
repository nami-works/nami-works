# NAMI Works — Claude Code Project Rules

**What this repo is:** Multi-tenant MCP gateway owned by **NAMI Works** (parent company, `lucas@nami.works`). Exposes curated Shopify + Omie business actions to non-technical ops teams at customer brands, via Claude Desktop / claude.ai and org-level custom connectors.

Full approved plan: `~/.claude/plans/build-a-plan-to-mutable-honey.md`.

## Brand + tenant model

- **NAMI Works** = parent company. Owns this repo, the infra, the `mcp.nami.works` domain, and all commercial contracts.
- **Customer-facing brands** = per-tenant configuration. Currently:
  - `cpg-labs` — CPG vertical (first customer: **gebeauty**, a Brazilian beauty brand). The "CPG Labs" brand also owns a separate Shopify app at `Desktop\cpg-labs\` (deployed to `omnify.cpg-labs.io` / `cpg-labs.io`) — the Shopify app is independent from this repo and should never be imported.
  - Others TBD as verticals open up.
- **Principle:** ONE codebase, ONE deploy, MANY brand skins. Internal identity (repo name, SSM paths, CloudWatch group, domain) is NAMI Works forever. Customer-facing strings (docs, system prompts, tool messages, MSAs) read `tenant.brand` and render the right brand.

## Stack

Node 20+ · TypeScript (strict) · Fastify 5 · Prisma · `@modelcontextprotocol/sdk` · Pino · Zod · AWS ECS Fargate + SSM + RDS Postgres.

ES modules (`"type": "module"`), `NodeNext` module resolution.

## Code conventions

- Zod for all tool input schemas.
- Structured logs via Pino. Prefix `[nami:<tenant>]` for tenant-scoped calls. Include `requestId`, `toolName`, `durationMs`, `status` on tool invocations.
- Never log tokens, PII, or full customer data.
- Never hardcode tenant-specific values. All per-tenant config comes from the `IntegrationTenant` DB row + SSM Parameter Store under `/nami-works/tenants/<slug>/*`.
- Write-tools use two-step confirmation (see `src/lib/confirm.ts` once built in Phase 4). First call returns `{ preview, requiresConfirmation: true }`; second call with `confirm: true` executes. Applies to ALL write ops regardless of blast radius.
- Strict TypeScript flags enforced in `tsconfig.json` — don't relax them.

## Tenant isolation

- Every request carries a tenant slug as URL path param (`POST /:tenant`).
- `src/auth/tenant-auth.ts` (Phase 2) resolves bearer → tenant row via constant-time compare.
- `status !== 'active'` → 401. This is the billing kill switch, not just a toggle.
- Every tool call receives `ctx.tenant`. Tools MUST NOT access state outside their tenant's scope.

## Git + deploy

- `main` is the deployed branch.
- Every commit must have lint + typecheck + tests green before landing.
- Deploy via `scripts/deploy.ps1` (Phase 6). Task-def container image is owned by the deploy script, not Terraform.
- Never skip hooks (`--no-verify`) unless explicitly told.

## Cross-repo reference (read-only)

Some patterns should be ported verbatim from the sibling `cpg-labs\` Shopify app repo. These are documentation, NOT dependencies — never import, never copy code without reimplementing in TS:

- `..\cpg-labs\app\services\claude-control-auth.server.ts` — bearer auth shape.
- `..\cpg-labs\app\routes\api.control.$intent.tsx` — Shopify Admin GraphQL usage.
- `..\cpg-labs\infra\terraform\claude-control.tf` — SSM SecureString pattern.
- `..\cpg-labs\gebeauty-workspace\scripts\*.py` — v0 implementations of the tools this gateway will expose. See `reference_gebeauty_scripts.md` memory.

## Memory

Memories live at `~/.claude/projects/c--Users-Lucas-Guimar-es-Desktop-nami-works/memory/`. MEMORY.md is the index; individual `.md` files per topic. Update whenever project state changes (new tenant, new brand, new tool surface, new reference pattern).

## Scope discipline

- Don't add features, refactors, or abstractions beyond what the current phase calls for.
- Don't add error handling / validation / feature flags for scenarios that can't happen.
- Don't write no-op comments. Comment only when the WHY is non-obvious (hidden constraint, subtle invariant).
- Confirm before taking risky actions — destructive git, external API writes, production deploys, anything visible to customers.
