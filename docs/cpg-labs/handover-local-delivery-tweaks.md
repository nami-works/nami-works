# Session Handover — 2026-05-02 (Local Delivery v2 tweaks)

## What was done

**Local Delivery refactor — six sections, two deploys (rev 6 `b8a1865` + `21e8c0a` hotfix, then rev 7 `d814d28`):**
- **Section A — Fulfillment details merged into Route Manager.** Start date / Delivery promise / Same-day cutoff filter controls removed; D-90 hardwired server-side; per-location `deliveryPromiseDays` + `orderCutoffTime` now drive the bucket math via `LalamoveLocationConfig`. `fulfillmentDetailsSection` variable + `isRouteManagerVisible` state deleted.
- **Section B — Order states.** New shared `app/routes/app.local-delivery/due-bucket.ts` with five states: `failed | overdue | today | tomorrow | later`. Today emoji 📦 → ⏳, plus 🚫 Failed and 🚨 Overdue. Map markers (3 sites), `renderDueBadge`, and legend now use `dueBucketEmoji` helper. en + pt-BR i18n updated; "Due" prefix dropped.
- **Section C — Auto-assign cron skip.** `api.cron.auto-delivery.tsx` skips orders tagged `ld_failed-delivery` (and legacy `Failed delivery`) with structured log.
- **Section D — Bulk Route Manager actions.** Two new menu entries: Fetch quotes for all routes (`<s-icon type="receipt-dollar">`) and Dispatch all routes (`<s-icon type="bolt">`). Sequential client-side `fetch()` loop calls existing `lalamove-quote` + `lalamove-place-order` intents per route. `bulkOpStatus` drives a progress bar reusing optimize-progress styling.
- **Section E — All orders table density.** Tabs → grayscale chip filters with new **Failed** chip. Column padding halved. Customer column locked to 15ch (expanded) / 10ch (collapsed). Date drops "at": `Apr 28, 14:30`. Route badge: `Route 02` expanded, `#02` collapsed. Action column gone, **Unassign** button merged into Route cell. Due + Route columns center-aligned.
- **Section F — Settings restructure.** Market/City row → 3-col with Timezone (was 4-col with empty cells). Divider above Enable automatic delivery removed. Delivery promise + Order cutoff become peer settings; toggle moved below them. Section terminator divider relocated below the chevron and outside the collapsed conditional, applied to both Delivery details and Retail goals.
- **Settings deep-link.** New "Settings" menu item in Route Manager (`<s-icon type="settings">`) routes to `/app/settings?locationId=<current>`. Settings page reads `?locationId` on mount and pre-selects the matching location.
- **Auto-assign icon** swapped `transfer` → `automation` per Polaris semantic alignment.
- **Route cards** padding-top 24px → 8px (1/3); header bleed and inner padding tightened to match.

**New non-server module:** `app/services/lalamove-tags.ts` exports `FAILED_DELIVERY_TAG`, `LD_FAILED_DELIVERY_TAG`, `getFailedDeliveryTag()`, `getAllFailedDeliveryTags()`. Created to fix a build break: `lalamove-sync.server.ts` is server-only and Vite rejects its import from client code. The new module is client-safe.

**CLAUDE.md additions (committed `b63cd71`):**
- **Mockup-first** is mandatory; iterate to a `vN-final` clean version; open questions live in CLI via AskUserQuestion, never in mockup HTML.
- **Native Polaris web components are the default**; `<s-icon type="...">` replaces hand-rolled SVG paths. Browse [shopify.dev/docs/api/app-home/web-components](https://shopify.dev/docs/api/app-home/web-components).
- **Shell compatibility — Windows PowerShell 5.1.** Don't use `&&` / `||` chains; use `;` or `; if ($?) { ... }`. Bash tool still accepts `&&`.
- **Parallel-sessions capacity:** 2 coding sessions max in separate worktrees; unlimited mockup sessions on `mockup/<feature>` branches; unlimited read-only sessions; untracked files block deploys.

**Markdown lessons doc** at [inputs/markdown-lessons.md](inputs/markdown-lessons.md) — before/after of the user's original spec + 8 lessons + cheat sheet. User asked for this mid-session to learn how to write specs Claude can parse.

**Final mockup** at [inputs/mockups/local-delivery-tweaks-v2-final.html](inputs/mockups/local-delivery-tweaks-v2-final.html) — production-state reference (v1 with iteration history kept for archaeology).

## Key decisions

- **`ld_failed-delivery` is the operator-namespaced failed tag**, not the existing `"Failed delivery"` (which is the lalamove-sync state-machine tag). Both are now treated as "failed" for routing purposes via `getAllFailedDeliveryTags()`. Webhook auto-tagging behavior unchanged.
- **Bulk Dispatch chains quote → place-order per route via raw `fetch()`** rather than `useFetcher`, because `useFetcher` can't track N concurrent requests. Trade-off: per-route loading UI doesn't surface mid-loop, only the bulk progress bar does. User confirmed acceptable.
- **`<s-icon>` is the new icon convention** (zero usage in repo before this work). Hand-rolled SVGs and `tab-icons.tsx` are not bulk-rewritten — they migrate opportunistically when files are touched.
- **Settings URL deep-link is one-shot.** `?locationId=` is consumed only on Settings mount; doesn't sync if the dropdown changes after.
- **Pre-commit lint gate bypassed twice** during this session (user-authorized) for the same 119 pre-existing errors in `app.local-delivery.tsx` / `app.settings.tsx` / `api.cron.auto-delivery.tsx`. The harness denied a third self-modification of `.claude/settings.json`, so the user ran the final commits in their own terminal. Lint debt in those files is unchanged.

## What's pending

- **Marketing-split Phase 1 (`54cb3cf`)** still sits on `feat/marketing-admin-split` — NOT pushed to `origin/main`. The other session needs to either merge or delete. Until they decide, that branch and main are decoupled.
- **Marketing-split Phase 2 WIP** (`infra/terraform/site.tf`, `scripts/deploy-site.ps1`, `site/src/pages/404.astro`) sits untracked in the working tree. Stashed by my deploy guard once today; will trip future deploys until owned by a session.
- **Manual smoke owed on rev 7** (deploy queue captures the checklist): Failed chip filtering against an `ld_failed-delivery`-tagged order, Due → Route column order with Unassign in the Route cell, Settings deep-link preselect, route card density.
- **Lint backlog auto-cleanup** runs Mondays 9am BRT (per session-start hook). My session didn't touch the backlog.
- **Mobile parity** for the new 5-bucket states is not implemented (`app.local-delivery-mobile.tsx` doesn't currently compute due-buckets; helper is extracted and ready to wire up if mobile cards adopt state badges).

## Modified files

**Complete (deployed in rev 6 + 7):**
- `app/routes/app.local-delivery.tsx` — section A/B/D/E
- `app/routes/app.local-delivery/styles.module.css` — table grid, chip filters, route+unassign cell, route card density
- `app/routes/app.local-delivery/due-bucket.ts` (new) — 5-state helper
- `app/routes/app.settings.tsx` — section F + URL deep-link
- `app/routes/app.settings/styles.module.css` — section F
- `app/routes/api.cron.auto-delivery.tsx` — section C
- `app/services/lalamove-tags.ts` (new) — client-safe constants
- `app/services/lalamove-sync.server.ts` — re-exports getter; constants now imported from `lalamove-tags.ts`
- `app/i18n/locales/en/local-delivery.json` + `pt-BR/local-delivery.json` — legend labels, chip filter "Failed", Settings menu label, route compact format
- `inputs/markdown-lessons.md` (new) — spec-writing guide
- `inputs/mockups/local-delivery-tweaks-v1.html` + `local-delivery-tweaks-v2-final.html` (new) — design references
- `CLAUDE.md` — mockup-first, Polaris web components, PowerShell, parallel-sessions

**No scaffolding to clean up.** Mockups committed deliberately as the design archaeology trail.

## Current state

- **rev 7 LIVE on `app.cpg-labs.io`** (verified via `aws ecs describe-services` — running 1/1, single PRIMARY deployment).
- **`origin/main` HEAD: `b63cd71`** (CLAUDE.md parallel-sessions rules) — this is one commit ahead of rev 7's `d814d28`. Not yet deployed because docs-only.
- **Working tree:** on `mockup/tone-sources-ux-polish` (where I landed mid-session due to shared-working-tree drift). Untracked: 4 marketing-split Phase 2 files + a couple of mockups + `.knowledge/email/` PDFs + `inputs/comms/` + `inputs/ideas-backlog.md` from other sessions.
- **Deploy queue:** rev 7 entry added to Deployed; Marketing-split Phase 1 still in Pending (NOT mine).

## Recommended next steps

1. **Manual smoke test rev 7** on the live admin (Failed chip + Due/Route column order + Settings deep-link + route card density). 5 minutes.
2. **Resolve marketing-split Phase 1 (`54cb3cf`).** The other session's branch is unmerged. Either coordinate with that session or merge it as a follow-up so origin/main stops drifting from local main.
3. **Decide on Phase 2 WIP files.** Untracked `infra/terraform/site.tf`, `scripts/deploy-site.ps1`, `site/src/pages/404.astro`. Owner-session should commit-or-discard.
4. **Optional:** mobile parity for 5-bucket states (`app.local-delivery-mobile.tsx`). Helper is ready; mobile cards just need the badge wiring.
5. **Optional:** retire the legacy `"Failed delivery"` tag once enough time has passed that no orders carrying it are still in the active operational window (lalamove-sync still writes it on webhook failures).

## Context the next session needs

- **`<s-icon>` is the new convention** but `tab-icons.tsx` and inline SVGs predate the rule and are NOT bulk-rewritten. Migrate opportunistically when touching a file. Polaris icon names live at [shopify.dev/docs/api/app-home/web-components/media-and-visuals/icon](https://shopify.dev/docs/api/app-home/web-components/media-and-visuals/icon).
- **Pre-commit lint gate** lints whole files, not just diffs. Touching `app.local-delivery.tsx` / `app.settings.tsx` / `api.cron.auto-delivery.tsx` will fail with 119 pre-existing errors. Either fix as you go or get user-authorized bypass via `.claude/settings.json` (gitignored). The harness limits self-modification — second bypass usually requires the user to commit in their own terminal.
- **`Assert-CleanWorkingTree` deploy guard** is unforgiving — any untracked file blocks the deploy. Stash + restore around `scripts/deploy.ps1` is the workflow when other sessions left WIP.
- **Shared working tree across sessions** caused two `git checkout` collisions today — my v2 branch ended up entangled with `feat/marketing-admin-split` and `mockup/tone-sources-ux-polish`. Use `git worktree add ../cpg-labs-<slug> <branch>` for any parallel coding session per the new CLAUDE.md rule.
- **Bulk Dispatch flow** uses raw `fetch()` to chain quote → place-order per route. The 24-hour idempotency check inside `lalamove-place-order` action handler prevents double-dispatch; client-side dedup intentionally not added.
- **`computeDueBuckets` API changed** from `failedDeliveryTag: string` → `failedDeliveryTags: ReadonlyArray<string>` to support both the operator and legacy state-machine tags. Future callers (e.g. mobile) should use `getAllFailedDeliveryTags()`.
- **Local PowerShell terminal** doesn't support `&&` chains — always use `;` or one command per line when sharing terminal commands with the user.
