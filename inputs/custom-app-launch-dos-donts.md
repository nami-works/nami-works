# Shopify Custom App Launch Playbook (Do's and Don'ts)

This guide captures what worked (and what broke) during the GE Beauty launch so future custom apps can be deployed faster and safer.

## 1) Pre-Launch Alignment

### Do
- Define the app URL strategy upfront: root (`/`) vs subpath (example: `/full`).
- Confirm final domain and DNS before touching Shopify Partner Dashboard URLs.
- Keep one clear source of truth for app naming (`shopify.app.<app>.toml`, Terraform vars, ECS service name).
- List required Shopify scopes early and validate them before production deploy.

### Don't
- Don't start deploy with placeholder domains (this caused IP resolution failures).
- Don't postpone scope review until after install; missing scopes will break features silently.
- Don't assume dev-store behavior matches production URL paths.

## 2) Terraform and Infrastructure

### Do
- Keep ECS task env/secrets conditional when SSM usage is optional (`create_ssm` true/false flows).
- Add a real health endpoint and point ALB health check to the app subpath (`/full/health`).
- Ensure target group matcher is explicit (`200`) for health checks.
- Validate Terraform before apply:
  - `terraform fmt -recursive`
  - `terraform validate`
  - `terraform plan`

### Don't
- Don't hard-reference SSM parameters when they are not created.
- Don't use root health path when app is mounted in subpath.
- Don't trust old ECS tasks after infra changes; always deploy a fresh image.

## 3) Docker, Build, and Base Path

### Do
- Pass `BASE_PATH` at image build time for subpath apps.
- Keep `Dockerfile` with explicit `ARG BASE_PATH` and `ENV BASE_PATH=${BASE_PATH}`.
- Normalize Vite base so it always has leading and trailing slashes (example: `/full/`).

### Don't
- Don't build without `BASE_PATH` for subpath deployments.
- Don't use base path without trailing slash; this can generate broken assets like `/fullassets/...`.

## 4) React Router and Embedded Navigation

### Do
- Keep `basename` always a string in router config.
- Use links that include `basePath` in UI navigation (`${basePath}/app/...`).
- Keep auth prefix stable (`/auth`) to avoid duplicated subpath segments.
- Use relative/normalized redirects that do not double-prepend basename.

### Don't
- Don't mix hardcoded `/app/...` links with subpath deployment.
- Don't prepend base path manually in places where router already handles basename.
- Don't keep catch-all routes that can create redirect loops unless fully validated.

## 5) Shopify Partner and App Config

### Do
- Set App URL and redirect URLs to the real deployed domain/subpath.
- Run `shopify app deploy` after config changes in TOML files.
- Reinstall/re-auth app when scope set changes.
- Keep `shopify.app.toml` and custom app TOML aligned with production target.

### Don't
- Don't leave old hostnames in Partner Dashboard (`omnify-custom...`) once production URL is different.
- Don't assume changing local files is enough without pushing config to Shopify.

## 6) Orders and GraphQL Query Rules

### Do
- Build query filters from normalized values expected by Shopify (`LOCAL`, not custom lowercase formats).
- Use pagination (`hasNextPage` + `endCursor`) for complete result sets.
- Default to rolling date window for performance and relevance (example: last 7 days).
- Add explicit fulfillment filter when business logic requires active deliveries only:
  - `fulfillment_status:unfulfilled`
- Add debug mode payloads (counts and drop reasons) to speed diagnosis.

### Don't
- Don't stop at first page (`first: 50`) when feature expects full coverage.
- Don't assume fulfillment orders exist for all fetched orders without validating query shape.
- Don't use over-broad queries in production pages without time bounds.

## 7) Google Maps Integration

### Do
- Validate both `GOOGLE_MAPS_API_KEY` and `GOOGLE_MAPS_MAP_ID`.
- Initialize map only after container exists in DOM (callback ref/state works well).
- Show user-friendly warning banners only for real failures.
- Guard async error handlers against stale/unmounted state to avoid false error banners.

### Don't
- Don't rely only on console errors; expose actionable UI warnings.
- Don't assume map failure is always key-related; asset path issues can block maps too.
- Don't show persistent "failed to load" banner if the map already rendered.

## 8) UI Layout and Styling Consistency

### Do
- Keep route-scoped CSS in `styles.module.css`.
- Define map canvas size in CSS (single source of truth) and reference via class.
- Validate production UI against dev store after each deploy (especially with base path changes).

### Don't
- Don't hardcode map dimensions inline in multiple places.
- Don't skip post-deploy visual checks; broken assets often look like "layout bugs".

## 9) Deployment Execution Pattern (Safe Sequence)

### Do
- Use an explicit build -> push -> force deploy sequence.
- Wait for ECS stabilization as a separate command if combined command chains are unstable in shell.
- Verify final image tag in ECS service/task definition after deploy.

### Don't
- Don't rely on "latest" semantics mentally; always confirm the running task revision/image.
- Don't combine long wait commands with other chained commands if terminal frequently crashes.

## 10) Verification Checklist (Production)

Before signing off, verify all items:
- App opens from Shopify Admin without 404, 410, or redirect loops.
- Network has no broken JS/CSS assets (especially under subpath).
- Health endpoint returns 200 at deployed path.
- Tabs/navigation routes work correctly under subpath.
- Orders load and match business rules (date window, location filter, fulfillment state).
- Map renders and no false "failed to load" banner appears.
- No critical throttling errors in main user flows.

## 11) Common Failure Patterns (Quick Triage)

- **503 at app URL**
  - Usually failing target group health check or stale task image.
- **404 from Shopify Admin open**
  - Usually wrong App URL/redirect URL, basename mismatch, or broken asset base.
- **`/full/full/...` paths**
  - Usually double-prefixing from redirect + basename.
- **Assets requested as `/fullassets/...`**
  - Usually Vite base missing trailing slash.
- **Orders loaded but wrong business subset**
  - Usually missing query filters/pagination/date window.
- **Map not visible but no clear error**
  - Usually container timing, asset loading, or map ID/key setup.

## 12) Default Standards for Next Custom App

Apply these defaults unless project-specific requirements say otherwise:
- Subpath-safe from day one (`BASE_PATH`, Vite base normalization, router basename).
- Health endpoint implemented before first deploy.
- Scope list explicitly reviewed and versioned.
- Orders/analytics queries paginated and date-bounded.
- Debug flags available for production-safe diagnostics.
- Deploy runbook kept as terminal-ready commands (no hidden steps in docs only).

