# NAMI Works Monorepo — Cross-Cutting Rules

This file governs every app in this repo. Per-app conventions live in each app's own `CLAUDE.md`. When the two disagree, the per-app file wins for code under its directory.

## Working agreement — read first

This repo runs under a **CTO/CEO contract**. Claude is CTO, Lucas is CEO. Tech mechanics (git workflow, secret reuse vs rotation, refactor scope, deploy bundling, test discipline) are silent calls — make them and move on. Anything that changes product, brand, money, end-user experience, or tenant business hours escalates to Lucas.

The canonical contract lives in this project's Claude memory at `feedback_cto_contract.md` (auto-loaded at session start when the project memory folder is reachable). If you're in a worktree or sub-folder that doesn't resolve to the same memory path, read it once at session start from `~/.claude/projects/c--Users-Lucas-Guimar-es-Desktop-nami-works/memory/feedback_cto_contract.md`.

End every session that involved real judgment with a "Calls made silently this session" block. See `feedback_end_of_session_calls.md`. That block is the primary feedback loop that keeps the contract calibrated.

## Active initiatives

Multi-session goals (bigger than a PR, smaller than a roadmap) live as one file each at **`.claude/initiatives/<slug>.md`**. Read all of them at session start to see what's in flight, what's blocking, and who should pick up next. When you advance a phase or shift the blocker, update the file before closing the session.

Schema, conventions, and examples are in `.claude/initiatives/README.md`. Treat initiative files as the company's Kanban above the PR layer.

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

Multiple Claude Code sessions can run against this repo at the same time. The conflict model depends on **which files the session is touching**, not on a flat session count.

### Cross-app sessions — unlimited, no worktree required

Sessions touching only one app's files (`apps/connector/`, `apps/omnify-admin/`, `apps/omnify-site/`, `apps/fulfillment/`, `apps/content-gen-api/`, `apps/content-scraper-api/`) don't collide with each other. Each app's tree is disjoint — different paths, different builds, different deploys. Just open the main checkout (`Desktop\nami-works\`) in both sessions and go.

### Same-app sessions — 2 max, separate worktrees

Two sessions editing the same app *will* collide: file overwrites, lint cache thrash, branch-switch eating staged files (this happened during the rota-local + LD-watchdog cross-stream on 2026-05-21). Use `git worktree` to give each session its own physical checkout.

**Worktree location convention: `~/dev/worktrees/nami-works-<branch-slug>/`.**

```bash
mkdir -p "C:/Users/Lucas Guimarães/dev/worktrees"      # one-time
git worktree add "C:/Users/Lucas Guimarães/dev/worktrees/nami-works-ld-ui" feat/ld-ui
```

Open the new folder in Cursor / Claude Code as a fresh project. Desktop stays clean (only the main checkout sits there). Inspect with `git worktree list`; remove with `git worktree remove "C:/Users/Lucas Guimarães/dev/worktrees/nami-works-ld-ui"` when the branch lands.

A session that suspects another active session is on the same app should check: `git worktree list` shows active worktrees, `git branch --no-merged main` shows in-flight branches. If you see another session's branch on the same app, cut a worktree before editing.

### Shared root state — serialize, or coordinate via work order

A small set of files affects every workspace; concurrent edits cause merge churn or break other sessions' builds. Treat any change to these as a critical section across all live sessions:

- root `package.json` (workspaces list, deps, overrides)
- `package-lock.json`
- root `.gitignore`, root `.npmrc`, root `tsconfig.base.json`, root `eslint.config.js`
- root `CLAUDE.md` (and the per-app CLAUDE.md any other session is reading mid-task)
- `.claude/settings.json`, `.claude/deploy-queue.md`
- `packages/*` content (consumed by multiple apps)
- any `prisma/*/schema.prisma` (whose generated client multiple workspaces import)

If you need to touch any of the above and other sessions are active, either: (a) wait until they pause / land their PR, or (b) post a work order announcing the file list and proposed timing so the other sessions hold their related edits until your change merges.

### Hoisted-state operations — serialize

These mutate hoisted `node_modules` that every workspace shares; two sessions running them concurrently can race and produce a half-written client:

- `npm install` / `npm ci`
- `prisma generate` (any schema)

Quick ops; just don't overlap them across sessions.

### Mockup sessions — unlimited

Mockups touch only `inputs/mockups/`. Cut a `mockup/<feature>` branch, commit early, no worktree needed. Uncommitted files on `main` trip deploy guards for any other session that tries to deploy.

### Read-only / planning / research sessions — unlimited

No file writes, no risk.

### Deploy gating — independent of session count

`.claude/deploy-queue.md` serializes deploys per-app: one Pending entry per app at a time, regardless of which session created it. Read the queue and check for other sessions' entries before proposing a deploy. See deploy-queue.md for the full schema.

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

## Excel / spreadsheets

When building or editing any `.xlsx` for Lucas, read **`docs/excel-conventions.md`** first. It captures his house style (derived from the GE Beauty BP), the canonical DRE line order, sensitivity-grid patterns, file/Drive naming, and the hard rule that formulas are authored in **English tokens** (`SUMIF`, comma args) because Excel renders them in pt-BR (`SOMASE`, `;`) automatically — writing literal Portuguese into the file breaks it. Append to that doc's running log whenever Lucas corrects a spreadsheet.

## Risky actions

Confirm before taking risky actions — destructive git, external API writes, production deploys, anything visible to customers. Match the scope of action to what was asked. A previous "yes" doesn't authorize a similar action later unless explicitly scoped that way.

## Secrets

### Production runtime secrets

- **Connector**: AWS SSM Parameter Store under `/nami-works/tenants/<slug>/*`.
- **Omnify family** (admin + focused + Flywheel): Lightsail instance env files at `/etc/cpg-labs/{full,omnify,cron}.env` (root-owned, 600). AWS SSM `/omnify/` prefix is preserved but no longer the runtime source.
- **Public site**: no runtime secrets — static deploy.
- Two backends, two scopes. Don't unify, don't cross-import.

### Per-tenant local secrets (for ad-hoc operational scripts)

Manual scripts that talk to a tenant's Shopify store directly need that tenant's credentials available on disk. Convention:

- **One `.env` per tenant, under `sandbox/<tenant>/.env`** — NOT at the repo root, NOT inside `apps/`. Each tenant's secrets stay scoped to that tenant's folder.
- **Today there is one tenant on disk: `sandbox/gebeauty/.env`.** Contains GE Beauty's `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ADMIN_ACCESS_TOKEN`, `SHOPIFY_API_VERSION`, and the various tool credentials (Lalamove, Omie, etc.) the operational scripts at `sandbox/gebeauty/scripts/` consume.
- **The omnify-admin app has its own dev-store `.env` at `apps/omnify-admin/.env`** — that one targets the TEST store. Not GE Beauty prod.

**How scripts must load it.** Always resolve `.env` from the script's own location, never from the invocation cwd:

```python
# Python (sandbox/<tenant>/scripts/foo.py)
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
```

A session that runs `python sandbox/gebeauty/scripts/foo.py` from the repo root, from `sandbox/gebeauty/`, or from anywhere else — all three should work without a `cd`. If you find a script that calls bare `load_dotenv()` (cwd-relative), patch it to the `__file__`-relative form. The pre-existing `nami_control.py`, `render_routes_local.py`, `omie_fetch_transportadora.py`, `fix_stragglers.py` follow this convention.

**Why we don't put `.env` at the repo root.** The connector is multi-tenant by design (`/nami-works/tenants/<slug>/*` SSM paths reflect this). A root `.env` would imply "this is THE project env"; the next tenant's secrets would then need to either co-mingle there or move to per-tenant folders anyway. Keep the tenant boundary visible in the filesystem from day one. The `.gitignore` covers `**/.env` so per-tenant files don't leak.

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
