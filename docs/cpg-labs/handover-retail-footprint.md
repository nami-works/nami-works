# Session Handover — 2026-03-27

## What was done

### Retail Footprint — Delete project
- **Delete button on expansion project cards** — positioned in card header row (`cardHeader` class: badge left, delete right), matching Local Delivery's "Clear route" pattern. Uses `variant="secondary" tone="critical"`.
- **Delete button inside Edit modal** — positioned **bottom-left**, isolated from Cancel/Save on the right (split footer), per the new CLAUDE.md convention for non-primary destructive actions.
- **Confirmation modal** — `deleteConfirmSetId` state + `useEffect` auto-opens `delete-project-confirm-modal`. On confirm: submits `delete-location-set` action, optimistically removes from `localLocationSets`, clears `loadedProjectId`/`expandedProjectId` if the deleted project was active.
- **Server action** `delete-location-set` — filters out the set and rewrites via `writeLocationSets`.

### Retail Footprint — Standalone locations cleanup
- **Map markers no longer render standalone locations.** When no project is loaded, no markers appear. The `locations` variable from the loader is no longer used in the map rendering useEffect.
- **Production DB cleared** — `RetailLocationSet` and `RetailCurrentLocations` tables were emptied via ECS exec.
- `readLocations`/`writeLocations` still exist in code but are dormant — the standalone actions (`add-location`, `remove-location`, `clear-locations`, `load-location-set`) are still in the action handler but unused by the UI.

### Retail Footprint — New project save flow
- **City pre-fill** — `handleAddLocation` and `handleAddLocationFromMap` set `storedCityName` from the first location's city when `pendingLocations` is empty. This pre-fills the project name in `save-project-modal`.
- **Client-generated setId** — `handleSaveSet` generates `set-${Date.now()}` and passes it to the server action via formData. Server prefers the client ID. This ensures optimistic UI and persisted data share the same ID.
- **Optimistic sidebar + auto-load** — After save, the new project is added to `localLocationSets`, then auto-loaded: `setLoadedProjectId`, `fetchProjectStats`, `setIsHeatmapExpanded(true)`, collapse cities/projects.

### Retail Footprint — UI reorganization
- **New project button moved** from `mapFooterRow` (below heatmap, in focused layout) to the **top of the expanded projects card list** (right-aligned, primary variant).
- **Removed New project button from focused table layout** to avoid confusion.

### Retail Footprint — Customize stats modal
- **Radii header** is now standalone `<s-text type="strong">` (same level as "Qualitative Criteria").
- **km/mi select** moved to its own line below the header (was inline with header).
- **Removed "Radius n" labels** from stepper rows — now just `[toggle] [stepper] {unit}`.
- **Stepper font** updated to match Polaris: `Inter`, `13px`, weight `450`.

### Retail Footprint — Settings persistence
- **Per-project StatsConfig** — `load-project-stats` action now also returns `projectStatsConfig` via `readStatsConfig(shop, setId)`. On load, both `statsConfigApplied` and `statsConfigDraft` are set from the project's config.
- **Qualitative criteria** already persisted via `update-location-fit` → `writeLocationSets` (no change needed).

### CLAUDE.md updates
- **Delete button placement rule** — new convention: when delete is not the expected action, place it bottom-left with split footer.
- **Optimistic creates rule** — generate IDs client-side and pass to server to avoid mismatches.

## Key decisions

1. **Standalone locations are dormant, not removed.** The code (`readLocations`, `writeLocations`, action handlers) still exists but the UI no longer calls it. This was a conscious choice to avoid breaking changes — a future session can clean up the dead code.
2. **Delete button placement depends on intent context, not modal type.** The rule generalizes beyond edit modals: any context where delete is NOT the primary intent uses bottom-left isolation.
3. **Client-generated IDs for optimistic creates.** The pattern of passing `setId` from client to server was established to avoid ID mismatch between optimistic state and DB. This is now a CLAUDE.md rule.
4. **ECS cluster name is `cpg-labs`** (not `omnify-gebeauty`). Service is `omnify-gebeauty-service`. Container is `omnify-gebeauty`.

## What's pending

From the user's earlier backlog (partially addressed this session):

- [x] **Google Places auto-add** — already in place.
- [x] **Stepper constraints** — already in place.
- [ ] **Dead code cleanup** — remove dormant standalone location code:
  - **Loader** (line 615): `readLocations(shop)` call and `locations` in the return object
  - **Import** (line 16): `readLocations` import
  - **Action handlers** (lines 661-727): `add-location`, `remove-location`, `clear-locations`, `load-location-set` — no UI submits to any of these
  - Also remove `writeLocations` import and `writeLocations` calls inside those handlers
- [ ] **Delete `scripts/clear-location-sets.ts`** — one-off cleanup script, no longer needed.

## Modified files

### Retail Footprint (this session's focus)
- `app/routes/app.retail-footprint.tsx` — **Complete**: delete project, standalone markers removal, new project flow, customize stats, settings persistence
- `app/routes/app.retail-footprint/styles.module.css` — **Complete**: removed `.radiiHeaderRow`, `.radiusLabel`; updated `.radiusInput` font

### Project conventions
- `CLAUDE.md` — **Complete**: delete button rule, optimistic create ID rule

### Cleanup needed
- `scripts/clear-location-sets.ts` — **Cleanup**: one-off script, delete it

## Current state

- **Deployed to production** — all changes from this session are live.
- **Production DB cleaned** — `RetailLocationSet` and `RetailCurrentLocations` tables are empty.
- **TypeScript** — zero errors in `app.retail-footprint.tsx`, zero errors project-wide.
- **Not committed** — all changes are in the working tree (unstaged). The user should commit before the next session.

## Recommended next steps

1. **Commit the current changes** — large batch of Retail Footprint improvements.
2. **Clean up dead code** — remove standalone location actions, loader field, and imports (lines 16, 615, 661-727).
3. **Delete `scripts/clear-location-sets.ts`** — one-off script.
4. **Continue with remaining Retail Footprint backlog** from user's earlier request.

## Context the next session needs

- **`app.retail-footprint.tsx` is ~3800 lines.** Use targeted line-range reads, not full file reads.
- **The `handleAddLocationRef` pattern** is used because the Google Places autocomplete callback needs to call `handleAddLocation` but is set up inside a useEffect with stale closure. The ref bridges the gap.
- **`fetchProjectStats`** uses a separate `projectStatsFetcher` (not the main `fetcher`). The main `fetcher` handles CRUD; `projectStatsFetcher` handles the heavy `load-project-stats` action that computes radius metrics.
- **`localLocationSets` is the source of truth for UI** — it starts from `loaderLocationSets` but is optimistically updated. The loader value syncs back via useEffect.
- **CSS removed in this session** (`.radiiHeaderRow`, `.radiusLabel`) may still be referenced if any code paths were missed — grep before assuming they're fully unused.
- **Memory file** `project_retail_footprint_locations.md` has the architectural context for the standalone-locations decision.
