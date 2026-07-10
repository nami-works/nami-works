# NAMI Works

Repo for NAMI Works (`lucas@nami.works`). **Primary purpose: the operations control center for GE Beauty**, the first and primary customer — its day-to-day operational tooling and state live at [`gebeauty/`](gebeauty/) at the repo root. **Secondarily**, the same codebase ships the deployable software surfaces below (real, in production, but not the daily driver):

| App | Domain | Stack | Workspace |
|---|---|---|---|
| MCP connector | `mcp.nami.works` | Fastify 5 + Prisma + @modelcontextprotocol/sdk + AWS ECS | `apps/connector` |
| Omnify Shopify Admin (CPG Labs full) | `app.cpg-labs.io` | React Router 7 + Polaris web components + Prisma + AWS Lightsail | `apps/omnify-admin` |
| Omnify focused variant | `omnify.cpg-labs.io` | (same code, `APP_IDENTITY=omnify`) | `apps/omnify-admin` |
| Flywheel (Affiliates + Loyalty) | `flywheel.cpg-labs.io` | (same code, `APP_IDENTITY=flywheel`) | `apps/omnify-admin` |
| Public marketing site | `cpg-labs.io` | Astro 5 (static) + S3 + CloudFront | `apps/omnify-site` |
| Satellite APIs | TBD | Python (FastAPI) | `apps/content-gen-api`, `apps/content-scraper-api` |

## Layout

```
gebeauty/                   PRIMARY: GE Beauty operational state, scripts, content, docs (canonical)
apps/                       Secondary: six deployable apps
extensions/                 Shopify extensions shared across admin variants
packages/                   Shared workspace libraries:
  letterbox/                Handover docs (markdown-only)
  shared-auth/              Bearer auth helpers
  shared-db/                Prisma client wrapper
  shared-encryption/        Crypto helpers
  shared-google-routes/     Google Routes API client
  shared-i18n/              i18n loader
  shared-ui/                Shared UI primitives (admin-side)
  shared-webhooks/          Shopify webhook verification + dispatch
prisma/
  connector/                Connector schema (output: @prisma/client-connector)
  omnify/                   Omnify schema (output: default @prisma/client)
infra/
  connector/                Terraform for mcp.nami.works
  omnify/                   Terraform for the cpg-labs.io family
inputs/                     Mockups, screenshots, briefs, design corpus
scripts/                    Cross-cutting CLI tooling:
  deploy-connector.ps1      Connector deploy
  deploy-omnify-admin.ps1   Omnify admin deploy
  deploy-omnify-site.ps1    Public site deploy
  provision-tenant.ts       Connector tenant onboarding
  rotate-bearer.ts          Tenant bearer rotation
  suspend-tenant.ts         Tenant billing kill switch
  …                         Other connector tooling
  omnify/                   Omnify operational scripts
  debug/                    Omnify forensic scripts
sandbox/
  bisyou/                   Secondary-tenant sandbox (diligence / evaluation)
docs/                       Cross-cutting docs (cpg-labs/ subdir for omnify-side)
.claude/                    Project-shared Claude Code config + hooks + skills + commands
```

## Stack

Node 20+ · TypeScript strict · ES modules (`"type": "module"`, `NodeNext` resolution) · npm workspaces.

Two Prisma schemas, no collision:
- `prisma/connector/` → emits to `node_modules/@prisma/client-connector`. Connector imports from `@prisma/client-connector`.
- `prisma/omnify/` → emits to default `node_modules/@prisma/client`. Omnify code (and `@cpg-labs/shared-db`) imports from `@prisma/client`.

## Scripts (root)

```bash
npm install                  # install all workspaces
npm run dev                  # dev server for the connector (mcp.nami.works)
npm run build                # build every workspace
npm run typecheck            # typecheck every workspace
npm run lint                 # lint every workspace
npm run test                 # test every workspace
npm run prisma:generate      # regen connector Prisma client
npm run provision-tenant     # CLI: provision a new connector tenant
```

Per-app scripts live in each workspace's `package.json`.

## Per-app conventions

- Connector: [apps/connector/CLAUDE.md](apps/connector/CLAUDE.md)
- Omnify Admin: [apps/omnify-admin/CLAUDE.md](apps/omnify-admin/CLAUDE.md) — Polaris web components only, no custom CSS for primitives
- Public site: [apps/omnify-site/CLAUDE.md](apps/omnify-site/CLAUDE.md) — no admin imports, no banned deps

Cross-cutting rules (parallel sessions, deploy queue, branch-per-task, shell compatibility) live in [CLAUDE.md](CLAUDE.md) at the root.

## Status

Monorepo merge from `nami-works` + `cpg-labs` landed 2026-05-21. See `~/.claude/work-orders/2026-05-20-nami-works-monorepo-merger.md` for the full Phase A → D record.

Repo relocated to `c:\claude` and GE Beauty operational tooling promoted from `sandbox/gebeauty` to `gebeauty/` at the repo root (2026-07-10), reflecting that day-to-day GE Beauty operations are the primary use of this repo and the deployable apps are secondary initiatives.
