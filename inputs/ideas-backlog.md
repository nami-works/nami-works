# Ideas backlog

Place to park feature concepts that aren't shipping right now but shouldn't get lost. When something here gets prioritized, it graduates out of this file and into `docs/project-brief.md` under "In progress" or "Planned / not yet started".

This file replaces what was conceptually planned for the **Extras** nav slot — a hub that never actually shipped as a real page. The `Extras` nav entry pointed at `/app` (the home), so clicking it just looped to home; meanwhile the routes below this section that were *meant* to live behind Extras existed in code but had no entry point in the UI.

---

## Decisions locked in (2026-05-07, nav-compliance audit) — STATUS

**Decisions 1, 2, 3, 5 — SHIPPED 2026-05-09 in PR #26 (`7bb340c`).** Deployed as full rev 28 / omnify rev 50. See deploy-queue Deployed section for the post-deploy verification checklist. Concretely:
- Decision 1 (drop `Extras` nav entry + dead `getHomeRoute()` export + i18n `extras` keys) — done.
- Decision 2 (back-action slots on sub-pages) — done for the 5 sub-pages that have their own `<s-page>` (3 storytelling sub-pages + brand + tone-sources). The `app.merchandising.*` sub-pages don't have their own `<s-page>` — they render inside `app.merchandising.tsx`'s `<Outlet>`, which already owns the page header and back-action wiring, so no per-file change was needed for them.
- Decision 3 (move brand-settings → Settings sub-route at `/app/settings/brand` with a Brand tab in the Settings tab strip) — done.
- Decision 5 ("Story-telling" → "Storytelling") — done.

**Decision 4 — NOT YET SHIPPED.** Folding `/app/goals` into Campaigns still depends on the Campaigns engine landing first. Picks up after Campaigns goes live; track under "Product Launches" below.

---

## What was conceptually staged for "Extras"

Each of these is a route that exists in `app/routes/` today but is **not linked from anywhere in `<s-app-nav>`**. Evidence below is what's already on disk; the "idea" column is the original intent and a short note on what'd be needed to surface it.

### Product Launches — `app/routes/app.goals.tsx` → fold into Campaigns
- **Status:** working route, fully featured loader + action, has its own CSS module + i18n. No nav entry, no inbound link from any other page. Only reachable by typing `/app/goals` directly.
- **What it does:** tracks revenue + units for new product launches. Per-launch goals (Day 1 / Week 1 / Month 1), benchmarks against past launches, segment breakdowns (tag / location / channel), recent-orders + top-products tables. Persists to `GoalsConfig` + `GoalsRun` Prisma tables.
- **Decision (2026-05-07):** **fold into the in-progress Campaigns engine** (see `docs/project-brief.md` "In progress: Campaign goals"). A product launch is a campaign with a 30-day window pinned to a product GID; the existing matchRule schema already supports the productId variant. When Campaigns ships, the `app.goals` route + `GoalsConfig` + `GoalsRun` tables can be deleted.
- **Sequencing:** depends on Campaigns landing first. Don't ship the deletion until the productGid match-variant is verified on Campaigns and the launch use-case is confirmed working there.

### UI Elements — `app/routes/app.ui-elements.tsx`
- **Status:** the whole file is one line: `export { default } from "./app._index";` — it's an **alias for the home**. Originally it was a Polaris-component playground for development reference (the en/home.json key still describes it that way), but the playground was deleted and the route was repointed at the home loader.
- **Why it's hidden:** dead code by design. Pointless to surface.
- **Idea to graduate it:** rebuild it as a real Polaris-component playground. Useful for design-engineer iteration when wiring a new pattern. Low priority — the official Polaris docs cover this.
- **If we kill it instead:** delete the file. Zero impact (no routes link to it).

### Debug Delivery — `app/routes/app.debug-delivery.tsx`
- **Status:** working route, gated on `process.env.NODE_ENV !== "production"`.
- **What it does:** dumps the raw `deliveryProfiles` GraphQL response so we can inspect Shopify's delivery-profile structure when debugging Local Delivery integration issues. Used during initial Lalamove + carrier-service wiring.
- **Why it's hidden:** intentional — dev-only, never meant for merchants.
- **Idea:** keep as-is. Not a candidate for Extras. The fact that it's gated on `NODE_ENV` means it'd 404 in production anyway, which is correct.

### Retail Footprint legacy redirect — `app/routes/app.retail-footprint.tsx`
- **Status:** redirect-only (302 → `/app/footprint-expansion`). Per `CLAUDE.md`, the route was renamed during the Omnify reorg and the old URL is preserved as a redirect for backward compatibility.
- **Why it's hidden:** it's not a feature, just a URL forwarder.
- **Idea:** keep until external links to the old URL stop appearing in logs (probably forever — cheap to keep). Not a candidate for Extras.

---

## Other ideas (unrelated to Extras, but worth parking)

### Recent Activity feed on the home (deferred from v1)
- **Status:** designed but not shipped. Mockup at [`inputs/mockups/omnify-admin-home-v1.html`](mockups/omnify-admin-home-v1.html), section 4, shown faded with a "Deferred · v2 · needs EventLog table" pill.
- **What it'd do:** last 5 system events on the home (route dispatched, customer-sync completed, address fix needed, etc.).
- **What's needed:**
  - New `EventLog` Prisma table (shop, type, message, severity, createdAt, payload JSON).
  - Existing cron pipelines (`[local-delivery]`, `[retail-footprint:sync]`, `[affiliates:cron]`, etc. — see `CLAUDE.md` "Logging") dual-write structured rows alongside their stdout logging.
  - Loader reads top-5 by `createdAt DESC` for the shop.
  - Retention policy: 90 days vs 1 year — pick before shipping.

### Regression warning banner on the home (deferred from v1)
- **Status:** designed but not shipped. Mockup faded with a "Deferred · v2 · needs OnboardingState.dismissedAt" pill.
- **What it'd do:** thin `s-banner tone="warning"` re-appears on the home after the setup guide is complete, when a previously-finished step regresses (Lalamove credentials revoked, location config deleted). Click → deep-link to the offending setting.
- **What's needed:**
  - New `OnboardingState` Prisma row per shop with `dismissedAt` column (the home auto-hides the full guide when complete; persistence here would let us distinguish "first-run-not-yet-complete" from "post-dismissed-but-something-broke").
  - Loader-side severity ordering (one banner at a time).
  - Dismiss is session-scoped — banner re-appears next page-load if not yet fixed.

### Dynamic state-aware page subheading on the home
- **Status:** approved during design but never shipped. Both first-run and steady-state currently render the same static i18n string.
- **Idea:** server-side compute a `subheadingVariant` in the loader (e.g. `"steady-active"` → "Wednesday, May 6 · everything's running. Three routes already dispatched today." vs `"first-run"` → welcome copy). Add to `app/routes/app._index.tsx` loader.

### "Affiliates in nav" follow-up audit
- **Status:** Affiliates was promoted to `IDENTITY_NAV.omnify` on 2026-05-06 (5th nav item, under the BFS 7-cap). Confirm the placement is right via merchant feedback after a few weeks. Could potentially be folded under a future "Marketing" parent if more channels (Klaviyo, Meta, etc.) get added.

_Migrated to `inputs/backlog/local-delivery.md` on 2026-05-08:_
- _`deploy.ps1` pre-flight Docker health check → "Deployment ops" section_
- _Performance / reliability — LD loader → "Performance / reliability" section_
- _Disk monitor + Docker VHDX reclaim script (new proposal) → "Deployment ops" section_

---

## Maintenance

- When something graduates out of this file, delete the entry here and add it to `docs/project-brief.md` under "In progress" or "Planned / not yet started".
- When something gets killed, delete the entry and capture the reason in the route's removal commit message (so the decision is in `git log`, not floating in a doc).
- This file is for **product-shaped** ideas — not engineering chores (those live in the lint backlog) and not infra TODOs (those live in `docs/aws-topology.md`).
- **Per-area backlog migration (in progress, started 2026-05-08):** items that are clearly tied to one feature should move to `inputs/backlog/<feature>.md`. Today only `local-delivery.md` exists; future targets when the volume warrants splitting:
  - `inputs/backlog/affiliates.md` — for the "Affiliates in nav" follow-up + future affiliates ideas
  - `inputs/backlog/storytelling.md` — for any storytelling-specific backlog
  - `inputs/backlog/home.md` — for the Recent Activity feed, Regression banner, Dynamic state subheading items above
  When a new backlog file is created for an area, move that area's items out of this file and replace with a one-line pointer.
