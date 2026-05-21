# cpg-labs.io — Public Site

Static Astro project that serves the public-facing surface at `https://cpg-labs.io`. Built and hosted independently from the embedded Shopify admin app at `app.cpg-labs.io` and `omnify.cpg-labs.io`.

## Stack
- **Framework:** [Astro 5](https://astro.build) (static output, no SSR)
- **Hosting:** AWS S3 + CloudFront (planned — Phase 2)
- **Deploy:** `scripts/deploy.ps1 -App site` (planned — Phase 2)

## Local development
```bash
cd site
npm install
npm run dev
```
Astro dev server runs on `http://localhost:4321`.

## Build
```bash
npm run build      # writes static files to site/dist/
npm run preview    # serves the built site locally
```

## Wall rules (also in repo CLAUDE.md)
- No imports from `../app/` (admin code).
- No `@shopify/*` or `@prisma/client` dependencies — enforced by `scripts/check-site-deps.ts` in CI.
- No backend logic. Forms use `mailto:` links. Anything dynamic moves to admin (`api.cpg-labs.io` style endpoints) or third-party (Formspree etc.) and goes through approval.

## What lives here
- Marketing pages (`/`, `/about`, `/pricing`, `/contact`)
- Legal (`/privacy`, `/terms`, `/security`)
- Product walkthroughs (`/screencast`, `/preview`)
- Future: blog, status page, public docs
