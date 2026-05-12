# CPG Labs — Project Rules

This is the single source of truth for all AI-assisted development in the Omnify codebase.

## Project Identity

CPG Labs ships **two surfaces** from this repo. They share content, not runtime — different framework, different bundle, different hosting. Each one has its own scope of conventions; never let admin code import from site/ or vice versa.

| Surface | Where | What | Stack |
|---------|-------|------|-------|
| **Embedded Shopify app** | `https://app.cpg-labs.io` (CPG Labs full) + `https://omnify.cpg-labs.io` (Omnify focused) | Local delivery, retail sales, footprint expansion, etc. | React Router v7 + Shopify App Bridge + Polaris + Prisma + AWS ECS Fargate |
| **Public site** | `https://cpg-labs.io` | Marketing, pricing, legal (privacy/terms/security), product walkthroughs, future docs/blog/status | Astro (static) + AWS S3 + CloudFront — see `site/` and the "Public Site" section below |

The admin app's code lives at the **repo root** (`app/`, `prisma/`, `infra/terraform/`, etc.). The public site's code lives in **`site/`** — completely self-contained, own `package.json`, own build, own deploy.

### Tech Stack — admin app
- **Framework:** React Router v7 + Shopify App React Router
- **UI:** Polaris web components (`s-page`, `s-section`, `s-stack`, `s-box`)
- **Data:** Prisma (SQLite locally, PostgreSQL in production via AWS RDS)
- **Maps:** Google Maps JavaScript API, Google Routes API
- **Language:** TypeScript (strict) | **Bundler:** Vite

### Core Features & Routes
- **Local Delivery** — `/app/local-delivery` — Route planning, map, order tags
- **Retail sales** — `/app/retail-sales` — Monthly sales targets by location, KPI dashboard, campaign goals
- **Footprint expansion** — `/app/footprint-expansion` — Location ranking with Maps + analytics (renamed from Retail Footprint; old URL 302s)
- **Sales** — `/app/merchandising/sales` — Bulk price campaigns with optional price tag labeling (merged from Campaigns + Price Tags)
- **Story-telling** — `/app/storytelling` — AI blog content generation
- **Settings** — `/app/settings` — Per-location Delivery details + Retail sales filters; Delivery providers + Carriers tabs

### Key Commands
```bash
npm run dev           # Shopify app dev (tunnel)
npm run build         # React Router build
npm run setup         # prisma generate + prisma migrate deploy
npm run lint          # ESLint
npm run typecheck     # React Router typegen + tsc --noEmit
npm test              # Webhook tests
npx prisma migrate dev  # Create/apply migrations
```

### Architecture
| Area | Path |
|------|------|
| App routes | `app/routes/` |
| Shopify auth | `app/shopify.server.ts` |
| DB schema | `prisma/schema.prisma` |
| Data sync layers (webhooks, crons, canonical tables) | `docs/data-sync-architecture.md` |
| Extensions | `extensions/` |
| Infra (terraform, historical ECS/RDS/ALB — see Deployment section) | `infra/terraform/` |
| Deploy scripts | `scripts/` |
| i18n | `app/i18n/` |

### Deployment

**Live state (2026-05-11 cutover):** production runs on an Amazon Lightsail instance, not ECS Fargate. See `memory/project_lightsail_migration_completed.md` for the full state map; `.claude/deploy-queue.md` has the deploy mechanics in detail.

- **Hosting:** Amazon Lightsail instance `cpg-labs-prod` at static IP `54.221.23.142` (medium_3_0, $24/mo, `us-east-1a`). Ubuntu 22.04 + Docker + Caddy. Containers `omnify-app:full-…` on :3000 and `omnify-app:omnify-…` on :3001, fronted by Caddy with Let's Encrypt certs.
- **Database:** Lightsail managed Postgres `cpg-labs-db` (micro_2_0, $15/mo, Postgres 16.13). Daily automated backups, 7-day retention.
- **Secrets:** env files on the instance at `/etc/cpg-labs/{full,omnify,cron}.env` (root-owned, 600). AWS SSM (`/omnify/` prefix) is preserved but no longer the runtime source.
- **DNS:** managed at GoDaddy (not Route 53). A records for `app.cpg-labs.io` and `omnify.cpg-labs.io` → `54.221.23.142`, TTL 600.
- **Crons:** Linux `crontab` (root) on the Lightsail box. 4 active lines: `lalamove-watchdog` (*/5), `retail-goals-sync` (0 * * * *), `shop-ingest-reconcile` (15 * * * *), `weekly-tone-and-diff` (0 3 * * MON UTC). EventBridge rules in `infra/terraform/*-cron.tf` are historical — all disabled and slated for teardown 2026-05-18.
- **Deploy:** `scripts/deploy.ps1 -App {full|omnify|both}` is the canonical script for the Lightsail stack (rewritten 2026-05-11 in `8e01087`). It builds the image, pushes both tags to ECR, SSHs into the Lightsail box, updates `/srv/cpg-labs/docker-compose.yml`, runs `docker compose pull && up -d`, then polls `/health` until 200. Options: `-Tag <date-sha>` to override the auto-generated tag, `-SkipBuild` to re-deploy an existing ECR image, `-SkipHealthCheck` for scripted pipelines. The pre-cutover ECS script is preserved at `scripts/deploy-ecs-legacy.ps1` for the rollback-to-ECS scenario (only valid before 2026-05-18 decommission) and will be deleted post-bake.
- **Shopify scopes (CPG Labs):** `shopify app deploy --config shopify.app.cpg-labs.toml` — unchanged by cutover.
- **Shopify scopes (Omnify):** `shopify app deploy --config shopify.app.omnify.toml` — unchanged.

**Rollback target until 2026-05-18:** ECS services drained to 0, RDS `omnify-postgres` + ALB + ECR images + SSM + 4 disabled EventBridge rules all preserved. **Do NOT run `terraform apply` against `infra/terraform/`** while in the bake window — the state still owns these resources and an apply would resurrect ECS to `desiredCount=1`, pointing at the now-dead ALB. After 2026-05-18, the migrated resources will be destroyed via targeted `terraform destroy` and the config cleaned up. Emergency rollback procedure (~5 min) is documented in the completed-migration memory.

### Environment Variables
- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`
- `DATABASE_URL` — Postgres (production)
- `GOOGLE_MAPS_API_KEY`, `GOOGLE_MAPS_MAP_ID`
- `APP_IDENTITY` — `cpg-labs` (all features), `omnify`, `retail`, `storytelling`, `storefront`
- `BASE_PATH` — subpath for multi-app deployments (e.g. `/full`)

---

## Hard Rules

- **Branch-per-task — work in isolation, merge intentionally.** Every non-trivial change happens on a feature branch, not directly on `main`. This bounds blast radius (a broken commit doesn't poison parallel sessions) and creates a natural pre-merge gate where lint/typecheck/review can run before code touches the shared branch.
  - **Cut a branch at session start** for any work touching `app/`, `prisma/`, `extensions/`, `infra/`, `scripts/`, `shopify.app.*.toml`, or anything else that ships. Naming: `feat/<short-slug>`, `fix/<short-slug>`, `chore/<short-slug>`, `docs/<short-slug>`. Always cut from the latest `main`: `git checkout main && git pull && git checkout -b feat/<slug>`.
  - **Skip the branch** only for: typo-only edits, single-line config tweaks, memory/`MEMORY.md` updates, or explicit user-approved hotfixes. When in doubt, branch — the cost of a wasted branch is near zero, the cost of poisoning `main` for parallel sessions is high.
  - **Stale `main` at session start:** if uncommitted work exists on `main` when you start (working tree dirty), do not silently inherit it into your branch. Ask the user whose work it is and whether to move it to its own branch, commit it as-is, or hold off. Never `git stash` or `git reset` someone else's work to clean the slate.
  - **Merge to `main` via squash-merge** when the branch is complete and gates pass. One commit per branch on `main` — keeps history readable and matches the unit-of-work model the deploy-queue tracks. Use `git checkout main && git merge --squash <branch> && git commit` with the final message, or `gh pr merge --squash` if a PR is open. Delete the branch after merge.
  - **Deploy-queue entry happens AFTER merge to `main`,** not before. The queue tracks code already on `main` waiting to deploy — branches are pre-merge state and don't belong in the queue. Don't double-track.
  - **Review before merge (Phase 2, not yet active):** a reviewer agent will gate every squash-merge against CLAUDE.md, the diff, and conflicts with other in-flight branches. Until that ships, the author-agent merges its own branch after lint/typecheck pass locally.
- **Deploy queue protocol — coordinate across parallel sessions.** Multiple Claude Code sessions run against this repo at the same time, so a per-change deploy causes redundant image rebuilds and can stomp other sessions' work-in-progress. Instead of auto-deploying at the end of every session, use `.claude/deploy-queue.md` as a shared pending/deployed log.
  - **After landing a change** that needs a deploy (anything under `app/`, `prisma/`, `extensions/`, `infra/`, `scripts/`, `shopify.app.*.toml`), append a Pending entry to `.claude/deploy-queue.md` with: date, short title, files touched, type (code/migration/env/Terraform), summary, what it affects, dependencies, and risk. Do this BEFORE telling the user the change is done.
  - **Before proposing a deploy**, read the full Pending section. Summarize everything pending — not just your own entry — to the user. Call out dependencies between entries (e.g. "entry X adds a column my entry Y reads from"). Flag conflicts if two entries touch the same file path.
  - **Ask the user** whether to deploy the full stack now or hold. Never auto-deploy when other Pending entries exist from a different session.
  - **After a successful deploy**, move the items that went out in that deploy from Pending → Deployed, adding the deploy timestamp and (if you can get it via `aws ecs describe-services`) the ECS task-def revision. Keep the last ~20 Deployed entries for history, prune older ones.
  - **Single-session fast path:** if Pending contains only your own entry and nothing else is queued, the old "auto-deploy at end of session" behavior still applies — just confirm once with the user. The queue entry stays as the audit trail.
- **Parallel sessions — capacity rules.** Multiple Claude Code sessions can run against this repo at once, but the shared working tree, the `Assert-CleanWorkingTree` deploy guard, and the single-threaded ECS rollout cap how many can deploy in parallel. The cap depends on what the session is doing.
  - **Coding sessions: 2 max, in separate `git worktree`s.** Two sessions sharing the same checkout will collide — a `git checkout` in one reverts files the other is editing (we hit this twice on 2026-05-02 with the marketing-split ↔ local-delivery-tweaks-v2 interleave). Use `git worktree add ../cpg-labs-<slug> <branch>` so each session has its own working tree. Deploys still serialize via the queue protocol above (only one ECS rollout at a time on `omnify-full-service`).
  - **Mockup sessions: unlimited.** Mockups in `inputs/mockups/` touch zero prod code, hit no lint gate (no `.tsx`/`.ts`), and don't trigger an ECS rollout. Each mockup session cuts a `mockup/<feature>` branch and commits WIP often — uncommitted files on `main` trip the deploy guard for ANY session that tries to deploy, so commit early or work in a worktree. At session end, squash-merge the mockup branch to `main` (no deploy needed) or delete it.
  - **Read-only / planning / research sessions: unlimited.** No file writes, no risk.
  - **Cross-session shared files** (`.claude/settings.json`, `.claude/deploy-queue.md`, `MEMORY.md`, `CLAUDE.md`): edits land on `main` and every session inherits on next pull. That's coordination, not collision — fine for slow-changing config but watch for two sessions editing CLAUDE.md simultaneously.
  - **Untracked files block deploys.** If you have WIP that isn't on a branch, the next deploying session has to stash it before `scripts/deploy.ps1` will pass `Assert-CleanWorkingTree`. Commit early or use a worktree to keep your WIP isolated.
- **Production and `main` must stay in sync.** Anything deployed to production must also be committed to `main`. If a session deploys changes (via `scripts/deploy-*.ps1`, `shopify app deploy`, or any infra/website push), the corresponding code changes must be committed in the same session — no "I'll commit it later." Conversely, if uncommitted work exists on disk that's already running in production, treat committing it as part of the current task before moving on.
- **Shell compatibility — Windows PowerShell 5.1.** The user's terminal and Claude's `PowerShell` tool both run in Windows PowerShell 5.1, which does not support `&&` / `||` pipeline-chain operators (parser error: *"O token '&&' não é um separador de instruções válido nesta versão"*). When sharing multi-step terminal commands or chaining inside the PowerShell tool, use `;` for unconditional sequencing or `command1; if ($?) { command2 }` for fail-fast chaining. One command per line is always safe. The Bash tool (POSIX) still accepts `&&` — only PowerShell breaks. Watch for this when copying example commands from documentation, GitHub READMEs, or other CLAUDE.md sections written in bash style.
- Keep the app embedded and aligned with Shopify Admin UX.
- Prefer Polaris web components for page and form structure.
- **One top-level `<s-page>` per route.** No extra wrappers.
- Use **CSS modules** at route level: `app/routes/<route-name>/styles.module.css`, camelCase class names.
- All layout in CSS modules; inline styles only for runtime-computed values.
- **Native form elements inherit fonts globally.** `app/root.tsx` applies `font-family: inherit; font-weight: inherit` to `select, input, textarea, button`. Do not add per-element font overrides — the global rule handles it.
- Keep selection state in React, de-duped by IDs.
- Disable actions when prerequisites are missing.
- Show clear error banners for API errors, map load failures, and missing credentials.
- **Never hardcode secrets;** use environment variables.
- **Never hardcode store-specific values** (metaobject types, field names, metafield keys, colors). All configuration comes from UI → database.
- All Shopify mutations go through React Router **`action` handlers.**
- Use `redirect` from `authenticate.admin` for auth-protected flows; `redirect` from `react-router` is fine for simple navigational redirects (e.g. home page).
- **No idle UI elements.** Every button, modal, input, or control must have a real effect on the process. Never add decorative or placeholder UI that doesn't do anything.
- **New UI elements require clarification.** Before adding any new button, modal, form field, or interactive element, ask the user:
  1. **How is it triggered?** (what user action opens/activates it)
  2. **What does it affect?** (what data, state, or flow it changes)
  3. **How should it behave?** (loading states, error handling, success feedback)
- **Reuse before creating.** If the requested behavior or logic resembles something already in the system, find the existing implementation and propose reusing it for consistency. Only create new patterns when no existing one fits.

---

## Task Contract

1. **Read** the target route and its sibling `styles.module.css` together.
2. **Reuse** existing components and patterns before introducing new abstractions.
3. **Normalize** API responses into stable UI types before rendering.
4. **Maps:** keep map instances stable; update markers/options in place.
5. **Collapsed & expanded forms:** When a page has both collapsed (non-fullscreen) and expanded (fullscreen) variants of the same UI section, **ALL** changes requested to UI elements must be applied to both forms.
6. **Before finishing:** run lint/typecheck/tests as applicable.
7. **In the final reply:** call out behavioral risks and manual test steps.

### Keeping docs/project-brief.md Updated
`docs/project-brief.md` is external context used by Claude in planning and ideation conversations (mobile app, Claude Projects, anyone unfamiliar with the code). It must stay in sync with the codebase — stale content misleads planning.

**Update whenever a session:**
- Introduces a new feature or renames an existing one
- Changes the multi-app identity mapping or scoped navigation
- **Starts a new initiative** → add to "In progress"
- **Lands an initiative** → move from "In progress" to "Recently shipped" with an absolute date, or delete if superseded
- **Shifts priorities** → reorder entries within their bucket
- Adds or removes a "Planned / not yet started" item

**The "Current Initiatives" section has three buckets:**
- **Recently shipped** — landed within the last ~3 weeks, kept as context for what just changed. Always tag with an absolute date (e.g. *(2026-04-08)*) so entries age cleanly. Prune anything older than ~3 weeks unless it is still load-bearing context.
- **In progress** — actively being built. Each entry should explain what, why, and where it stands (partially landed, planned, blocked).
- **Planned / not yet started** — acknowledged but not scheduled. One-line bullets are fine here.

When in doubt about whether something belongs in the brief, ask: "would a planning conversation be misled if this were missing?" If yes, add it. If the brief drifts from reality, fix it in the same session rather than deferring.

### Definition of Done
- Code follows route layout conventions used elsewhere in the repo.
- No obvious regressions in navigation, forms, or map interactions.
- `npm run lint` and `npm run typecheck` pass (or issues are explained).
- **After renaming or deleting route files**, run `npx react-router typegen` before `tsc`. React Router generates type files in `.react-router/types/` that become stale and cause phantom `TS2307` errors until regenerated.
- Relevant tests pass when affected (`npm test`).
- Scope/config changes reflected in Shopify app config.
- **Scope changes:** When any access scope is added or modified, remind the user to run `shopify app deploy --config <relevant-toml>` so the new scopes are deployed and the app doesn't crash.

---

## Shopify Design Compliance

This app is judged against Shopify's official **App design** guidelines and the **Built for Shopify** design requirements. The "UI Patterns" section below is our local implementation; the rules here are the canonical constraints that every UI decision must satisfy. When local convention and Shopify guideline conflict, the Shopify guideline wins — flag the conflict in the PR.

**Canonical sources** (re-read when in doubt, do not paraphrase from memory):
- App design index — https://shopify.dev/docs/apps/design
- App structure — https://shopify.dev/docs/apps/design/app-structure
- Layout — https://shopify.dev/docs/apps/design/layout
- Visual design — https://shopify.dev/docs/apps/design/visual-design
- Content — https://shopify.dev/docs/apps/design/content
- Navigation — https://shopify.dev/docs/apps/design/navigation
- Built for Shopify requirements — https://shopify.dev/docs/apps/launch/built-for-shopify/requirements#design
- Polaris web components — https://shopify.dev/docs/api/app-home/web-components

### Information architecture & navigation
- **Use `<s-app-nav>`** for top-level navigation (App Bridge native). Never use the legacy `NavMenu` from `@shopify/app-bridge-react` — `s-app-nav` is a Built for Shopify hard requirement and the only way the app's links render correctly when pinned to the admin nav.
- **Max 7 top-level nav items.** Item 8+ collapses into Shopify's "View more" dropdown and visually buries that feature. If you need to add an 8th, retire one first or move it under a parent route.
- **Nav labels: noun-based, short, scannable.** "Orders" not "Manage orders"; "Settings" not "Configure". Verb forms are reserved for action labels (buttons), never nav.
- **App name ≤ 20 characters.** Longer names truncate in the desktop pinned nav. Check every `shopify.app.*.toml` `name` field.
- **Sub-pages must highlight their parent nav item.** When a route is a child of an `<s-app-nav>` entry, the parent must stay active in the menu — verify after any URL restructure.
- **No app-nav duplication in page body.** The merchant already sees the nav; don't render a second copy of those links inside `<s-page>`.
- **Back button on every sub-page.** Built for Shopify requirement. Use Polaris `back-action` slot on `<s-page>` (or breadcrumbs when there are >1 ancestors). Never rely on browser back alone.
- **Tabs are secondary navigation only**, must never wrap, must never reposition during navigation, and must not modify the header above them. See the existing "Tabs" subsection in UI Patterns for the implementation contract.

### Page structure
- **One purpose per page.** If a page is doing two things, split it. Page title is action-focused and concrete: "Story-telling" not "Marketing".
- **`<s-page>` is the single top-level container per route** — already in our hard rules. The Shopify guideline that motivates it: every embedded page must use the Polaris page primitive so it inherits admin chrome, breadcrumbs, save bar slots, and responsive behavior for free.
- **Page header carries page-specific actions only.** Cross-app and global actions stay in `<s-app-nav>`.
- **Content lives inside containers** (`<s-section>` / `<s-box>`), never directly on the admin background. Text on bare background is a readability regression.
- **Cards have at most one primary action.** Secondary/destructive go alongside but only one button per card carries `variant="primary"`.

### Forms & save semantics
- **Use the Contextual Save Bar (`<s-save-bar>`)** on any page with editable persisted state (Settings, Brand, Goals, etc.). The CSB is how merchants know they have unsaved changes — inline submit buttons alone are non-compliant on form-heavy routes.
- **Error messages render in red, contextually next to the field they describe.** Page-top `<s-banner tone="critical">` is for whole-form failures (network, auth) — field errors belong on the field.
- **No more than one banner stacked on top of another in the same viewport area.** Multiple banners reading as a wall of red is a Built for Shopify rejection signal — consolidate into one banner with a list, or queue them.
- **Input labels must be precise.** "Name" alone is ambiguous; "Customer name" or "Store name" makes context explicit. The `label` prop is required even when `labelAccessibilityVisibility="exclusive"` is set (a11y still needs it).

### Visual design
- **Polaris primitives first, hand-rolled UI never** — already a hard rule. The Shopify-side reason: any custom button/select/checkbox you build will drift from admin styling and trigger Built for Shopify rejection.
- **Color semantics are reserved.** Each color has one meaning across the admin and apps must respect it:
  - **Green** = success, complete, positive status
  - **Yellow** = paused / needs attention but not urgent
  - **Orange** = in-progress / requires attention
  - **Red** = blocked, error, impossible action — never anything else (no red "delete" buttons in non-destructive contexts, no red branding)
  - **Blue** = informational, primary action — Shopify's blue (`#005bd3`-family), not your own
- **Never rely on color alone.** Pair every status color with iconography or text — colorblind merchants must be able to parse state. Status badges should carry both a tone and a label.
- **Contrast ≥ 4.5:1** for body text against background (WCAG 2.1 AA). The light-subdued `#6d7175` on white is exactly at the line — do not lighten it further. Never put light gray text on a colored background without checking contrast.
- **Typography: sans-serif only**, no serif/script fonts. Body text and interactive elements ≥ 13px; captions/subheadings ≥ 12px. Headings differ from body by weight and/or size — never by underline (reads as a link) and never by color alone.
- **4px spacing grid.** All gaps, padding, margin should round to a multiple of 4 (4, 8, 12, 16, 20, 24...). The existing UI Tokens table in this doc is consistent with this — keep it that way.
- **Density stays uniform per page.** Don't mix tight and loose spacing in the same view; pick one density for the page and hold it.
- **Brand-specific colors stay out of admin chrome.** Storefront/marketing accents (the teal/purple in Affiliates) belong inside content cards if at all — never on buttons, banners, or status indicators that compete with Shopify's reserved palette.

### Tables in admin context
- **Table row actions use secondary styling only** — text buttons, icon buttons, dropdowns. **Never `variant="primary"` inside a table row.** Primary buttons are reserved for the page-level CTA; using one per row creates 50 competing primaries and the merchant doesn't know what to click.
- See the existing "Tables" subsection for the visual spec (no zebra, header bg `#f6f6f7`, etc.).

### Mobile & embedded behavior
- **No horizontal page scroll on mobile.** Multi-column layouts collapse to a single column at the 768px breakpoint. Wide tables are the only legitimate `overflow-x: auto` case, and they must scroll inside their container, not the whole page.
- **Stack aside above main on mobile** — already in our layout pattern (`order: -1`). Re-confirm any new aside content respects this.
- **Don't auto-launch modals, popovers, dramatic animations, or fullscreen on page load.** Every overlay opens only after explicit merchant click. The same goes for promotional/onboarding overlays — if you ship one, it must be dismissible and must not re-open on every visit.

### Content & copy
- **Plain language, ~US grade-7 reading level.** Short sentences, scannable bullets, no jargon. If you find yourself writing a paragraph, restructure as a list.
- **Action labels: verb + noun.** "Create order", "Save changes", "Delete route" — never "OK", "Submit", "Go". The merchant must be able to predict what happens before clicking.
- **Use the same word for the same concept everywhere.** If it's a "route" in one place, it's not an "itinerary" in another. Pick the canonical noun/verb per concept and grep before introducing a synonym.
- **First reference uses the proper name; subsequent references in the same section use "we"** ("Omnify syncs your orders. We refresh every 5 minutes.").
- **No idioms, sarcasm, irony, or culture-specific phrasing.** All copy is bilingual (en + pt-BR) and idioms mistranslate. The "no em dash" rule already lives in feedback memory — applies here too.
- **All user-facing strings must come from `app/i18n/locales/`.** Hardcoded English in JSX is a regression — the Settings markets list (hardcoded country names) is the current open exception, fix opportunistically when touching that file.

### App icon & store listing
- App icon: PNG/JPG, 1200×1200, square (no rounded corners), icon fills 750–900px (10/16–12/16) with ≥ 75px (1/16) clear margin. Designed to read on white and light-gray. No Shopify logo, no brand impersonation.

### Plan-gating (when introduced)
- Plan-gated features must be **disabled and visibly labeled** ("Available on Plus", "Upgrade to access"), not silently hidden — the merchant needs to see what they could unlock. Plus-only features are the exception: hide entirely from non-Plus stores.

### Deceptive-pattern bans (Built for Shopify)
- No auto-launching anything on load. No false guarantees ("Save 30%!" without basis). No animations that obstruct content. No promotional/upsell content that isn't dismissible. Don't impersonate Shopify's first-party app icons or branding.

---

## Public Site (`cpg-labs.io`)

Everything publicly reachable that isn't the embedded Shopify admin app. Lives in **`site/`**, ships as static HTML to S3 + CloudFront, never touches admin runtime. The wall is structural (different framework, different host, different deploy lane), not just a convention.

### Scope
- **Today:** marketing pages (`/`, `/about`, `/pricing`, `/contact`), legal (`/privacy`, `/terms`, `/security`), product walkthroughs (`/screencast`, `/preview`).
- **Future (same surface, same wall):** blog, status page, public docs, release notes — anything served from `cpg-labs.io` that isn't the embedded admin app.
- **NOT in scope:** anything that requires a Shopify session, a database write, a server runtime, or merchant-only content. Those live in admin.

### Stack & hosting
- **Framework:** [Astro 5](https://astro.build), static output (`output: "static"` in `astro.config.mjs`).
- **Hosting:** AWS S3 + CloudFront (planned in Phase 2 of the marketing-admin split — currently Phase 1 builds the source only).
- **Deploy:** `scripts/deploy.ps1 -App site` (planned). Deploy = `aws s3 sync site/dist s3://...` + CloudFront invalidation. No ECS, no Docker, no task-def.
- **Local dev:** `cd site && npm install && npm run dev` (port 4321).

### Wall rules (CI-enforced, do not work around)
- **No imports from admin (`app/`).** Site code cannot read the Prisma client, Shopify SDK, encryption helpers, or anything else inside `app/`. Enforced by ESLint `no-restricted-imports` in the admin's `.eslintrc.cjs` and by structural separation (Astro doesn't see `app/` from inside `site/`).
- **No banned dependencies.** `site/package.json` MUST NOT list `@shopify/*`, `@prisma/client`, `prisma`, `@anthropic-ai/*`, `googleapis`, `@google/maps`, or any `@cpg-labs/shared-*` server-only package. Enforced by `scripts/check-site-deps.ts`, wired into `npm run typecheck`.
- **No backend logic.** Forms use `mailto:` links. If a future surface genuinely needs server I/O, the answer is either (a) add an API endpoint to admin and have the public page POST to it via CORS, or (b) use a third-party form processor (Formspree/Tally/Resend webhook). Either path requires explicit approval and a privacy-policy update.
- **No shared global CSS with admin.** `site/src/styles/global.css` is loaded by `BaseLayout.astro` only. Admin has its own CSS. The legacy `:has(s-app-nav)` body-background override that scoped admin chrome inside the shared `app/styles/site-theme.css` is obsolete here — Astro never renders admin elements.

### Conventions
- **Pages:** `site/src/pages/<slug>.astro`. Pure-static pages should not need scripts; if interactivity is needed, prefer inline `<script>` in the `.astro` file over framework islands. The codebase doesn't pull React into the site bundle on purpose.
- **Layout:** all pages render through `BaseLayout.astro`, which provides `<html>`, `<head>` (meta, OG, theme script), shared `<Nav>` and `<Footer>`. Pages with their own chrome (the homepage `/` and `/screencast`) pass `bareLayout={true}` to suppress the shared nav/footer.
- **Styles:** scoped `<style>` blocks in each `.astro` file. Astro auto-scopes them. Reusable styles live in `site/src/styles/<name>.css` and are imported from layouts or specific pages (e.g. `legal.css` for privacy/terms).
- **Theme:** light/dark via the `data-theme` attribute on `<html>`. Inline boot script in `BaseLayout.astro` reads `localStorage.theme` (or `prefers-color-scheme` on first visit) before paint. Theme persistence works through `ThemeToggle.astro`.
- **Assets:** `site/public/` only — copied from `public/` at the repo root for files the site needs (`omnify_tree.png`, `cpg-labs_box.png`, favicons, `screencast.mp4`). Don't reference assets in `app/public/` from site pages.
- **Content & copy:** the brand voice rules from "Shopify Design Compliance > Content & copy" apply here too — plain language, no idioms, no em dashes, bilingual-friendly. Action labels still verb + noun. No claims that overpromise.
- **No tracking pixels / analytics scripts** without explicit approval. Anything that loads remote JS from a third party changes the privacy story; route the request through the privacy-policy update flow.

### Out-of-scope for the public site
- Polaris components and their conventions (admin only).
- Shopify Design Compliance rules above (those govern admin chrome — Polaris save bar, `<s-app-nav>`, `<s-page>`, BFS requirements). The public site has its own visual language inspired by the corporate landing.
- Translation / i18n via the `app/i18n/` directory (admin only). If the public site goes multilingual, it picks its own approach.

### Adding a new page
1. Create `site/src/pages/<slug>.astro`. Import `BaseLayout`, set `title` and `description` props.
2. Use scoped `<style>` for page-specific styling. Reference `var(--site-text)`, `var(--site-bg)`, `var(--site-text-secondary)`, `var(--site-border)`, `var(--site-surface)` for theme-aware colors.
3. Run `npm run dev` from `site/` to verify locally.
4. `npm run build` to confirm static output writes cleanly to `site/dist/`.
5. Phase-2 deploy: `scripts/deploy.ps1 -App site` will sync `site/dist` to S3 and invalidate CloudFront. Until Phase 2 lands, the page exists in source but isn't served.

### Design Validation (mockup-first)
For any non-trivial UI refactor — charts, dashboards, new interaction patterns, anything where visual language matters — **always build an HTML mockup before touching production React code**. This is how the Retail Sales chart refactor and the Local Delivery tweaks landed smoothly: iterate on the visual in a throw-away HTML file, converge on the visual language with the user, THEN translate to components. The mockup is not optional.

- **Start from the template:** copy [inputs/mockups/_template.html](inputs/mockups/_template.html) to `inputs/mockups/<feature>-v1.html`.
- **Iterate in the mockup** until the visual language is settled (labels, legends, tooltip row order, colors, hover states, breakpoints). Include a "Notes" panel explaining the deltas vs current state.
- **Open questions live in the CLI, not in the mockup HTML.** Use the `AskUserQuestion` tool — present 2–4 options each with a label, description, and (when comparing layouts/strings) a `preview`. Never embed an "Open questions" panel inside the mockup file: the user's chosen answers belong in chat history where they're auditable, not buried in throw-away HTML. The mockup shows decided state only.
- **In-session iterations edit the original mockup file in place.** Do NOT spawn `-v2.html`, `-v3-final.html`, etc. for each round of feedback within a session — apply each round as edits to the same file. The session log is the iteration history; the file should reflect the LATEST agreed state. The version suffix (e.g. `-v1.html`) is the filename from the start, not a checkpoint per round. New mockups branched in a different direction (e.g. user explicitly says "keep this as a reference, build a fresh take from another angle") are the only legitimate reason to add a sibling file.
- **Iterate to a final clean version.** When the visual language is locked in, the same file should contain only the production target — no Before/After columns, no "REMOVED" callouts, no NEW pills, no highlight rings.
- **Commit the final mockup** alongside the production change as a reference artifact. Future sessions reviewing the design decision read the mockup first.
- **Register the final mockup in [inputs/mockups/INDEX.md](inputs/mockups/INDEX.md).** This is the discovery layer. Without it, the next session redraws the mockup from scratch instead of starting from the locked-in visual language. Rules:
  - **Before starting any UI mockup work, read `INDEX.md` first.** If a final mockup already exists for the feature/area you're touching, open it and use it as the starting point — do not create a new `-v1.html` from `_template.html`. Only branch to a new mockup if the user explicitly asks for a fresh direction.
  - **When you commit a final mockup,** add or update its row in `INDEX.md` in the same commit. Schema: `| Feature | Final mockup | Implements (route/component) | Last updated | Notes |`. One row per feature; in-place updates only — don't append a new row when iterating.
  - **When a mockup is superseded by a real implementation that has since drifted past it,** mark the row `STALE` in the Notes column with a one-line reason. Do not delete the row — stale mockups still document the original design intent.
- **Skip the mockup** only for trivial changes (single copy edit, class rename, CSS token swap). When unsure, ask the user.
- **Invoke `/design-engineer`** when starting UI or interaction work — it bootstraps the mockup-first + state-matrix workflow and loads the full convention library. (Renamed from `/ui-specialist` 2026-05-07 to reflect ownership of both visual AND interaction design.)

### Layout
- Aside/config blocks on the **right** on desktop, matching Shopify admin native layout.
- On mobile (`max-width: 768px`), aside renders **first** (above main content) via `order: -1`.
- Two-column flex layout with `gap: 20px`, stacks vertically on mobile.
- **Data-heavy pages (Local Delivery, Retail Expansion):** Full-width `<s-page>`, no `inlineSize`.
- **Settings/config pages:** Use `inlineSize="base"` on `<s-page>`.
- **Header:** Primary actions in header slots (`primary-action`, `secondary-actions`). Main on right; Back/Cancel on left.
- **Form layout:** Responsive grid: `grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;`.

### Tabs
All tabs use the flat/underline style. No emojis. No `<s-link>` (its shadow DOM forces blue text that CSS cannot override). CSS classes are defined per-route (not shared). The `TabBar` component (`app/components/tab-bar`) is deprecated — do not use it for new work.

- **When adding tabs to a page, ask the user:** "Will these tabs be potential standalone pages in a future app split, or will they always live inside this page?" The answer determines the element and placement:
  - `<Link to>` — tabs that navigate between Outlet child routes (e.g. Merchandising, Storytelling). Placed **outside** `<s-section>`, directly under `<s-page>`, above `<Outlet />`. Never use `<a href>` — plain anchors trigger full page loads which cause 404s inside the Shopify embedded iframe.
  - `<button onClick>` — tabs that switch content in-place without navigation (e.g. Settings, Retail Sales). Placed **inside** `<s-section>`, before the content. Add `border: none; border-radius: 0;` to reset button defaults.

- **CSS spec (route-level):**
  ```css
  .tabsRow {
    display: flex; align-items: center; gap: 7px;
    border-bottom: 1px solid #e1e3e5;
  }
  /* When inside <s-section>, bleed divider to section edges: */
  /* .tabsRow { margin: -4px -20px 12px; padding: 0 20px; } */

  .tab {
    padding: 8px 16px; border-bottom: 2px solid transparent;
    color: #6d7175; font-weight: 400; font-size: 13px;
    text-decoration: none; background: none; cursor: pointer;
    margin-bottom: -1px; /* overlap the container border */
  }
  .tab:hover { color: #303030; border-bottom-color: #8c9196; }
  .tabActive { color: #303030; font-weight: 500; border-bottom-color: #303030; }
  ```

### Collapsible Sections
Sections that collapse/expand (e.g. Fulfillment Details in Local Delivery, Cities Ranking and Expansion Projects in Retail Footprint) use a **bottom-right chevron toggle** — a real clickable `<div>`, not a CSS `::after` pseudo-element.
- **Structure:**
  ```tsx
  <div className={styles.collapsibleSectionWrap}>
    <s-section heading="...">
      {!collapsed && ( /* content */ )}
      <div
        className={`${styles.collapseChevron}${collapsed ? ` ${styles.collapsed}` : ""}`}
        onClick={() => setCollapsed(prev => !prev)}
        role="button"
        aria-label="Toggle section"
      >
        <span className={styles.chevronIcon}>›</span>
      </div>
    </s-section>
  </div>
  ```
- **CSS:**
  ```css
  .collapsibleSectionWrap { position: relative; }
  .collapseChevron { display: flex; justify-content: flex-end; padding: 4px 12px; cursor: pointer; }
  .chevronIcon { font-size: 18px; font-weight: 600; color: #8c9196; transform: rotate(270deg); /* UP = expanded */ display: inline-block; transition: transform 0.15s ease, color 0.15s ease; }
  .collapseChevron.collapsed .chevronIcon { transform: rotate(90deg); /* DOWN = collapsed */ }
  .collapseChevron:hover .chevronIcon { color: #303030; }
  ```
- Only the chevron area toggles — the heading is NOT clickable.
- The chevron lives **inside** `<s-section>` (not outside), so it renders within the Polaris card.

### Aside Card Blocks
Cards inside aside panels (e.g. Route Manager in Local Delivery, Expansion Projects in Retail Footprint) follow a shared structure:
```
┌─────────────────────────────────┐
│  [Badge]          [Destructive] │  ← cardHeader (negative-margin bleed)
│                                 │
│  stat line 1                    │  ← cardInfo (flex column, gap 4px)
│  stat line 2                    │
│                                 │
│          [Secondary] [Primary]  │  ← cardActions (flex-end, gap 12px)
└─────────────────────────────────┘
```
- **Wrapper:** `<s-box padding="base" borderWidth="base" borderRadius="base">`
- **Header:** `.cardHeader` — `display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin: -12px -12px 12px -12px; padding: 12px 12px 0;` — badge on left, destructive action (`<s-button variant="secondary" tone="critical">`) on right. This is an exception to the "Delete bottom-left" rule in the Buttons section — compact cards place the destructive action in the header for quick access.
- **Badge:** `.cardBadge` — `padding: 2px 8px; border-radius: 10px; font-size: 12px; font-weight: 600;` — static color (`background: #e4e5e7; color: #303030`) or dynamic via CSS vars (`--badge-bg`, `--badge-text`).
- **Stats:** `.cardInfo` — `display: flex; flex-direction: column; gap: 4px; margin-top: 8px;`
- **Actions:** `.cardActions` — `display: flex; gap: 12px; align-items: center; justify-content: flex-end; margin-top: 12px;` — only constructive buttons (Edit, Load). Destructive actions live in the header.
- **Card gap:** `16px` between cards in a list.

### Block Titles & Content Blocks
- Block title class: `modalTitle` — `font-size: 18px`, `font-weight: 600`, `margin: 0`.
- Subsection title class: `subSectionTitle` — `font-size: 16px`, `font-weight: 600`.
- Content block structure:
```tsx
<div className={styles.locationSettingsBlock}>
  <s-box padding="base" borderRadius="base">
    <s-stack direction="block" gap="base">
      <h2 className={styles.modalTitle}>Block title</h2>
      {/* content */}
    </s-stack>
  </s-box>
</div>
```

### Block padding tokens

CLAUDE.md's "4px spacing grid" needed a concrete 3-token mapping to Polaris's `padding="..."` prop on `<s-box>` / `<s-section>`. This is what we use everywhere; new code MUST pick one of these instead of hardcoding `padding: 12px` / `16px` / `20px` in CSS modules.

| Token | Polaris prop | Pixel value | Use case |
|---|---|---|---|
| **Tight** | `padding="tight"` | 12px | Aside cards, table cells, compact filter rows, route-manager cards, auto-assign accuracy block |
| **Base** | `padding="base"` | 16px | Default — main content blocks, `<s-section>`, KPI cards, brand-configuration form |
| **Loose** | `padding="loose"` | 20px | Wide hero blocks, modal bodies, full-width feature blocks (Affiliates Program overview, drilldown chart panels) |

**Hard rules:**
- **Prefer the Polaris prop, not custom CSS.** `<s-box padding="base">` is correct; `.myBlock { padding: 16px }` is a regression.
- **No hardcoded padding values in `app/routes/**/*.module.css`.** Justified exceptions (full-bleed map, modal-positioning custom) get a comment explaining why.
- **Auditing:** if you touch a block and find it uses raw padding, swap to the Polaris prop in the same PR. Don't bulk-rewrite — opportunistic migration.

**Padding violations to grep for:**
```bash
git grep -nE 'padding: ?[0-9]+px|padding-(top|bottom|left|right): ?[0-9]+px' \
  -- 'app/routes/**/*.module.css'
```

### Form Inputs
Polaris `<s-select>`, `<s-text-field>`, `<s-date-field>` render a compact-when-possible internal label. The convention in this codebase is to make the label external so multiple inputs in a row stay visually aligned and so the label can carry additional context without crowding the control itself.

- **Pattern:** wrap each control in `.filterControl` and place its label as a sibling `<span>` above. Use `labelAccessibilityVisibility="exclusive"` on the Polaris control so the internal label is hidden visually but still announced to screen readers.
  ```tsx
  <div className={styles.filterControl}>
    <span className={styles.filterLabel}>{t("filters.period")}</span>
    <s-select
      label={t("filters.period")}
      labelAccessibilityVisibility="exclusive"
      value={value}
      onChange={onChange}
    >
      {/* options */}
    </s-select>
  </div>
  ```
- **CSS:**
  ```css
  .filterControl { display: flex; flex-direction: column; gap: 4px; }
  .filterLabel { font-size: 12px; font-weight: 600; color: #6d7175; }
  ```
- **Mobile:** filter controls stack **one per row, full viewport width**. Never let them truncate ("This m..." / "Previo..."). In a horizontal filter bar, set `flex-direction: column` at `≤768px` and let the existing `flex: 1` on each control take the whole width.
- **Row packing — prefer wide rows over new rows.** When a filter bar has room to fit an adjacent action (e.g. Export CSV button, sort toggle, refresh), pack it into the SAME row on desktop rather than spawning a new row. A button sitting alone on an otherwise-empty row (see: Affiliate page Export CSV on 2026-04-17) wastes vertical space and reads as a layout bug. Use `flex-wrap: wrap` + `align-items: flex-end` on the container so the bar naturally wraps only when space genuinely runs out. On mobile the wrap becomes stacking — desired.
- **Reference implementations:** `app/routes/app.retail-sales.tsx` (Period + Compare-with selects) and `app/routes/app.local-delivery.tsx` (Location, Delivery promise, Time limit). Both use the same pattern — keep them consistent when touching either.

### Buttons
- **All button rows must be right-aligned** (`justify-content: flex-end`) within their container — modals, blocks, cards, sections, everywhere. No exceptions.
- `<s-button>` web component: removing `disabled` dynamically may not re-enable it — use conditional rendering with different `key` values or two separate elements.
- **Processing state:** Use `<s-button loading disabled>` as the standard feedback for in-progress actions (e.g. Apply, Save, Submit). Swap via key-based conditional rendering. Optionally change the button label text (e.g. "Applying…"). This is the canonical pattern — do not use external spinners below buttons.
- **Delete buttons:** Always confirm via a separate confirmation modal before executing the delete. Placement depends on whether delete is the expected action:
  - **Delete is the expected action** (e.g. confirmation dialogs, delete-only flows): Use `<s-button variant="primary" tone="critical">` right-aligned alongside other buttons. Order: Cancel → Delete (rightmost).
  - **Delete is NOT the expected action** (edit modals, settings blocks, any context where Save/Confirm is the primary intent): Place Delete **bottom-left** with `variant="secondary" tone="critical"`, spatially isolated from the primary action cluster on the right. This prevents misclicks. Use a split footer (`justify-content: space-between`): `[Delete]          [Cancel] [Save]`.
  - **Exception — Aside Card Blocks:** In card headers (Route Manager, Expansion Projects), the destructive action sits **top-right** next to the badge, not bottom-left. See the "Aside Card Blocks" section for this pattern. The bottom-left rule applies to modals and full-page forms; the top-right rule applies to compact cards.
- **Button order (left to right):** Cancel/Dismiss (secondary) → Save/Confirm/Load (primary). The main action is always **rightmost**; the dismiss action is always **leftmost**. This applies to modals, cards, blocks — everywhere. Exception: destructive actions go bottom-left when delete is not the expected action (see above).

### Control Panels & State-Driven Visibility
Compact control panels — selection bars, batch toolbars, contextual action strips that appear above tables, the Local Delivery selection footer, the Storytelling iteration controls — follow an **only actionable controls are visible** premise. Every control in the panel must have a real, executable effect in the current state. A control that has nothing meaningful to do right now is removed from the DOM, not greyed out.

- **Hide, don't disable, when the action is non-actionable in the current context.** A "Confirm" button rendered visible whenever orders are selected — even when no order has been re-routed yet — has nothing to confirm. The fix is hiding it until at least one order is staged for a route change, not adding a `disabled` state. Disabled controls signal "this is the panel's purpose, you just can't use it yet" — they belong on Save buttons in forms with validation errors, not on context-specific actions in batch toolbars.
- **Disable is reserved for narrow cases:** the action **is** the panel's reason-for-being AND a precondition is unmet AND the user benefits from seeing the affordance with an inline explanation (e.g. Save disabled with tooltip "Form has validation errors"). When in doubt, hide.
- **Every interactive panel needs a state matrix at design time.** Before implementing, enumerate the meaningful states (no selection / partial selection / all-staged / mixed-dirty / error / loading) and for each state list which controls are visible/hidden/enabled/disabled. The `/design-engineer` skill (Phase 3.5) requires this matrix before code is written. Sessions that skip it ship silent state bugs — the canonical case is the local-delivery Confirm button (shipped 2026-05-XX) where the "selected but untouched" state was never explicitly designed.
- **The state matrix lives in the mockup file**, not in code comments. Future sessions reading the design decision should see what every state was supposed to do, not just what the happy path looks like. When adding/changing a state in production, update the mockup matrix in the same commit.
- **State decisions resolve via `AskUserQuestion`, not assumption.** If the cell value for a given state×control is ambiguous, escalate. Don't guess — the matrix is a contract.

### Tables
- **No zebra striping.** All tables use white rows with subtle borders — this is consistent across Local Delivery, Price Tags, Carrier Service, and Retail Expansion.
- Header rows: `background: #f6f6f7`, `font-weight: 600`, `color: #6d7175`, **text-align: center**.
- Data row borders: `1px solid #f1f1f1` (lighter than card borders).
- Row hover: `background: #f6f6f7`.
- Column group separators (multi-radius tables): `border-left: 2px solid #e1e3e5` on the first sub-column of each group.
- Wrap tables in a container with `overflow-x: auto` for mobile scroll.
- **Sort arrow glued to the last word.** When a column header is sortable, render the arrow immediately after the label with a non-breaking space (`{"\u00A0"}`) joining them, no regular space. Wrap the arrow in a `<span>` with `display: inline-block; white-space: nowrap;`. The arrow must never wrap to its own line when the header is narrow — it sits on the same row as the last word.
- **Currency values use compact 1-decimal format.** `R$6.5k`, `R$1.2M`, `R$950`. Always prefix with the currency symbol (`R$`, `$`, `€`), never append it as a word (`BRL`, `USD`). The suffix is lowercase `k` for thousands and uppercase `M` for millions. Values under 1,000 render via `Intl.NumberFormat` with no decimals. See `formatCurrencyCompact` in `app/routes/app.affiliates.tsx`.

### Icons
- Never use emoji for icons in elements that intend to resemble the native Shopify Polaris experience (e.g. search fields, action buttons, nav items). Use **inline SVG** following Polaris conventions: `viewBox="0 0 20 20"`, `width="16"`, `height="16"`, `aria-hidden="true"`, `currentColor`. See `app/components/tab-icons.tsx`. Emoji is acceptable in custom UI elements like tab labels where it's used as decorative content.

### Search & Modals
- When the action button opens a **modal**, the inline search field captures text only — no dropdown results rendered inline. When results are intended to appear in the **same block** (no modal), an inline expander/dropdown is expected.
- Action buttons associated with an inline search field (e.g. Browse, Search, Filter) pass the typed text to the modal search field and trigger search automatically.
- Search results render **only inside the modal**, never in the main page.
- Modal search input: bordered container with SVG search icon inside, mimicking Shopify's native search.
- Clicking "Add" closes modal and clears search results.
- Declare `<s-modal>` wherever makes sense for code readability (near the triggering code).
- **Radio-button options in modals:** Use `<s-choice-list>` with `<s-choice>` children (not HTML `<input type="radio">`). For two-column option groups, use a CSS grid container: `grid-template-columns: 1fr 1fr; gap: 16px`. See Local Delivery map style modal and Retail Expansion heatmap options modal as reference implementations.
- **Draft/applied pattern for modal settings:** Keep a `draft` state and an `applied` state. On open, copy applied → draft. On cancel, reset draft → applied. On confirm, copy draft → applied and persist to localStorage.

### Badges
- Selected items displayed as Polaris-style badge chips with `×` remove button.
- `margin-top: 12px` between search row and badge list.

### Shopify Web Components — Common violations to grep for

Before opening a PR, run these greps against your touched files. ESLint's
`no-restricted-syntax` rule in `.eslintrc.cjs` (overrides → `app/routes/**`)
flags the most common ones as warnings, but greps catch the rest.

```bash
# Raw <button> in route files (use <s-button>)
git grep -nE '<button(\s|>)' -- 'app/routes/**/*.tsx'

# Raw <a href=...> in route files (use <Link to> or <s-link href>)
git grep -nE '<a [^>]*href=' -- 'app/routes/**/*.tsx'

# Emoji literal in JSX likely-icon contexts
git grep -nE '🟡|🚫|🚨|⏰|⏳|🕒|🏬|🥕|🏆|🟢|⚠|✓|✗' -- 'app/**/*.tsx'

# Hardcoded hex color outside CSS modules
git grep -nE 'color: ?#[0-9a-fA-F]{3,6}|background: ?#[0-9a-fA-F]{3,6}' \
  -- 'app/**/*.tsx'
```

If you find a justified exception (e.g., emoji inside user-facing copy,
not as an icon), suppress the ESLint warning with:
```jsx
{/* eslint-disable-next-line no-restricted-syntax */}
<button onClick={...}>...</button>
```
and add a one-line reason in the comment.

### Shopify Web Components
- **Default to native Polaris web components — and BEFORE writing any custom CSS for an interactive element, search the catalog at [shopify.dev/docs/api/app-home/web-components](https://shopify.dev/docs/api/app-home/web-components) for an existing primitive that matches the requested behavior or look.** Layout (`<s-page>`, `<s-section>`, `<s-stack>`, `<s-box>`), forms (`<s-select>`, `<s-text-field>`, `<s-checkbox>`, `<s-choice-list>`, `<s-date-field>`), feedback (`<s-banner>`, `<s-badge>`, `<s-spinner>`), navigation (`<s-link>`, `<s-button>`, `<s-modal>`), media (`<s-icon>`, `<s-image>`) and many more are all built in. Polaris primitives ship with the right tones, accessibility hooks, and Shopify-admin-native rendering for free — bespoke versions drift over time and rarely match. **If you find yourself writing CSS to make a `<button>` look like a link, or styling a `<span>` to mimic a badge, you skipped the catalog — go back and use `<s-link>` / `<s-badge>` / etc.** The 2026-05-10 incident: shipped a custom-styled `<button>` for "link-style" Map-style action when `<s-link>` was the canonical primitive. Caught in review, reshipped. If a Polaris primitive doesn't fit a specific need, document why in the PR.
- **Icons use `<s-icon type="...">`,** not hand-rolled SVG paths or `@shopify/polaris-icons`. The `type` prop accepts named icons from Polaris's 600+-icon library (e.g. `"search"`, `"bolt"`, `"receipt-dollar"`, `"truck"`). Browse the full list inside the icon docs page. Pass `tone` (`info`/`success`/`warning`/`critical`/`auto`/`neutral`/`caution`) and `size` (`small`/`base`) instead of styling manually. Existing inline SVGs and `app/components/tab-icons.tsx` predate this rule and migrate opportunistically when a file is touched — do not bulk-rewrite.
- Use `<s-option>` inside `<s-select>`, not HTML `<option>`.
- `<s-select>` onChange: cast with `(e.currentTarget as HTMLSelectElement).value`.
- `<s-choice-list>` onChange: cast with `(event.currentTarget as { values?: string[] } | null)?.values?.[0]` and validate against expected union type.
- **`<s-button>` with `commandFor`/`command` + `onClick`:** Never combine `commandFor="modal-id" command="--hide"` with an `onClick` handler on the same `<s-button>`. The modal dismiss command races with the click handler and the handler may never fire. Instead, run all logic inside the `onClick` handler and close the modal programmatically: `document.getElementById("modal-id")?.removeAttribute("open")`.
- **`<s-section>` slot assignment:** When wrapping `<s-section slot="aside">` in a `<div>`, move the `slot="aside"` to the wrapper `<div>` — Shopify's `<s-page>` only slots direct children.
- **Slots don't work from child routes.** `<s-page>` only sees direct children for slot assignment. A `<div slot="aside">` rendered inside `<Outlet>` (child route) will be ignored. If only one tab needs a sidebar, render the content inline within the main area instead.
- **Use `<s-checkbox>` instead of native `<input type="checkbox">`.** Native checkboxes render with browser-default blue; `<s-checkbox>` renders in Shopify's standard dark style.
- **`<s-checkbox>` does not accept children.** Place the label text outside as a sibling: `<s-checkbox checked={...} onChange={...} /> Label text`. Wrapping text inside `<s-checkbox>children</s-checkbox>` causes a TypeScript error (`Property 'children' does not exist`).
- **`<s-checkbox>` + label text toggle pattern.** HTML `<label>` wrapping does not auto-toggle `<s-checkbox>` (web component). Use a container `<div>` with `onClick` that toggles state, `role="button"`, and `user-select: none` in CSS:
  ```tsx
  <div className={styles.checkboxToggle} onClick={() => setState(prev => !prev)} role="button">
    <s-checkbox checked={value || undefined} onChange={() => setState(prev => !prev)} />
    Label text
  </div>
  ```
  ```css
  .checkboxToggle { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
  ```
  This is the system-wide standard for all `<s-checkbox>` + label combinations.

### Mobile
- All pages must be mobile-friendly. Main breakpoint: `768px`.
- Tables use `overflow-x: auto` for horizontal scroll on small screens.
- Modals and result lists must be scrollable/responsive.

### Inserted Elements — Spacing
Whenever a new element is inserted into a page — **temporary** (loading bars, sync-progress indicators, toast banners, status strips) or **permanent** (new cards, new sections, new tables) — it must carry the standard spacing for its type so it doesn't visually crash into adjacent content.

- **Never render an inserted element flush against the next one.** A progress bar sitting directly on top of the card below it (see: Affiliate ranking sync bar on 2026-04-17) reads as a bug. Leave breathing room.
- **Default gaps:**
  - Between stacked elements inside a section: `margin-bottom: 12px` (or parent `gap: 12px`).
  - Between cards in a list: `gap: 16px`.
  - Between page-level sections: `gap: 20px` (matches `<s-stack gap="base">`).
  - Page-top banners / loading bars above the first content card: `margin-bottom: 16px`.
- **When to own spacing on the inserted element:** if the new element is **conditionally rendered** (e.g. a loading bar that only appears during sync), apply the bottom margin to the inserted element itself, not to the next-sibling card. That way the card keeps its natural top position whether the loading bar is there or not.
- **When to own spacing on the container:** if the parent uses flex/grid with `gap:`, the gap handles spacing automatically — don't add extra margin on the inserted child.
- **Sync-progress / loading strips specifically:** always wrap with `margin-bottom: 12px` when rendered above a card or content block. Match the visual weight of the bar (1px progress bar → 12px gap; a full banner → 16px gap).
- Full-width on data-heavy pages (Local Delivery, Footprint Expansion). `<s-page>` must NOT wrap the map in `inlineSize="base"` — the map needs the whole viewport.
- Canvas: `min-height: 360px` so it never collapses; desktop `height: calc(100vh - 140px)`; mobile `height: 300px` (more of the screen belongs to the map on phones).
- **Expand / collapse is a desktop-only control.** On mobile, `.mapOverlayButton` renders `display: none` inside the `@media (max-width: 768px)` block. The fullscreen map toggle breaks the iframe-inside-admin experience on small screens (the overlay spills past the iframe and interactions break).
- Map container ref + Google Maps SDK loaded via `app/utils/load-google-maps.client.ts` — keep map instances stable; update markers/options in place on data changes.

### Drilldown Charts (Shopify-native)
All KPI drilldown charts — Revenue, Orders, AOV, Same-store YoY, Achievement ranking, Discount — follow a single frame so the dashboard reads as one coherent instrument panel. Reference implementation: `KpiDrilldownBars` in `app/routes/app.retail-sales.tsx` with CSS at `app/routes/app.retail-sales/styles.module.css`.

- **Chart frame:** `grid-template-columns: 44px 1fr` — y-axis column on the left (5 ticks, labeled), plot area on the right with horizontal gridlines at each tick. Zero tick uses `.gridlineZero` for emphasis.
- **Scale:** pick a ceiling via `niceCeil(maxValue)` (rounds to 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10 × 10ⁿ). Pad by ~15% before ceiling when labels render outside the bar (Same-store YoY) so the label never collides with x-axis text.
- **Bars — flat fills only.** No gradients, no inset shadows. Shopify blue `#005bd3` for current period (MTD), pastel `#b3d1ff` for the projection portion stacked above it, light gray `#d9e3ef` for prior year.
- **Bar variants by metric:**
  - **Revenue / Orders:** split "Current + projection" bar (MTD solid bottom, projection pastel top) + flat PY bar next to it. Revenue adds a dotted goal marker (see below).
  - **AOV / Discount:** single solid current bar + flat PY bar (no projection split — rates aren't cumulative).
  - **Same-store YoY:** single bar per location, green if positive / red if negative; grows up or down from a dynamic baseline (see below).
  - **Achievement ranking:** not bars at all — horizontal sorted list (see below).
- **No labels above bars.** Values live in the tooltip on hover/focus. Only the y-axis, gridlines, and the goal marker label carry numbers on the chart face.
- **Goal marker (Revenue only):** dotted horizontal line, ~20% wider than the bar pair, centered over the group, with a compact goal value label to its right. 2px dotted in `#b8350f`. No shaded bar, no solid line — dotted is the signal for "target/reference," not "measurement."
- **Same-store YoY — dynamic baseline:**
  - **All-positive:** zero line at bottom, green bars grow up.
  - **All-negative:** zero line at top, red bars hang down.
  - **Mixed:** zero line at `(niceMax / (niceMax + niceMin)) * 100%` from top (visible, `.gridlineZero`). Green bars grow up from the baseline; red bars grow down from it. Labels sit outside the bar (above for positive, below for negative) — the 15% scale padding keeps them from colliding with x-axis text.
- **Achievement ranking (formerly "Best vs worst"):** horizontal sorted list, not bars. Row grid: `20px rank · 140px name · 1fr track · 52px %`. Tiers: green `#067647` (≥80%), yellow `#d99a0a` (60–79%), red `#d72c0d` (<60%). Include a tier legend below the list with threshold labels.
- **Subtitle carries date context.** `Apr 1–17, 2026 · compared to Apr 2025 · goal for Apr 2026`. Never put the date range inside legend items — legends describe the visual encoding only (color = series), dates are chart-wide metadata.
- **Mini stats table below the x-axis** (Revenue only): row labels left-aligned in the 44px y-axis column; one column per bar group under the x-axis position. Rows: `Goal` (achievement %), `YoY` (%). Values colored green/red/subdued. This moves per-location metadata out of the chart body while keeping it glanceable.

### KPI Drilldown Interaction
Clicking a KPI card toggles a drilldown chart linked to that metric. Behavior:

- **Toggle:** clicking the active card hides its drilldown; clicking another card switches. Maintain `activeKpi` state in the page component.
- **Active highlight:** the active card carries a colored border (Shopify blue) and a subtle shadow so the source of the drilldown is obvious at a glance.
- **Placement — desktop:** drilldown renders BELOW the entire row of cards, spanning the full width. Scoreboard cards above stay visible; clicking a different card in the same row swaps the drilldown in place.
- **Placement — mobile:** drilldown renders BELOW the clicked card AND ABOVE the next card in the same row (DOM reorder). The user should always see the drilldown directly beneath the card they clicked — never buried after the whole card list. Use `flex-direction: column` + `order:` to achieve this or inline the drilldown between cards conditionally on the active state.
- **Reference implementation:** `app/routes/app.retail-sales.tsx` — Row-1 (Revenue/Orders/AOV) and Row-2 (Same-store YoY / Achievement ranking / Discount) both follow this pattern.

### Tooltips (chart + ranking)
- **Trigger:** `:hover` and `:focus-within` on the bar group (or ranking row). Group must be `tabIndex={0}` for keyboard access.
- **Style:** dark background `#1f1f1f`, white text, 11px, rounded 6px, soft shadow, arrow pointing down to the anchor. Row values right-aligned with `font-variant-numeric: tabular-nums` so digits line up across rows.
- **Row order (variance-first):** `MTD → Projected → Goal → vs. Goal → Prior year → YoY`. Put the absolute numbers the user reads FIRST (MTD, Projected, Goal), then the computed variances (vs. Goal, YoY). Subsets per chart:
  - Revenue: all 6 rows.
  - Orders: `MTD · Projected · Prior year · YoY`.
  - AOV / Discount: `Current · Prior year · YoY`.
  - Same-store YoY: `Current window · Matching prior window · YoY`.
  - Achievement ranking: `Projected · Goal · vs. Goal · Rank`.
- **Absolute values inside the tooltip.** Do not use the compact `R$16k` format — use `R$16,000` with thousands separators and zero decimals. Compact format stays on y-axis ticks and the goal marker label (limited space); the tooltip has room for precision.
- **On-dark variance colors:** green `#7ee0a1` for positive, red `#ff9b85` for negative. These are softer than the chart bar greens/reds because they read better on the dark tooltip background.

### UI Tokens
| Token | Value | Use |
|-------|-------|-----|
| Subdued text | `#6d7175` | Secondary labels, helper text |
| Border | `#e1e3e5` | Cards, rows, dividers |
| Light border | `#f1f1f1` | Table data row separators |
| Subtle border | `#eceeef` | Grid-based table row separators |
| Shopify green | `#008060` | Active states, primary indicators |
| Critical red | `#d72c0d` | Delete buttons, error states |
| Light gray bg | `#f6f6f7` | Map canvas, empty states, table headers, hover |
| Header text | `#3a3a3a` | Stronger header labels (bordered tables) |

---

## Navigation

- Structure navigation around merchant tasks; keep categories minimal and scannable.
- Do not duplicate app nav links inside the page body.
- Use tabs only for secondary navigation below the header; keep tabs single-line.
- Provide a clear way back (breadcrumbs or Back button).

### Subpath (BASE_PATH)
When deployed under a subpath (e.g. `BASE_PATH=/full`), **every URL-handling layer already prepends the basename**. Never add `basePath` manually to a nav link or form action — you will get `/full/full/...` and 404s.

- **React Router `<Link>` / `<form>` / `useSubmit`:** plain absolute paths. `to="/app/foo"`, `action="/app/foo"`. React Router applies the basename from `react-router.config.ts`.

- **Shopify App Bridge `<s-link>`:** plain absolute paths. `href="/app/foo"`. App Bridge prepends the `application_url`'s path component at navigation time. Verified 2026-04-22 via CloudWatch: `<s-link href="/full/app/retail-sales">` produced `GET /full/__manifest?paths=%2Ffull%2Ffull%2Fapp%2Fretail-sales` (double prefix → 404). Removing the manual prefix was the fix.

- **Static assets (`<img>`, `<link rel>`, `<source>`, etc.):** DO prepend `basePath`. These are direct HTTP fetches served by Express static middleware under `/full/<asset>`, outside the React Router and App Bridge URL-prepend layers.
  ```tsx
  const logoSrc = `${basePath}/cpg-labs_box.png`.replace(/\/+/g, "/");
  ```

- **Enforced by CI:** [scripts/check-no-basepath-in-nav-links.ts](scripts/check-no-basepath-in-nav-links.ts) is wired into `npm run typecheck` and fails on any `href` / `to` / `action` JSX attribute that concatenates `basePath` on any non-static-asset tag. Regression history: `facd79e` introduced the prefix on `<s-link>`; v17 removed (correct but masked by an unrelated split-brain making nav look broken); v18 re-added (broken); v19 removed definitively with CloudWatch proof. Standalone: `npm run check:basepath`.

- **`BASE_PATH` is baked at Docker build time**, not runtime. `react-router.config.ts` reads `process.env.BASE_PATH` during `npm run build` inside the Dockerfile. Changing the `BASE_PATH` env var on the ECS task definition alone will NOT update the basename — the image must be rebuilt with the correct `--build-arg BASE_PATH=...`. Docker layer caching can silently reuse a stale build; use `--no-cache` if the basename is wrong after deploy.

- **Permanent fix (planned, not yet shipped):** the CPG Labs full app moves to its own hostname (`app.cpg-labs.io`) in Phase 6 of the AWS split-brain remediation plan — kills BASE_PATH entirely. See [docs/aws-topology.md](docs/aws-topology.md).

---

## MCP Usage
- Use **`learn_shopify_api`** before implementing unfamiliar Shopify flows.
- Use **`introspect_graphql_schema`** before changing GraphQL queries/mutations.
- Prefer schema-driven changes over guessing Shopify types/fields.

## Shopify API Gotchas
- **`discountNodesCount` caps at 10,000.** If you need an exact count above that, paginate and count manually.
- **Pagination without `sortKey` is unstable.** Shopify's default cursor pagination for discount/code queries can return different subsets on each run. Always use `sortKey: ID` or `sortKey: CREATED_AT` for deterministic traversal.
- **Bulk discount updates must be idempotent.** When updating thousands of codes, always check if each code already has the target state before mutating. Use a loop-until-zero-remaining pattern, not a single pass.
- **Theme settings are split across files.** Announcement bar content lives in `sections/header-group.json`, PDP banners in `config/settings_data.json`, and promotional logic in `snippets/*.liquid`. When auditing promotional consistency, read all three.
- **Classifying Shopify locations as store vs warehouse:** Use the `localPickupSettingsV2` field on the `Location` GraphQL type. Non-null = physical store (pickup enabled), null = warehouse/DC. This is more reliable than `fulfillsOnlineOrders` or `shipsInventory` for determining physical retail presence.

## GE Beauty
Operational tooling and knowledge for the GE Beauty Shopify store moved to the `nami-works` repo (`sandbox/gebeauty/`) on 2026-04-23. When designing cpg-labs features that intersect GE Beauty operations, read `nami-works/sandbox/gebeauty/field-notes.md` for the lessons captured during manual store ops.

---

## Product & Data
- Request only required access scopes; update the relevant `shopify.app.*.toml` when needed.
- Handle protected customer data errors with a clear UI banner fallback.
- Use field masks / `first:` limits on GraphQL to reduce payload.
- **Never store large record sets as a single JSON column.** Storing tens of thousands of records (orders, customers) in one Prisma `Json` column causes OOM on write and slow page loads on read. Use normalized tables with proper indexes instead. The Retail Footprint analytics migration (`RetailOrder`, `RetailCustomer`, `RetailCityMonthly`, `RetailHeatmapBucket`) is the reference pattern.
- **Background sync processes must survive container restarts.** ECS Fargate replaces tasks on deploy, killing in-flight background work. Design syncs so progress is persisted to the DB per page (not just at the end), and the sync status can be cleanly reset and restarted. Never rely on a single fire-and-forget promise completing before the next deploy.
- **Batch DB writes with raw SQL for bulk ingestion.** Prisma `$transaction` with hundreds of individual `upsert()` calls is ~100x slower than a single `INSERT ... ON CONFLICT DO UPDATE` via `$executeRawUnsafe`. Use the bulk pattern for sync/migration workloads (see `upsertRetailOrders` in `analytics-queries.server.ts`).
- **Optimistic creates: generate IDs client-side.** When a newly created entity must appear in the UI immediately (e.g. a new project card in a sidebar), generate the ID on the client (`set-${Date.now()}`), pass it to the server action via formData, and use it for optimistic local state. The server should prefer the client-supplied ID over generating its own. This prevents ID mismatches between optimistic UI and persisted data.

---

## Maps & Geodata
- Use Maps JavaScript API with `importLibrary` and `mapId`.
- Do not mix cloud-based map styling with JSON styles on the same map.
- Validate API keys; show banners if missing.
- Only style markers you create; never target internal map DOM.
- **City-level geocoding fallback:** When records (customers or orders) lack precise lat/lng but have a `city` field, geocode the city via Google Maps Geocoder and use the city centroid as coordinates. Cache geocoded cities in state (`cityGeocodes`) and persist via server action. Apply this fallback in `enhanced*` memos (e.g., `enhancedOrders`, `enhancedCustomers`) that combine precisely geocoded records with city-level fallbacks.
- **Customer counting in radius computations:** Merge unique IDs from BOTH geocoded customers within radius AND customer IDs from orders within radius. Use a `Set<string>` to deduplicate.

---

## Error Handling
- Show banners for API errors, map load errors, and missing credentials.
- Keep logs for developer diagnostics; user-facing messages must be clear.
- Avoid destructive git commands unless explicitly requested.

## Logging

Every server-side module (route loaders/actions, services, webhooks) **must** include structured console logs. **Log access post-Lightsail-cutover (2026-05-11):** logs are written to the Lightsail instance under `/var/log/cpg-labs/*.log` (Docker container stdout/stderr is also captured by `docker compose logs`). To tail them: `ssh -i ~/.ssh/cpg-labs-lightsail.pem ubuntu@54.221.23.142 'sudo tail -F /var/log/cpg-labs/*.log'`, or per-cron-log via the named file (`lalamove-watchdog.log`, `retail-goals-sync.log`, etc.). The old `aws logs tail /ecs/omnify-full ...` CloudWatch path is empty post-cutover (ECS scaled to 0) and `scripts/logs.ps1` needs a rewrite — it still wraps the dead ECS log groups. Until rewritten, prefer the SSH tail.

### Pattern

```ts
// Operation start
console.info(`[module-name] operation START shop=${shop} param=${value}`);

// Success
console.info(`[module-name] operation OK shop=${shop} result=${count}`);

// Skipped / non-fatal
console.warn(`[module-name] operation SKIP shop=${shop} reason=details`);

// Failure
console.error(`[module-name] operation FAILED shop=${shop}`, error);

// State transition
console.info(`[module-name] status updated ${prev} → ${next} shop=${shop}`);
```

### Rules
- **Prefix:** `[kebab-case-module-name]` — matches the feature (e.g. `[local-delivery]`, `[retail-footprint]`, `[price-tags]`). Use `[module:context]` for sub-contexts (e.g. `[local-delivery:webhook]`).
- **Always include** `shop=` on loader, action, and service-level logs (audit trail).
- **Log at:** operation start, final result (OK/FAILED/SKIP), and each paginated loop iteration for GraphQL fetches.
- **Include counts** (`orders=`, `customers=`, `routes=`) on summary lines.
- **Nullable values:** use `${value ?? "?"}` rather than crashing the template literal.
- **Never log secrets, tokens, or PII** (no API keys, customer emails, addresses).
- Use `console.info` for normal flow, `console.warn` for recoverable issues, `console.error` for failures.
- **Long-running sync pipelines:** Log elapsed time (`elapsed=Xs`), per-step duration (`durationMs=N`), and running totals (`total=N`) on every page/batch. This is essential for diagnosing stuck syncs vs. slow-but-progressing ones. Use `[module:sync]` sub-context prefix.

---

## Carrier Services

See `docs/carrier-services.md` for full platform docs.

**Lalamove** (last updated 2026-03-24)
- API v3 — REST, HMAC-SHA256 auth
- Sandbox: `https://rest.sandbox.lalamove.com/v3` | Production: `https://rest.lalamove.com/v3`
- Flow: POST `/v3/quotations` → get `quotationId` + `stopIds` → POST `/v3/orders`
- 11 markets: SG_SIN, HK_HKG, MY_KUL, PH_MNL, TH_BKK, VN_HAN/SGN, ID_JKT, TW_TPE, JP_TYO, MX_MEX, BR_SAO
- Official SDK: `@lalamove/lalamove-js` v1.1.0
- Env vars needed: `LALAMOVE_API_KEY`, `LALAMOVE_API_SECRET`
- **Special requests vary per city within the same market.** A single market (e.g. `BR_SAO`) contains multiple cities with different available special requests and service types. Always validate special requests against the specific city + service type, not just the market. The `/v3/cities` endpoint returns per-city availability; the config stores city in `lalamoveLocationConfig.data.city`.
