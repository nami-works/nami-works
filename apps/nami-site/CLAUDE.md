# NAMI Site — Per-App Rules

Public marketing site at `https://nami.works` (not yet deployed). Pure-static, no backend, no shared runtime with any other app in this monorepo.

For cross-cutting monorepo rules, see the root [/CLAUDE.md](../../CLAUDE.md).

## Scope

- **Today:** the full v1 marketing site: home, método, diagnóstico (lead capture), implantação, operação, sobre, contato, legal drafts, 404. Portuguese only.
- **Future:** English toggle, blog, status page. Not built yet, don't scaffold ahead of need.
- **NOT in scope:** anything requiring a database, a server session, or merchant-only content.

## Stack & hosting

- **Framework:** Astro 5, static output (`output: "static"` in `astro.config.mjs`).
- **Hosting:** none provisioned yet. Target is AWS S3 + CloudFront, same pattern as `apps/omnify-site`, once `nami.works` DNS + ACM cert exist.
- **Deploy:** `scripts/deploy-nami-site.ps1` from the repo root. Ready but unused until the bucket and distribution exist — running it today fails at the S3 sync step.
- **Local dev:** from this workspace: `npm install && npm run dev` (port 4321).

## Wall rules (do not work around)

- **No imports from any other app in this monorepo.** Especially not `gebeauty/**` (tenant operations data) or `apps/omnify-admin` (a different product, different customer, different framework). This site is NAMI Works' own public presence, not a GE Beauty or Omnify surface.
- **No backend logic.** The only server-side interaction is the Diagnóstico lead-capture form, which posts to a third-party form service (Formspree placeholder today) via a plain HTML `<form>`. No API routes, no database, no session handling.
- **Confidentiality on the reference client.** NAMI's real production deployment is a beauty DTC brand that must stay anonymous in all copy: never name it, never describe it precisely enough to identify it, never use a real number that could be reverse-engineered to it. Use only vague magnitude language ("uma marca de e-commerce de 8 dígitos"). No logos, no screenshots of anyone's real store.
- **No shared global CSS with any other app.** `src/styles/global.css` is loaded by `BaseLayout.astro` only.

## Conventions

- **Pages:** `src/pages/<slug>.astro`, in Portuguese. Pure-static; if interactivity is needed, prefer inline `<script>` over framework islands. No React/Vue/Svelte in the bundle.
- **Layout:** all pages render through `BaseLayout.astro`. `bareLayout={true}` is available for a page that wants to paint its own chrome, but nothing uses it yet.
- **Styles:** scoped `<style>` blocks per `.astro` file (auto-scoped by Astro). Shared page-shell rules (container, section, card, CTA buttons) live in `src/styles/marketing.css`; legal-page rules live in `src/styles/legal.css`.
- **Theme:** light/dark via `data-theme` on `<html>`. Inline boot script in `BaseLayout.astro` reads `localStorage.theme` or `prefers-color-scheme` before paint. Reference `var(--site-text)`, `var(--site-bg)`, `var(--site-text-secondary)`, `var(--site-border)`, `var(--site-surface)`, `var(--site-accent)` for theme-aware colors.
- **Voice:** plural ("nós"/"a gente"), never a named individual. Plain, idiomatic Portuguese; no calques from English. No em dashes. No superlatives, no "AI consultant" hype language. Precise and specific reads as more credible than impressive-sounding.
- **Pricing:** no committed R$ figures in copy. Use "orçamento fechado, definido após o intake" framing until Lucas sets real pricing.
- **Assets:** `public/` only, if any get added. Favicon is an inline SVG data URI in `BaseLayout.astro`, not a binary file.
- **No tracking pixels / analytics scripts** without explicit approval.

## Adding a new page

1. Create `src/pages/<slug>.astro`. Import `BaseLayout`, set `title` and `description` props, in Portuguese.
2. Import `../styles/marketing.css` for the shared container/section/card classes, add a page-specific scoped `<style>` block for anything unique.
3. Run `npm run dev` from this workspace to verify locally.
4. `npm run check` then `npm run build` to confirm the static output writes cleanly to `dist/`.
5. Deploy via `scripts/deploy-nami-site.ps1`, once AWS infra exists.
