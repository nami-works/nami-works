# Ideas backlog

Place to park feature concepts that aren't shipping right now but shouldn't get lost. When something here gets prioritized, it graduates out of this file and into `docs/project-brief.md` under "In progress" or "Planned / not yet started".

This file replaces what was conceptually planned for the **Extras** nav slot — a hub that never actually shipped as a real page. The `Extras` nav entry pointed at `/app` (the home), so clicking it just looped to home; meanwhile the routes below this section that were *meant* to live behind Extras existed in code but had no entry point in the UI.

---

## Decisions locked in (2026-05-07, nav-compliance audit)

These are pre-approved by the user. When the in-flight branches from other sessions land, a single chore branch should bundle:

1. **Drop the `Extras` nav entry.** Removes the line from `ALL_NAV_ITEMS` in [app/utils/app-identity.server.ts](../app/utils/app-identity.server.ts), drops the `extras` keys from `app/i18n/locales/{en,pt-BR}/common.json` and `app/i18n/locales/{en,pt-BR}/home.json`, and removes the dead `getHomeRoute()` export. Brings cpg-labs identity to 7 nav items, eliminating the "View more" overflow.
2. **Add `back-action` slot to all sub-pages.** ~11 routes: `app.brand-settings*`, `app.storytelling_.{brief,learnings,review}`, `app.merchandising.{collections,discounts,metaobjects,pricing}`, `app.merchandising.sale.{$id,quick-apply}`. Mechanical change per route.
3. **Move `brand-settings` to Settings as a new "Brand" tab** *(updated 2026-05-07; supersedes the earlier "move under Storytelling" plan)*. Reasoning: tone of voice + brand identity are cross-feature assets that future surfaces (Affiliates messaging, Local Delivery driver scripts, Retail email copy) will all want to read from. Storytelling consumes brand voice today but isn't the owner of it. Settings is the right home for cross-cutting config — same shape as Locations or Carriers being shared by multiple features. Concretely:
   - Add a "Brand" tab to `app.settings.tsx` (5th tab alongside Delivery details / Retail filters / Delivery providers / Carriers).
   - Move `app.brand-settings.tsx` → `app.settings_.brand.tsx` (or an inline tab section, depending on size). The whole `BrandAssets` + `BrandLearning` UI moves together — not just tone sources — so we don't end up with a split where tone sources is in Settings but the rest of the brand config is still reached from Storytelling.
   - Move `app.brand-settings_.tone-sources.tsx` → `app.settings_.brand.tone-sources.tsx` (sub-page under the Brand tab).
   - Update Storytelling deep-links (`s-link href="/app/brand-settings"`) to point at `/app/settings/brand`.
   - Settings gains `back-action` on each sub-tab (covered by decision #2).
   - Side benefit: closes the de-highlight bug that motivated the original "move under Storytelling" plan, since the parent (Settings) is in the nav.
   - Risk: Settings tab count goes 4 → 5. Still well under the no-wrap budget per CLAUDE.md tabs convention. Worth verifying mobile width.
4. **Fold Product Launches (`/app/goals`) into Campaigns.** Treat a product launch as a campaign with a 30-day window pinned to a product GID. The Campaigns engine (in progress per `docs/project-brief.md`) already covers time-bounded sales pushes with per-location targets and matchRule semantics — the productGid match variant is a near-zero-diff add. Once Campaigns ships, delete the `app.goals` route + drop the `GoalsConfig` and `GoalsRun` Prisma tables.
5. **Storytelling label: one word.** Update `nav.storytelling` in `app/i18n/locales/{en,pt-BR}/common.json` from `"Story-telling"` → `"Storytelling"`. Routes, i18n namespace, and internal references already use the unhyphenated form; the nav label was the only outlier.

**Held**: don't ship any of the above as a standalone PR right now; bundle into one chore branch after the in-flight session branches merge. Single sweep is easier to review and lower-risk for merge conflicts.

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
