# Session Handoff — Team Toolset Enablement (GE Beauty)

Written for the next Claude Code (Desktop) session picking up GE Beauty team
enablement. Self-contained; read top to bottom. Delete after absorbing (it's
ephemeral — this file is untracked, so git will NOT preserve it).

## TL;DR — where we are

The goal of this session: make GE Beauty's Claude toolset usable by the
**non-technical team** (Eleonora=marketing, Alicia=creative, Raphael=ops,
Financeiro), and rationalize *how* each capability is delivered. We converged on
a clean model and shipped most of it.

**The capability-placement model (the spine of everything):**
```
Org-managed skills →  team-facing, portable workflows. Reach Code + Cowork, zero setup.
                      Currently: setup + creative-producer  (that's the whole org set)
Connector (MCP)    →  GE DATA + ACTIONS only (Shopify/Omie/Instagram/Loox/brand-voice/feedback).
                      Needs server creds; a skill can't do these. Composes with skills.
Repo (.claude/skills) → dev/eng skills + repo-integrated workflows that need local
                      resources (.py, .env, gebeauty/growth, xlsx). Authoring source of truth.
```
Why: skills are the efficient native form (progressive disclosure, reach Code +
Cowork). Cowork sources skills from the **account/Customize config, NOT the repo**
— so repo-only skills don't reach Cowork. The connector is only for things a skill
*can't* do (live GE data/actions).

## Live production state (connector)

- **Connector image LIVE:** `nami-works:connector-20260721-noskilltool` on
  `mcp.gebeauty.com.br`, `/health` 200. Runs as `cpg-labs-connector` on the
  Lightsail box `54.221.23.142`, compose at `/srv/cpg-labs/docker-compose.yml`
  (service `connector`, port 3003). NOTE: the connector repo is
  **`nami-works/nami-works`** (NOT migrated — see decisions).
- **Org skills (claude.ai admin → Skills → Organização):** exactly **`setup`** +
  **`creative-producer`**. The stale 22/06 batch was removed by Lucas.
- **`brand_creative_producer` connector tool = DISABLED** (in `DISABLED_TOOLS`,
  `apps/connector/src/mcp/tool-catalog.ts`) — superseded by the org skill. The
  `bundle-skills.mjs` → `served-skills.ts` infra is kept **dormant** (reversible).

## What shipped this session (PRs, all merged to main; connector rolled)

- **Feedback attribution + proactive-struggle nudge** — `nami_feedback` records
  `principalId`/`principalLabel`; gateway instructions tell the client to offer
  feedback when a session is a struggle. PRs #58, #59 → `connector-20260708-feedback`.
- **creative-producer via the connector** — first as a tool (#61
  `connector-20260714-creative`), then **full-fidelity** via a build-time bundle
  (`scripts/bundle-skills.mjs` → committed `src/generated/served-skills.ts`, since
  `.claude`/`docs` are outside the Docker build context) (#64
  `connector-20260721-serveskills`), then **adaptive guided intake** baked into the
  skill (#68 `connector-20260721-intake`), then **retired the tool** once it became
  an org skill (#71 `connector-20260721-noskilltool`, CURRENT).
- **`/setup` skill** (the ONE org bootstrap skill) — connector-first, idempotent,
  audits + guides connecting GE connector (+ "Always allow" pass) + Canva + Magnific;
  optional "import history from another AI" note; power-user branch removed. Lives at
  `.claude/skills/setup/SKILL.md`. PRs #65, #66, #67.
- **`/creative-producer`** — packaged self-contained (SKILL.md + bundled playbook,
  ≤1024-char description) and uploaded to the org by Lucas. Adaptive intake +
  Rose-Ritual learnings + CGO rules all in it.
- **`docs/onboarding-invitation.md`** — Windows + Mac (PT-BR) invitation emails +
  admin prereqs + caveats. Folder convention for the team: **`C:\claude`** (Windows) /
  `~/claude` (Mac) — an EMPTY working folder (connector-first, no clone).
- **Deploy-queue backfilled** (#69) for feedback/creative/serveskills/intake.

## Key decisions

- **GitHub org NOT migrated.** Discovered `nami-works` is a *personal* account, not
  an org. Lucas created a `gebeauty` GitHub org + `gebeauty/claude` repo, but chose
  NOT to migrate the monorepo (keeps personal history out of the team's sight). The
  connector code stays in `nami-works/nami-works`. `gebeauty/claude` holds only a
  seed (README + an early creative-producer skill copy) — not the live source.
- **Connector-first for the team.** Team connects 3 things (GE connector + Canva +
  Magnific); no repo clone. Only power users clone the repo.
- **Org skills = only the portable ones.** creative-producer was portable enough
  (adapted). The rest (content-director, crm-director, video-director,
  storefront-agent, b2b-proposta, growth-*, digest) are repo-integrated (need local
  .py/.env/data) → they stay repo/power-user; org-uploading them would put broken
  capabilities on Cowork.

## Pending / next steps (OWNER · BLOCKING-ON)

1. **Canva (and maybe Magnific) shared-account instability.** The Canva connector
   disconnected/toggled repeatedly. Likely cause: **one shared Canva login used by
   multiple people** → OAuth refresh-token rotation / re-auth revocation invalidates
   each other. **Fix:** move to **per-user seats on the GE Beauty Canva TEAM** (each
   teammate their own login, same shared brand assets) — and update `/setup`'s Canva
   step from "shared login" to "your own account on the team." Magnific same *if* it
   offers team seats. — Owner: **Lucas** (confirm Canva/Magnific team-seat plans) +
   **next session** (update + re-package `/setup`). Blocking-on: Lucas confirming seats.
2. **Alicia is mid-onboarding, blocked on Git.** Provisioned on the connector
   (Marketing role, operator, active, awaiting first login) and already in the Claude
   org. She hit "requesting a Git" when opening a local Code session — almost certainly
   needs **Git for Windows installed** (https://git-scm.com/download/win). — Owner:
   **Lucas/Alicia**. Blocking-on: Git install, then `/setup`.
3. **Deploy-queue owes the `noskilltool` roll entry** (#71). — Owner: next session
   (fold into the next connector PR).
4. **`tecnologia@gebeauty.com.br` gh re-auth** — dropped from the keyring during an
   account switch; needed for gebeauty-org GitHub admin work. — Owner: Lucas.
5. **Optional: a `publish-skill` script** (repo skill → org-upload zip in one command)
   so keeping org skills in sync with the repo is `git`-then-one-command instead of
   hand-packaging. Offered, not built. — Owner: next session if wanted.

## How to continue (mechanics — important)

- **Build the connector from an isolated worktree:**
  `C:/Users/Lucas Guimarães/dev/worktrees/nami-works-serve-skills` (on `main`, has
  `node_modules` + all 3 Prisma clients generated). `c:\claude` is the shared primary
  checkout — other sessions mutate it; DON'T build there.
- **Deploy the connector:** `docker buildx build --platform linux/amd64 -f
  apps/connector/Dockerfile -t 477780048372.dkr.ecr.us-east-1.amazonaws.com/nami-works:connector-<YYYYMMDD>-<slug> --push .`
  then on the box: re-auth ECR (`aws ecr get-login-password | ssh … "sudo docker login
  … --password-stdin …"` — the box token expires), `sed` the tag in
  `/srv/cpg-labs/docker-compose.yml`, `docker compose pull connector && up -d
  --force-recreate connector`, smoke `https://mcp.gebeauty.com.br/health`.
- **gh accounts:** connector repo pushes need the **`nami-works`** gh account;
  gebeauty-org work needs **`tecnologia-gebeauty`** (re-auth pending). Switch with
  `gh auth switch`.
- **Pre-commit hook gotcha:** `.claude/hooks/pre-commit-gates.sh` blocks commits when
  the *ambient* checkout's branch is `main` and runs a WHOLE-project typecheck. Always
  work on a feature branch; if a fresh worktree fails typecheck, generate ALL Prisma
  clients (`npx prisma generate --schema prisma/{omnify,fulfillment}/schema.prisma`),
  not just the connector's.
- **Org-skill packaging rules (learned the hard way):** zip must have `SKILL.md` at
  ROOT, `description` ≤ **1024 chars**, and **forward-slash** entries — build the zip
  with **Python `zipfile`**, NOT PowerShell `Compress-Archive` (it writes backslashes →
  "invalid path" error). Bundle referenced docs into `references/` and repoint the
  link. Re-uploading an existing skill errors ("Not found") — **delete the old entry
  first, then Add**.
- **Connector auth model:** invited emails = a `TenantPrincipal` row (contactEmail +
  role) with `googleSub` binding on first Google login; access via `AccessRole` +
  `PrincipalRoleAssignment` (grants JSON per system). Roles: `admin` (owner),
  `financeiro`, `marketing`, `operacoes`. DB = `connector` on `cpg-labs-postgres` @
  `54.221.23.142`. gebeauty tenant id: `ten_735dd3f181d68ed2d0a3`.

## Key files

- `apps/connector/` — the MCP gateway (nami-works/nami-works repo).
- `apps/connector/src/mcp/tool-catalog.ts` — TOOL_CATALOG + DISABLED_TOOLS.
- `apps/connector/scripts/bundle-skills.mjs` + `src/generated/served-skills.ts` — dormant serve-skills infra.
- `.claude/skills/setup/SKILL.md`, `.claude/skills/creative-producer/SKILL.md`.
- `docs/onboarding-invitation.md`, `docs/creative-ad-image-pipeline.md`.
- `.claude/deploy-queue.md` — deploy log.
- Org-skill zips staged at the session scratchpad `.../scratchpad/{setup,creative-producer}.zip`.
