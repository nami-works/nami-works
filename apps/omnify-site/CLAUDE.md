# Omnify Site — Per-App Rules

Public marketing site at `https://cpg-labs.io`. Pure-static, never touches admin runtime. The wall to `apps/omnify-admin/` is structural (different framework, different host, different deploy lane), not just convention.

For cross-cutting monorepo rules, see the root [/CLAUDE.md](../../CLAUDE.md). For anything Shopify-admin / Polaris / `<s-page>`-related, see [../omnify-admin/CLAUDE.md](../omnify-admin/CLAUDE.md) — those rules **do not apply here**.

## Scope

- **Today:** marketing pages (`/`, `/about`, `/pricing`, `/contact`), legal (`/privacy`, `/terms`, `/security`), product walkthroughs (`/screencast`, `/preview`).
- **Future (same surface, same wall):** blog, status page, public docs, release notes.
- **NOT in scope:** anything that requires a Shopify session, a database write, a server runtime, or merchant-only content. Those live in `apps/omnify-admin/`.

## Stack & hosting

- **Framework:** Astro 5, static output (`output: "static"` in `astro.config.mjs`).
- **Hosting:** AWS S3 + CloudFront.
- **Deploy:** `scripts/deploy-omnify-site.ps1` from the repo root → `aws s3 sync apps/omnify-site/dist s3://...` + CloudFront invalidation. No ECS, no Docker, no task-def.
- **Local dev:** from workspace dir: `npm install && npm run dev` (port 4321).

## Wall rules (CI-enforced, do not work around)

- **No imports from admin (`apps/omnify-admin/app/`).** Site code cannot read the Prisma client, Shopify SDK, encryption helpers, or anything else inside admin. Enforced by ESLint `no-restricted-imports` in admin's `.eslintrc.cjs` and by structural separation (Astro doesn't see admin from inside this workspace).
- **No banned dependencies.** `apps/omnify-site/package.json` MUST NOT list `@shopify/*`, `@prisma/client`, `prisma`, `@anthropic-ai/*`, `googleapis`, `@google/maps`, or any `@cpg-labs/shared-*` server-only package. Enforced by `scripts/omnify/check-site-deps.ts`, wired into admin's `typecheck`.
- **No backend logic.** Forms use `mailto:` links. If a future surface genuinely needs server I/O: (a) add an API endpoint to admin, POST via CORS, or (b) use a third-party form processor. Either requires explicit approval and a privacy-policy update.
- **No shared global CSS with admin.** `src/styles/global.css` is loaded by `BaseLayout.astro` only.

## Conventions

- **Pages:** `src/pages/<slug>.astro`. Pure-static pages should not need scripts; if interactivity is needed, prefer inline `<script>` over framework islands. No React in the site bundle.
- **Layout:** all pages render through `BaseLayout.astro`. Pages with their own chrome (`/`, `/screencast`) pass `bareLayout={true}`.
- **Styles:** scoped `<style>` blocks in each `.astro` file (auto-scoped by Astro). Reusable styles in `src/styles/<name>.css`.
- **Theme:** light/dark via `data-theme` attribute on `<html>`. Inline boot script in `BaseLayout.astro` reads `localStorage.theme` or `prefers-color-scheme` before paint.
- **Assets:** `public/` only. Don't reference assets in `apps/omnify-admin/public/`.
- **Content & copy:** plain language, no idioms, no em dashes, bilingual-friendly. Action labels: verb + noun. No claims that overpromise.
- **No tracking pixels / analytics scripts** without explicit approval + privacy-policy update.

## Out-of-scope for this app

- Polaris components and their conventions — admin only.
- Shopify Design Compliance rules — admin only (Polaris save bar, `<s-app-nav>`, `<s-page>`, BFS).
- Translation / i18n via `apps/omnify-admin/app/i18n/` — admin only. If this site goes multilingual, picks its own approach.

## Adding a new page

1. Create `src/pages/<slug>.astro`. Import `BaseLayout`, set `title` and `description` props.
2. Use scoped `<style>` for page-specific styling. Reference `var(--site-text)`, `var(--site-bg)`, `var(--site-text-secondary)`, `var(--site-border)`, `var(--site-surface)` for theme-aware colors.
3. Run `npm run dev` from this workspace to verify locally.
4. `npm run build` to confirm static output writes cleanly to `dist/`.
5. Deploy via `scripts/deploy-omnify-site.ps1`.
