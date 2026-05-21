# PM Handoff — Local Delivery route tag compaction — interaction-audit — 2026-04-15

## Context
- Target route: `app/routes/app.local-delivery.tsx`
- Audience: ops (daily dispatcher) + fulfillment team (consumes Shopify Orders tag-filtered views outside the app)
- Symptom: user manually reassigned all of Route 5 into a new slot after merging Route 2 into Route 1. The real job: fill the empty `rota-2` hole so the fulfillment team's sequential tag-filtered views don't skip.

## Root cause (confirmed)

The fulfillment team works from Shopify Orders views filtered by tag (`rota-1`, `rota-2`, ...) and walks them sequentially. If a middle slot is empty, they may assume picking is done and miss later routes.

When orders are moved between routes in the app, the server handlers **do not compact tags**:

| Intent | Compacts gap? | Why |
|---|---|---|
| `unassign` (full route cleared) | ✅ Yes — existing code at ~line 9654 | Queries remaining, shifts `rota-(K+1)..` down |
| `assign` (move A → B via "Add to route") | ❌ No | Only re-tags the moved orders; never checks if source route went empty |
| `update-routes` (Confirm changes) | ❌ No | Client filters `orderIds.length > 0` before sending; server never learns Route 2 was emptied |

So merging Route 2 → Route 1 leaves `rota-2` as a hole with `rota-3..rota-5` still holding their original tags. The user's workaround was to re-create Route 5 at the empty slot manually.

## Proposed fix (first-class compaction)

**Approach: compact at "Confirm changes" time.**

Run a compaction step inside the `update-routes` server handler, BEFORE the per-route retag loop:

1. Client sends the new `editableRoutes` layout (including empty slots — change client to include them, OR have the server derive them).
2. Server detects any `rota-K` that is empty while `rota-(K+1)` is populated.
3. For each such gap, shift subsequent tags down via `tagsRemove` + `tagsAdd`.
4. Then apply the rest of the update-routes logic normally.

**Why this location, not the `assign` handler:**
- Compaction is expensive (N Shopify mutations per shifted slot). Running it on every single "Add to route" click is wasteful.
- "Confirm changes" is the natural commit point — user sees all their edits, then confirms once. Matches the button we just added.
- The `unassign` handler already compacts on clear-full-route, so compaction on confirm covers the remaining case.

**Client change required:**
- `handleUpdateRoutes` currently filters to `orderIds.length > 0`. Either (a) include all `dirtyRouteIds` regardless of length, or (b) pass a separate `emptiedRouteTags: string[]` signal so the server knows which gaps to fill.
- Mark a route as dirty when it becomes empty (it may already be — verify).

## Interaction gaps

| Element | Gap | Proposed fix | Severity |
|---|---|---|---|
| `update-routes` server intent | No gap compaction on commit | Add compaction pass before retag loop | **critical** |
| `assign` server intent | No compaction after source empties | Leave as-is (deferred to Confirm changes) | — |
| Client `handleUpdateRoutes` | Drops empty routes from payload | Include emptied dirty routes OR send `emptiedRouteTags` | **critical** |
| Dirty-route tracking | Verify a route becoming empty gets added to `dirtyRouteIds` | Audit `submitRouteAssignment` + unassign paths | important |

## Open questions for engineering

1. **After compaction, does the optimizer summary / quote totals need to re-key by the NEW route index?** `routeQuoteTotals[routeId]` is keyed by `locationId-routeIndex` — if Route 5 becomes Route 2, the client state needs to re-key.
2. **Dispatched routes:** if `rota-3` is dispatched and `rota-2` goes empty, do we shift `rota-3` → `rota-2`? Probably no — it would invalidate the Lalamove driver's route tag. Skip compaction past the first dispatched route.
3. **What does the fulfillment view actually filter on?** Confirm the exact tag format (`rota-1` vs `ld_rota-1` — the code has both in `ROUTE_TAG_DEFINITIONS`). Compaction must target the one the team filters on.
4. **Revalidation:** after compaction, the client must refresh to pick up the new tag layout. `updateRoutesFetcher.data` already triggers revalidation — verify it picks up the compacted state.

## Recommended next step

Confirm question 2 (dispatched-route safety) and question 3 (tag format) with the user, then invoke `/product-developer app/routes/app.local-delivery.tsx inputs/pm-handoff-route-manager-reorder-2026-04-15.md` for the compaction feature.
