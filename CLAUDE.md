# Claude Monorepo — Cross-Cutting Rules

This file governs every app in this repo. Per-app conventions live in each app's own `CLAUDE.md`. When the two disagree, the per-app file wins for code under its directory.

## Working agreement — read first

This repo runs under a **CTO/CEO contract**. Claude is CTO, Lucas is CEO. Tech mechanics (git workflow, secret reuse vs rotation, refactor scope, deploy bundling, test discipline) are silent calls — make them and move on. Anything that changes product, brand, money, end-user experience, or tenant business hours escalates to Lucas.

The canonical contract lives in this project's Claude memory at `feedback_cto_contract.md` (auto-loaded at session start when the project memory folder is reachable). If you're in a worktree or sub-folder that doesn't resolve to the same memory path, read it once at session start from `~/.claude/projects/c--claude/memory/feedback_cto_contract.md`.

End every session that involved real judgment with a "Calls made silently this session" block. See `feedback_end_of_session_calls.md`. That block is the primary feedback loop that keeps the contract calibrated.

## Active initiatives

Multi-session goals (bigger than a PR, smaller than a roadmap) live as one file each at **`.claude/initiatives/<slug>.md`**. Read all of them at session start to see what's in flight, what's blocking, and who should pick up next. When you advance a phase or shift the blocker, update the file before closing the session.

Schema, conventions, and examples are in `.claude/initiatives/README.md`. Treat initiative files as the company's Kanban above the PR layer.

## Session start — read before touching anything

**Every session, before the first edit:** run `git status` and reconcile what you see. Two universal checks that apply to every zone (see "Discipline by zone" below), every tier, every task:

1. **What branch are you on?** If you're standing on someone else's feature branch (or a branch whose name doesn't match the work you're about to do), stop. Cut a fresh branch off `main` before committing anything, or if you're doing loose-ops work, at minimum know that your commit target isn't going to be swept into someone else's PR.
2. **Is the working tree dirty?** If there are `M` (modified tracked) or `??` (untracked) files you didn't create in *this* session, do NOT silently inherit them. They belong to another session's in-flight work. Ask whose work it is, and either wait for them to land, coordinate, or route around cleanly (e.g., `git add <specific paths>` to stage only your files — never `git add .` or `git commit -am`).

**Applies to every zone.** Even in `gebeauty/**` (loose-ops, direct-`main` OK per the discipline table below), inheriting another session's dirty tree sweeps their WIP into your commit. Worse if you `commit -a` on a direct-main path — their unstaged edits get bundled into your commit message. On a feature branch it's a smaller mistake (their work rides your PR); on direct-main it's an unrecoverable bundle.

**The mechanics-vs-policy trap:** if you find yourself asking a rules question mid-work (*"do these files need a branch?", "should I commit to main?"*), check whether the question is really about **git mechanics** (how to move bits around cleanly given the state you're in). Under the CTO contract, git workflow is a silent-tier call — solve mechanics wrinkles yourself, don't escalate them as policy questions. The dirty-tree scenario above is a classic mechanics wrinkle disguised as policy: the policy is clear (loose-ops = direct main OK), the mechanics ("but I'm on someone else's branch") is yours to reconcile at session start.

**Never `git reset --hard`** to "clean up" someone else's dirty tree. That destroys their WIP with no reflog trail. Options in decreasing order of safety: (a) stash their work with a note (`git stash push -u -m "other session's WIP, DATE"`), (b) leave the tree dirty and route around it with `git add <specific paths>`, (c) if you MUST reset, confirm with Lucas first — it's a destructive-git operation the CTO contract explicitly gates.

**Verify HEAD before every first commit.** Immediately before your first `git commit` of the session, run `git branch --show-current` and confirm the target branch is what you expect. This catches the same trap the pre-commit hook catches (inherited feature branch), but as a habit — the hook is the mechanical net; the habit is the primary check. Staged-set verification (`git diff --cached --name-only`) protects against sweeping wrong files; branch verification protects against landing on the wrong branch. They are orthogonal — run both.

## What this repo is

**Primary purpose: the operations control center for GE Beauty**, a Brazilian beauty brand. The bulk of day-to-day session work lives at **`gebeauty/`** at the repo root: catalog, orders, local delivery, B2B channels, content, imagery, financial modeling, vendor and contract management. When in doubt about what this repo is *for*, it's running GE Beauty.

**Secondary: deployable software surfaces.** The same codebase also ships the products below. These are real and in production, but they are secondary initiatives — worked on when a product push calls for it, not the daily driver.

| Surface | Domain | App | Stack |
|---|---|---|---|
| MCP gateway | `mcp.gebeauty.com.br` | `apps/connector` | Fastify 5 + Prisma + @modelcontextprotocol/sdk + AWS ECS |
| Omnify Shopify Admin (CPG Labs full) | `app.cpg-labs.io` | `apps/omnify-admin` | React Router 7 + Polaris web components + Prisma + AWS Lightsail |
| Omnify Shopify Admin (Omnify focused) | `omnify.cpg-labs.io` | `apps/omnify-admin` (same code, different `APP_IDENTITY`) | same |
| Flywheel (Affiliates + Loyalty) | `flywheel.cpg-labs.io` | `apps/omnify-admin` (same code, different config) | same |
| Public marketing site | `cpg-labs.io` | `apps/omnify-site` | Astro 5 (static) + AWS S3 + CloudFront |
| NAMI Works marketing site | `nami.works` | `nami/site` | Astro 5 (static) + AWS S3 + CloudFront + SES/Lambda lead intake |
| Two satellite APIs | TBD | `apps/content-gen-api` + `apps/content-scraper-api` | Python (FastAPI / etc.) |

Production targets, DNS, secrets backends, and deploy domains are unchanged by the repo relocation to `c:\claude` and the `sandbox/gebeauty` → `gebeauty` move. Only the source tree layout changed.

**Why `nami/site` (with its own `infra/` nested inside) and not `apps/` + `infra/<product>`:** a deliberate exception to the app/infra split every other product uses. NAMI Works' own public presence is a NAMI-Works-level asset, not a per-customer product — keeping the app AND its infra together under one `nami/site` folder (rather than split across `apps/` and a top-level `infra/<product>/`) keeps everything about this single asset in one place.

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

- **One `.env` per tenant, scoped to that tenant's folder** — NOT inside `apps/`. The **primary tenant (GE Beauty) lives at the repo root**, so its env is **`gebeauty/.env`**. Secondary tenants stay under `sandbox/<tenant>/.env` (e.g. a future `sandbox/bisyou/.env`). Each tenant's secrets stay scoped to its own folder either way.
- **Today the active tenant on disk is `gebeauty/.env`.** Contains GE Beauty's `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ADMIN_ACCESS_TOKEN`, `SHOPIFY_API_VERSION`, and the various tool credentials (Lalamove, Omie, etc.) the operational scripts at `gebeauty/scripts/` consume.
- **The omnify-admin app has its own dev-store `.env` at `apps/omnify-admin/.env`** — that one targets the TEST store. Not GE Beauty prod.

**How scripts must load it.** Always resolve `.env` from the script's own location, never from the invocation cwd:

```python
# Python (gebeauty/scripts/foo.py — resolve the tenant .env from the script's own location)
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
```

A session that runs `python gebeauty/scripts/foo.py` from the repo root, from `gebeauty/`, or from anywhere else — all three should work without a `cd`. If you find a script that calls bare `load_dotenv()` (cwd-relative), patch it to the `__file__`-relative form. The pre-existing `nami_control.py`, `render_routes_local.py`, `omie_fetch_transportadora.py`, `fix_stragglers.py` follow this convention. (Scripts elsewhere in the tree — e.g. `scripts/omnify/*.py` — reach the tenant env with `Path(__file__).resolve().parents[N] / "gebeauty" / ".env"`, walking up to the repo root.)

**Why the tenant boundary stays a folder, not the repo root itself.** The primary tenant's `.env` sits *inside* `gebeauty/`, not as a bare repo-root `.env`. A root `.env` would imply "this is THE project env" and blur the tenant boundary; keeping it under `gebeauty/` (and secondary tenants under `sandbox/<tenant>/`) keeps each tenant's secrets visibly scoped to its own folder. The `.gitignore` covers `**/.env` so no tenant file leaks.

## Two Prisma schemas — no collision

- `prisma/connector/schema.prisma` → emits to `node_modules/@prisma/client-connector` via custom `output`. Connector code imports from `@prisma/client-connector`.
- `prisma/omnify/schema.prisma` → emits to the default `node_modules/@prisma/client`. Omnify code (and `@cpg-labs/shared-db`) imports from `@prisma/client`.
- Different production Postgres instances. Different `DATABASE_URL` per app. Don't unify.

## Memory

Memories live at `~/.claude/projects/c--claude/memory/`. `MEMORY.md` is the index; individual `.md` files per topic. Update whenever project state changes (new tenant, new brand, new tool surface, new reference pattern, new architectural decision).

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
