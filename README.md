# NAMI Works — Gateway

Multi-tenant MCP gateway exposing curated Shopify + Omie tools to managed-service customers through Claude for Teams.

## Stack
- Node 20+ · TypeScript · Fastify
- Prisma + PostgreSQL
- `@modelcontextprotocol/sdk` (streamable HTTP transport)
- AWS ECS Fargate · SSM Parameter Store
- Domain: `mcp.nami.works`

## Scripts

```bash
npm run dev          # Local dev server (tsx watch)
npm run build        # Compile to dist/
npm run start        # Run compiled server
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm run test         # Vitest
```

## Status

v0.1.0 — Phase 1 bootstrap. See `~/.claude/plans/build-a-plan-to-mutable-honey.md` for the full roadmap.
