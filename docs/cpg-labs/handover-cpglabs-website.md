# Session Handover — 2026-04-10 — cpg-labs.io homepage split + deploy

Supersedes the 2026-04-04 methodology doc that used to live here. The website is now live in production with two distinct brand homepages.

## What was done

### Code (committed as `87fc336`)
- **Host-aware dispatch on `_index`**. A new helper [app/utils/host.server.ts](../app/utils/host.server.ts) resolves a `SiteVariant` (`"cpglabs" | "omnify"`) from `x-forwarded-host` → `request.url` host, with `?variant=` query and `CPG_LABS_DEFAULT_VARIANT` env overrides for local testing. The `_index/route.tsx` loader runs the Shopify `?shop=` redirect first (so OAuth handoff never breaks on any host), then calls `resolveSiteVariant` and returns `{ variant }`. The default export is a thin dispatcher rendering `<CpgLabsHome />` or `<OmnifyHome />`. `meta` export branches on `data.variant` so each host gets its own `<title>`/description.
- **OmnifyHome extracted verbatim** into [app/routes/_index/omnify-home.tsx](../app/routes/_index/omnify-home.tsx). Zero behavior change — same hero, pillars, GBP health check, waitlist form (now submits `intent=waitlist` explicitly), built-with, final CTA. Still uses `SiteNav`/`SiteFooter`.
- **New CpgLabsHome skeleton** at [app/routes/_index/cpglabs-home.tsx](../app/routes/_index/cpglabs-home.tsx) + [app/routes/_index/cpglabs-home.module.css](../app/routes/_index/cpglabs-home.module.css). Six sections (Hero → How it works → Why → Social proof → FAQ → Final CTA), all placeholder copy marked with `{/* PLACEHOLDER */}` comments. Mobile-first, reuses `--site-holo-gradient`, `--site-bg`, `--site-text`, `--site-border`, `--site-font` from [app/styles/site-theme.css](../app/styles/site-theme.css). No new root tokens.
- **New CpgLabsNav + CpgLabsFooter** at [app/components/cpglabs-layout/index.tsx](../app/components/cpglabs-layout/index.tsx). Holo-gradient "CPG Labs" text wordmark (no image logo), anchor-based nav (`#how-it-works`, `#why`, `#faq`, `#contact`), reuses `ThemeToggle` imported from `site-layout`. Footer cross-links to `https://omnify.cpg-labs.io/{privacy,terms,security}` via absolute `<a>` (not `<Link>`) so the browser hard-navigates cross-host.
- **Host guard in `_site.tsx`**. Parent loader at [app/routes/_site.tsx](../app/routes/_site.tsx) throws `redirect("https://omnify.cpg-labs.io{path}{search}", 301)` when variant is `"cpglabs"` in production. Dev mode (`NODE_ENV !== "production"`) returns `null` so `/pricing`, `/about`, etc. can be previewed locally on any host. The loader runs for all `_site.*` children automatically.
- **`privacy.tsx` renamed** to [app/routes/_site.privacy.tsx](../app/routes/_site.privacy.tsx) with the styles folder moved to [app/routes/_site.privacy/](../app/routes/_site.privacy/). Manual `<SiteNav />` / `<SiteFooter />` imports removed — inherits the parent layout and host guard.
- **Lead form wiring**. The `_index` action now branches on a hidden `intent` field: `"lead"` writes to `waitlistSubscriber` with `source: "cpglabs-home"`; default/`"waitlist"` keeps `source: "gbp-health-check"`. No Prisma migration needed.

### Deploy
- Built + pushed image `477780048372.dkr.ecr.us-east-1.amazonaws.com/omnify-app:v-site-split-1` via [scripts/deploy-omnify.ps1](../scripts/deploy-omnify.ps1).
- Registered and rolled out task definition `omnify-task:22` (rolloutState `COMPLETED`, 1 running task at `172.31.73.138`).
- `omnify-service` is the single service that serves all three hosts (`cpg-labs.io`, `www.cpg-labs.io`, `omnify.cpg-labs.io`) behind the existing ALB rules in [infra/terraform/alb.tf](../infra/terraform/alb.tf) — **no infrastructure changes were needed**.

### Infrastructure cleanup (not in git)
Two stale ALB targets deregistered from `omnify-tg` during this session:
- **`172.31.71.9`** — zombie from a task orphaned around 2026-04-07. Caused `/pricing`, `/terms`, and other `_site.*` routes to 50/50 flap between 200 and 404 because the zombie predated commit `fb06e7a` (when marketing pages were added). Deregistered before first smoke test could declare success.
- **`172.31.63.42`** — zombie from the task replaced by *this* deploy. ECS stopped the old task but failed to deregister its target. The user saw correct HTML from the new task but unstyled rendering because CSS asset requests round-robined to the zombie, which served a stripped-down Shopify template bundle with different asset hashes — every `/assets/*.css` and `/cpg-labs_box.png` request had a 50% chance of hitting 404. Deregistered after user screenshots surfaced the issue.
- After both cleanups, target group stable at a single healthy target, 8/8 curls deterministic, all assets 200.

## Key decisions

- **Single container, host-aware dispatch over a separate ECS service.** The ALB already routes `cpg-labs.io` and `omnify.cpg-labs.io` to the same target group, the marketing site has zero Shopify auth coupling, and the split was a pure application-level concern. A second ECS service would have doubled cost and deploy complexity for no isolation benefit.
- **`x-forwarded-host` preferred over `request.url` host.** `@react-router/express` reconstructs `request.url` from `req.hostname` which derives from the `Host` header. AWS ALB preserves the original `Host` today, but any future infra change (CloudFront in front, `trust proxy` flip, Cloudflare tunnel) could invert it. `x-forwarded-host` is the AWS-blessed header and is future-proof. Helper checks it first.
- **Dev redirect escape.** Without the `NODE_ENV !== "production"` guard, testing any `_site.*` route with `?variant=cpglabs` locally would bounce to production. The escape lets both hosts render on localhost.
- **Form + Calendly side-by-side for Final CTA, not mailto-only.** High-ticket custom software engagements are a long sales cycle. Mailto loses hot leads; form alone loses "ready now" prospects; form + Calendly captures both cohorts.
- **New `CpgLabsNav` component over a variant prop on `SiteNav`.** CPG Labs (parent brand) and Omnify (product) are distinct conversion surfaces that will evolve independently. Coupling them in one component now would mean untangling them later.
- **Lead form reuses `waitlistSubscriber` table, not a new `leadInquiry` model.** Zero-migration path. `source` column is the discriminator (`"cpglabs-home"` vs `"gbp-health-check"`). If the brand team needs richer lead fields (company, budget, timeline), that's the right time to normalize.
- **`privacy.tsx` rename included in the same commit.** Small pure-refactor win — the old standalone file was inconsistent with `_site.terms.tsx` / `_site.security.tsx`, and nesting it under `_site` gave it the host guard for free.

## What's pending

### CpgLabs homepage — placeholder content that needs real copy
- **Hero** — headline "You're overpaying for apps you don't need", sub "CPG Labs builds custom Shopify software tailored to your brand — not another subscription". Works as a directional draft but not finalized.
- **How it works** — four steps (Discovery → Scoping → Build → Deploy), each with one-line placeholder copy.
- **Why CPG Labs** — three cards (Own your stack / No subscription tax / CPG-native engineers) with placeholder body copy.
- **Social proof** — 6 empty logo slots with dashed borders, pull-quote reading "PLACEHOLDER — A real customer quote will live here once we have one we love." Needs real logos (starting with GE Beauty as the first case study) and a real quote.
- **FAQ** — 4 `<details>` items with `PLACEHOLDER —` prefixed answers.
- **Final CTA** — `CALENDLY_URL` constant at top of `cpglabs-home.tsx` points to `https://calendly.com/cpg-labs/fit-call` which does not exist yet. The on-page form is fully wired and will write to `waitlistSubscriber` on submit.

### Infrastructure
- **IAM trust fix** for `AWSServiceRoleForECS`. ECS event history shows a trust-relationship error from 2026-03-18 that is almost certainly the root cause of both zombie targets this session. Until this is fixed, every omnify-service deploy will leak a stale target and the site will half-work for whoever deploys next. Flagged but **not touched** — IAM changes are the kind of action that needs explicit user approval. See `Context the next session needs` below for the specific thing to check.
- **Analytics / pixel instrumentation** on the new homepage (GA4, Meta pixel, LinkedIn insight tag). Not wired.
- **Sitemap** — no `robots.txt` / `sitemap.xml` split between the two hosts. Google will index both without guidance.

### Growth strategy (user's stated next step)
User asked how to brief a growth agent on the site so far. Recommended flow in that turn: point `/growth-hacker` at `https://cpg-labs.io`, `https://omnify.cpg-labs.io`, `docs/project-brief.md`, `app/routes/_index/cpglabs-home.tsx`, and this handover doc. Not started.

## Modified files

All website changes landed in commit `87fc336` (clean, self-contained).

### Complete
- [app/utils/host.server.ts](../app/utils/host.server.ts) — NEW, host resolver
- [app/routes/_index/route.tsx](../app/routes/_index/route.tsx) — dispatcher + variant meta + lead intent action
- [app/routes/_index/omnify-home.tsx](../app/routes/_index/omnify-home.tsx) — NEW, extracted from route.tsx
- [app/routes/_index/cpglabs-home.tsx](../app/routes/_index/cpglabs-home.tsx) — NEW, skeleton
- [app/routes/_index/cpglabs-home.module.css](../app/routes/_index/cpglabs-home.module.css) — NEW
- [app/components/cpglabs-layout/index.tsx](../app/components/cpglabs-layout/index.tsx) — NEW, CpgLabsNav + CpgLabsFooter
- [app/components/cpglabs-layout/styles.module.css](../app/components/cpglabs-layout/styles.module.css) — NEW
- [app/routes/_site.tsx](../app/routes/_site.tsx) — added host-guard loader
- [app/routes/_site.privacy.tsx](../app/routes/_site.privacy.tsx) — renamed from `privacy.tsx`, dropped manual nav imports
- [app/routes/_site.privacy/styles.module.css](../app/routes/_site.privacy/styles.module.css) — moved from `privacy/`

### Not touched
- `infra/terraform/alb.tf` — ALB rules already handle all three hosts
- `scripts/deploy-omnify.ps1`, `shopify.app.*.toml` — no deploy/config changes
- `react-router.config.ts`, `vite.config.ts`, `Dockerfile` — no build config changes

## Current state

### Production URLs (verified live)
- `https://cpg-labs.io` → ALB 301 → `https://www.cpg-labs.io/` → CpgLabs skeleton, `<title>CPG Labs | Custom Shopify software for CPG brands</title>`
- `https://www.cpg-labs.io/pricing` → app 301 → `https://omnify.cpg-labs.io/pricing` (host guard in `_site.tsx`)
- `https://omnify.cpg-labs.io/` → Omnify homepage, `<title>Omnify | Local delivery and retail expansion for Shopify</title>`
- `https://omnify.cpg-labs.io/{pricing,about,contact,terms,security,privacy}` → all 200, all unchanged content
- `https://omnify.cpg-labs.io/app/local-delivery` → embedded Shopify app unchanged

### How to verify in browser
Open `https://www.cpg-labs.io/` on desktop and mobile. Expect:
- Holo-gradient "CPG Labs" wordmark top-left (fixed nav, anchor links: How it works / Why CPG Labs / FAQ / Contact on desktop)
- Hero eyebrow "BUILD-TO-SUIT SOFTWARE FOR CPG BRANDS", headline "You're overpaying for apps you don't need.", two pill CTAs, stacked app-bloat card with `$29/mo` → `$174/mo` rows
- Four-step How It Works cards (Discovery → Scoping → Build → Deploy)
- Three Why CPG Labs cards on a subtle surface background
- Logo grid placeholder + pull-quote
- FAQ with `+`/`−` `<details>` toggles
- Final CTA split: Calendly button (left) + form (right)

If anything flaps, re-check `omnify-tg` target group health (`aws elbv2 describe-target-health --target-group-arn arn:aws:elasticloadbalancing:us-east-1:477780048372:targetgroup/omnify-tg/5960ead268e4864c --region us-east-1`). More than one IP = another zombie, same pattern as this session, same fix (`aws elbv2 deregister-targets ...`).

### Lead form end-to-end
Submitting the CpgLabs contact form POSTs to the `_index` action with `intent=lead`, writes the email into `waitlistSubscriber` with `source: "cpglabs-home"`. Verify with `SELECT * FROM "WaitlistSubscriber" WHERE source = 'cpglabs-home'` on the prod Postgres.

## Recommended next steps

In priority order:

1. **Hard refresh on mobile Safari** to clear cached unstyled HTML from the zombie window. iOS Safari is sticky about the first-load CSS, and the user hit the site mid-flap.
2. **Run `/growth-hacker`** to build the acquisition strategy the user asked about. Brief it with the live URLs, `cpglabs-home.tsx`, `docs/project-brief.md`, and this handover. Skeleton copy is the intentional input — the growth agent's first deliverable should include a real hero/CTA/FAQ copy set and a channel plan.
3. **Fix IAM trust on `AWSServiceRoleForECS`**. Verify the trust policy includes `ecs.amazonaws.com` and that the service-linked role exists. If missing, recreate via `aws iam create-service-linked-role --aws-service-name ecs.amazonaws.com`. This is the only way to stop the zombie target pattern from recurring on every omnify-service deploy.
4. **Replace placeholder Calendly URL** (`CALENDLY_URL` constant at the top of [cpglabs-home.tsx](../app/routes/_index/cpglabs-home.tsx)) with the real 20-min fit-call event once created.
5. **Real copy pass** — headline, How it works, Why, FAQ, final CTA. Everything is marked `{/* PLACEHOLDER */}` in JSX so a grep will find them.
6. **Case study / social proof** — at minimum GE Beauty. Real logos + one real pull quote replaces the placeholder grid.
7. **Analytics** — GA4 + Meta pixel on cpg-labs.io only (keep Omnify clean for now). Hook points: hero CTA click, Calendly click, form submission.
8. **`robots.txt` / `sitemap.xml`** per host. Right now Google has no guidance that `cpg-labs.io` and `omnify.cpg-labs.io` are separate properties.

## Context the next session needs

### Unrelated uncommitted work in the tree
When this session started there were unrelated modifications (affiliates, merchandising sale, CLAUDE.md backlog-mode removal, deleted screenshots). I staged selectively so my commit `87fc336` is clean, but those uncommitted changes are **still in the working tree**:

```
 M CLAUDE.md                                           (backlog mode removed)
 M app/affiliates/analytics-queries.server.ts          (~720 line delta)
 M app/affiliates/sync.server.ts
 M app/i18n/locales/{en,pt-BR}/affiliates.json
 M app/routes/app.affiliates.tsx                       (~2100 line delta)
 M app/routes/app.affiliates/styles.module.css
 M prisma/schema.prisma
 M inputs/log.md
 D inputs/screenshots/*.png,gif,mp4                    (deletions)
```

These are a different session's in-progress work. **Do not commit them as part of website work.** They'll still be there when you resume.

### Commits between my deploy and HEAD
After my `87fc336` landed, six unrelated commits followed:
- `41631c7` Storytelling Phase 1
- `284bbec` Fix Merchandising Sale tab wiring
- `4ffa678` Storytelling Phase 2
- `b2c0da4` Storytelling Phase 3
- `f3a87f5` Storytelling Phase 4
- `9482ef7` Storytelling Phase 5

**None of these redeployed omnify-service**, so production is still running `omnify-task:22` with the image from my session. If the next session deploys omnify-service for any reason, it will pick up the intervening code changes in the same build — that's fine, the Storytelling work is under `app/routes/app.storytelling*` which is completely disjoint from the marketing site.

### Zombie target pattern (will recur)
This session hit the same ALB-target-deregistration failure twice in one deploy cycle. Root cause is the IAM trust issue on 2026-03-18 that was never addressed. Until fixed, **every omnify-service deploy will likely leak a stale target**. The symptom is non-deterministic 50/50 flapping between 200/404 on requests, or correct HTML with 404'd CSS/image asset requests. The fix is always: `aws elbv2 describe-target-health` → find the extra IP → `aws elbv2 deregister-targets`. This is important to check **before** declaring any omnify-service deploy successful.

### ALB health check quirk
The ALB health check hits each target's private IP at `/` with no `x-forwarded-host` and `Host: <ip>`. `resolveSiteVariant` returns `"omnify"` in this case, so `OmnifyHome` renders and returns 200. **If the default variant is ever flipped to `"cpglabs"`, re-verify the health check still returns 200 promptly** — `CpgLabsHome` has heavier DOM and more CSS modules to hydrate.

### `shopify.app.cpg-labs.toml` does not exist
The original brief (and memory entries) reference this file. The repo actually has `shopify.app.toml` (default, used for the CPG Labs identity), plus `shopify.app.omnify.toml`, `shopify.app.storefront.toml`, `shopify.app.storytelling.toml`. No Shopify config changes are needed for website work; just flagging for accuracy.

### Cross-origin redirect behavior
When a user is on `cpg-labs.io` and the `_site.tsx` loader throws a cross-origin redirect to `omnify.cpg-labs.io`, React Router client navigation treats it as a hard browser navigation (full page load). This is the **intended** behavior — the two hosts are distinct brand contexts. Do not try to make this a client-side transition.

### Shared theme localStorage key
`ThemeToggle` uses a single `localStorage["theme"]` key across both brands. A user who picks dark mode on `www.cpg-labs.io` keeps it on `omnify.cpg-labs.io`. This is intentional for now — if the brand team later wants separate themes per brand, namespace the key (`theme:cpglabs` vs `theme:omnify`).

### The Omnify marketing site files were already committed in HEAD
At session start, `git log -1 -- app/routes/_index/route.tsx app/routes/_site.tsx app/routes/privacy.tsx` showed them committed in `b1c5618 Sync full CPG Labs codebase to GitHub`. The original brief claimed they were uncommitted — that was wrong. My commit was purely a net-new layer on top. Saves future time if this comes up again.

### Memory updated
The `project_cpglabs_website.md` entry has been updated to reflect current state (deployed, split, skeleton live). See [memory file](../../.claude/projects/c--Users-Lucas-Guimar-es-Desktop-cpg-labs/memory/project_cpglabs_website.md).
