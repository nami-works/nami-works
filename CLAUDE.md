# NAMI Works Monorepo — Cross-Cutting Rules

This file governs every app in this repo. Per-app conventions live in each app's own `CLAUDE.md`. When the two disagree, the per-app file wins for code under its directory.

## What this repo is

`github.com/nami-works/nami-works` ships **six production surfaces** from one codebase:

| Surface | Domain | App | Stack |
|---|---|---|---|
| MCP gateway | `mcp.nami.works` | `apps/connector` | Fastify 5 + Prisma + @modelcontextprotocol/sdk + AWS ECS |
| Omnify Shopify Admin (CPG Labs full) | `app.cpg-labs.io` | `apps/omnify-admin` | React Router 7 + Polaris web components + Prisma + AWS Lightsail |
| Omnify Shopify Admin (Omnify focused) | `omnify.cpg-labs.io` | `apps/omnify-admin` (same code, different `APP_IDENTITY`) | same |
| Flywheel (Affiliates + Loyalty) | `flywheel.cpg-labs.io` | `apps/omnify-admin` (same code, different config) | same |
| Public marketing site | `cpg-labs.io` | `apps/omnify-site` | Astro 5 (static) + AWS S3 + CloudFront |
| Two satellite APIs | TBD | `apps/content-gen-api` + `apps/content-scraper-api` | Python (FastAPI / etc.) |

Production targets, DNS, secrets backends, and deploy domains do not change with this merge. Only the source tree colocates.

## Brand + tenant model

- **NAMI Works** = parent company, `lucas@nami.works`. Owns the GitHub org, the infra, the `nami.works` domain, and all commercial contracts.
- **CPG Labs** = customer-facing brand for the CPG vertical. First customer: **GE Beauty** (Brazilian beauty brand). Owns the `cpg-labs.io` domain family and the Shopify apps deployed under it.
- **Principle:** ONE codebase, MANY brand skins. Internal identity (repo name, SSM paths, CloudWatch group, domain) is NAMI Works forever. Customer-facing strings (docs, system prompts, tool messages, MSAs) render the right brand per tenant.

## Parallel-session protocol

Multiple Claude Code sessions run against this repo at the same time. The shared working tree and the per-app deploy guards cap how many can deploy in parallel. The cap depends on what the session is doing AND which app it's touching.

- **Coding sessions: 2 max per app, in separate `git worktree`s.** Two sessions sharing the same checkout and the same app will collide on lint cache, generated files, and partially-applied edits. Use `git worktree add ../nami-works-<slug> <branch>` so each session has its own working tree. **2 sessions on different apps don't conflict** the same way — `apps/connector` work and `apps/omnify-admin` work touch disjoint files.
- **Mockup sessions: unlimited.** Mockups touch zero prod code and don't trigger any deploy. Each cuts a `mockup/<feature>` branch. Commit early — uncommitted files on `main` trip the deploy guards.
- **Read-only / planning / research sessions: unlimited.** No file writes, no risk.
- **Cross-session shared files** (`.claude/settings.json`, `.claude/deploy-queue.md`, `MEMORY.md`, root `CLAUDE.md`, per-app `CLAUDE.md`): edits land on `main` and every session inherits on next pull. Watch for two sessions editing the same shared file simultaneously.

## Branch-per-task

- Every non-trivial change happens on a feature branch, not directly on `main`. Naming: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>`.
- Cut from latest `main`: `git checkout main && git pull && git checkout -b feat/<slug>`.
- **Skip the branch** only for: typo edits, single-line config tweaks, memory/`MEMORY.md` updates, or explicit user-approved hotfixes.
- **Stale `main` at session start:** if the working tree is dirty when you start, do not silently inherit it into your branch. Ask whose work it is.
- **Merge to `main` via squash-merge** when the branch is complete and gates pass. One commit per branch on `main`. Delete the branch after merge.

## Deploy queue protocol

Multiple sessions running deploys against the same app would stomp each other. Use `.claude/deploy-queue.md` as the shared pending/deployed log.

- **After landing a change** that needs a deploy, append a Pending entry with: date, **app** (connector / omnify-admin / omnify-site / etc.), short title, files touched, type (code / migration / env / Terraform), summary, affects, dependencies, risk.
- **Before proposing a deploy**, read the full Pending section. Summarize everything pending for the target app to the user. Call out dependencies and conflicts.
- **Ask the user** whether to deploy now or hold. Never auto-deploy when other Pending entries from a different session exist for the same app.
- **After a successful deploy**, move the items from Pending → Deployed with the deploy timestamp and (if available) the task-def revision or image tag. Keep the last ~20 Deployed entries, prune older.
- **Single-session fast path:** if Pending contains only your own entry for the target app, confirm once with the user and ship.

## Production and `main` must stay in sync

Anything deployed must also be committed to `main`. If a session deploys via `scripts/deploy-*.ps1`, `shopify app deploy`, or any infra push, the corresponding code changes must be committed in the same session — no "I'll commit it later."

## Shell compatibility — Windows PowerShell 5.1

Lucas's terminal and Claude's `PowerShell` tool both run in Windows PowerShell 5.1, which does not support `&&` / `||` pipeline-chain operators. When writing multi-step terminal commands:
- Use `;` for unconditional sequencing
- Use `command1; if ($?) { command2 }` for fail-fast chaining
- One command per line is always safe

The `Bash` tool (POSIX) still accepts `&&` — only PowerShell breaks. Watch for this when copying example commands from documentation.

## Risky actions

Confirm before taking risky actions — destructive git, external API writes, production deploys, anything visible to customers. Match the scope of action to what was asked. A previous "yes" doesn't authorize a similar action later unless explicitly scoped that way.

## Secrets

- **Connector**: AWS SSM Parameter Store under `/nami-works/tenants/<slug>/*`.
- **Omnify family** (admin + focused + Flywheel): Lightsail instance env files at `/etc/cpg-labs/{full,omnify,cron}.env` (root-owned, 600). AWS SSM `/omnify/` prefix is preserved but no longer the runtime source.
- **Public site**: no runtime secrets — static deploy.
- Two backends, two scopes. Don't unify, don't cross-import.

## Two Prisma schemas — no collision

- `prisma/connector/schema.prisma` → emits to `node_modules/@prisma/client-connector` via custom `output`. Connector code imports from `@prisma/client-connector`.
- `prisma/omnify/schema.prisma` → emits to the default `node_modules/@prisma/client`. Omnify code (and `@cpg-labs/shared-db`) imports from `@prisma/client`.
- Different production Postgres instances. Different `DATABASE_URL` per app. Don't unify.

## Memory

Memories live at `~/.claude/projects/c--Users-Lucas-Guimar-es-Desktop-nami-works/memory/`. `MEMORY.md` is the index; individual `.md` files per topic. Update whenever project state changes (new tenant, new brand, new tool surface, new reference pattern, new architectural decision).

## Hooks

`.claude/settings.json` activates two hooks:
- `PreToolUse` for Bash → `.claude/hooks/pre-commit-gates.sh` (lints changed lines + typechecks the whole project before any `git commit`)
- `SessionStart` → `.claude/hooks/session-start-status.sh`

Never skip hooks (`--no-verify`) unless explicitly told. If the hook fails, fix the underlying issue.

## Scope discipline

- Don't add features, refactors, or abstractions beyond what the current task calls for.
- Don't add error handling / validation / feature flags for scenarios that can't happen.
- Don't write no-op comments. Comment only when the WHY is non-obvious (hidden constraint, subtle invariant, surprising behavior).
- Default to NO new files unless the task requires it. Edit existing ones first.
