# NAMI Works Site

Public marketing site for NAMI Works, at `https://nami.works`. Pure-static Astro app, Portuguese only (v1).

## Stack

- Astro 5, static output.
- No backend, no database, no server runtime.
- Lead capture on `/diagnostico` posts to a third-party form service (Formspree placeholder, see the `TODO(lucas)` comment in `src/pages/diagnostico.astro`).

## Dev commands

```bash
npm install
npm run dev       # http://localhost:4321
npm run check     # astro check (TS + template validation)
npm run build     # static output -> dist/
npm run preview   # serve the built dist/ locally
```

## Deploy status

**Not deployed yet.** No AWS infrastructure (S3 bucket, CloudFront distribution, ACM cert for `nami.works`) has been provisioned. `scripts/deploy-nami-site.ps1` at the repo root is ready but will fail at the S3 sync step until the bucket exists.

## Pages (v1)

- `/` — home
- `/metodo` — methodology + anonymized case proof
- `/diagnostico` — primary conversion page, lead-capture form
- `/implantacao` — implementation tier (CTA back to Diagnóstico)
- `/operacao` — managed-operations tier (CTA back to Diagnóstico)
- `/sobre` — about
- `/contato` — fallback contact (mailto)
- `/privacidade`, `/termos` — legal drafts, pending real legal review
- `/404`
