# Handover — Track 4 #1 · per-order mark-as-delivered POD bucketing

**For:** the next Claude Code session picking up Track 4 issue #1.
**From:** session that shipped LD UI polish + Lalamove address fix on 2026-05-02 (rev 8 / `b42634d` on main).
**State of main:** clean, equals running production. No in-flight work blocking this track.

---

## What you're building

Today, when the operator clicks "Mark as delivered" on a route, the server treats every stop on the route as DELIVERED and fires fulfillment events for all orders — including stops that actually FAILED. This pushed a bogus "delivered" email to Yasmin (#78301) for an order that never arrived. The fix is to introduce **per-stop POD bucketing**: classify each stop on a dispatched route, then act per bucket.

Buckets (per `optimizer-iteration-blueprint.md` §13.8 acceptance criteria):

| Bucket | Definition | Action |
|---|---|---|
| `clean` | All stops DELIVERED, all matched to orders | Fulfill all, fire DELIVERED events, send notifications |
| `mixed` | Some DELIVERED + some FAILED | Fulfill only the DELIVERED stops; tag FAILED-stop orders `ld_redelivery_pending`; do NOT email customers of failed stops |
| `held` | Some stops unmatched (couldn't link stop to order) | Surface for human review; fulfill nothing automatically |
| `skip` | All stops FAILED or all unmatched | Tag `ld_redelivery_pending`; no fulfillments |

Stop-to-order matching cascade: phone (E.164) → fuzzy name → 50m haversine on coords → first-stop = pickup heuristic.

Plus a new endpoint `mark-stop-delivered` for the **Beatriz #77793 case** — operator needs to surgically fulfill ONE stop on a route without affecting siblings (idempotent, single-order).

---

## First-action checklist

1. **Read GH issue #1 in full**: `gh issue view 1 --repo nami-works/cpg-labs` (URL: https://github.com/nami-works/cpg-labs/issues/1).
2. **Read the blueprint** for strategic frame: `git show origin/feat/optimizer-iteration-loop:docs/optimizer-iteration-blueprint.md` — focus on §0 (frame), §13 (the 8 day-zero defects, including #13.8 which is this task), §5 (defect-fix workflow), §9 (week-1 plan). **Skip §4 (feedback CLI) and §12 (autonomy gate)** — Lucas signaled fatigue with that framework; he wants this issue fixed directly, no flag, no soak.
3. **Cut branch from latest main**: `git checkout main && git pull && git checkout -b feat/mark-delivered-pod-bucketing`.
4. **Run `/product-manager` deep-dive** on the open questions below. Yield to Lucas with the brief.
5. **Run `/design-engineer`** for the per-stop status pills + overflow ⋯ Mark this stop delivered modal. Mockup-first AND state matrix (per-stop pills have at least 4 states: Delivered / Failed / Pending / Unknown), then code.
6. **Then code**, then yield. Don't autoschedule, don't loop.

---

## Verified file:line evidence (good as of `b42634d`)

- `handleMarkDelivered` — `app/routes/api.control.$intent.tsx:1181`
- `addDeliveredEvent` defined at `:1303` — its return is **ignored** at `:1367` (existing-fulfillment branch) and `:1417` (new-fulfillment branch). Both call sites need to capture the return so `shopifyFulfilled` only increments when fulfillment AND DELIVERED-event both succeed.
- Three existing call sites of `handleMarkDelivered`: `:343`, `:354`, `:362` (different intents — verify each still hits the new bucketed path correctly).

The function is ~250 lines (1181 → ~1430). Read the whole thing before refactoring; there's existing tag-archival + watchdog-cutoff logic that must keep working.

---

## Concrete fix shape (Lucas's explicit guidance, 2026-05-02)

> "If you want one thing fixed soon, the fastest cut is: skip the framework. Just fix #13.8 directly on a feature branch, no flag, no telemetry, no soak. It's a self-contained change to `handleMarkDelivered`."

So:

1. **New file** `app/services/pod-bucketing.server.ts` with:
   - `summarizeRoutePOD(route)` → `{ delivered: Stop[], failed: Stop[], unmatched: Stop[] }`
   - `bucketRouteForFulfillment(route)` → `clean | mixed | held | skip`
   - Stop-to-order matching cascade (phone → name → 50m → first-stop=pickup).
2. **Refactor `handleMarkDelivered`** to call `bucketRouteForFulfillment` first and branch per bucket.
3. **New endpoint `mark-stop-delivered`** for the Beatriz case. Single-order surgical fulfill; idempotent (re-running on already-fulfilled = no-op).
4. **Capture `addDeliveredEvent` return** at `:1367` and `:1417`. Increment `shopifyFulfilled` only when fulfillment AND event both succeeded. Add `partialDelivery: true` to the response when `shopifyFulfilled !== deliveredEventsCreated`.
5. **Post-write verification**: re-query the fulfillment, confirm `displayStatus === "DELIVERED"`. If not progressed, run the retry chain `IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED`. Log loudly and surface in `fulfillmentFailures` if still wrong after retry.
6. **UI**: existing "Mark as delivered" button stays; server response now includes the bucket → UI toasts per bucket. Add per-stop status pills (Delivered / Failed / Pending / Unknown) on the dispatched-route card. Add per-stop overflow `⋯ Mark this stop delivered` opening a confirmation modal (notify-customer toggle defaults ON per `feedback_fulfill_notify_default.md`).
7. **Tests**:
   - Yasmin #78301 dispatch payload (4 DELIVERED + 1 FAILED) → assert 4 fulfillments + 1 `ld_redelivery_pending` tag, **no FAILED-stop email**, response includes `bucket: "mixed"` and `partialDelivery: true`.
   - Beatriz #77793 → `mark-stop-delivered` → assert single fulfillment, `displayStatus === "DELIVERED"`, idempotent on re-run.

---

## Open questions for `/product-manager` deep-dive

These are the ambiguities Lucas hasn't decided yet — surface them in the brief, don't guess:

1. **`held` bucket UX.** Unmatched stops mean the matching cascade failed (rare). Auto-tag for review? Block the whole "Mark delivered" action with a modal asking the operator to manually link? Decide before coding the bucket branch.
2. **Retry chain timing.** When `displayStatus` doesn't progress, how aggressive is the retry? Synchronous in-request, async via a follow-up cron, or surface a "needs retry" state? Affects whether this stays self-contained or needs a queue.
3. **`partialDelivery: true` UI semantic.** Toast wording? Banner that persists until acknowledged? The Yasmin scenario needs a clear "5 stops, 4 delivered, 1 failed → check #78301" message somewhere visible.
4. **Notification semantics on `mark-stop-delivered`.** Default-ON per existing memory, but should the modal show a preview of the customer-facing email before sending? High-stakes for the Beatriz "single surgical fulfill" path where the operator is intentionally shipping a notification.
5. **Idempotency keys.** `mark-stop-delivered` re-runs cleanly, but how do we recognize "already done"? Stop ID + route ID composite key? Check `displayStatus` on the fulfillment first?

---

## Don't bring (explicit "leave alone" list)

- **The polaris branch's drafted telemetry** (`2ffb61e` on `chore/polaris-web-component-migration`) — Lucas wants this issue fixed without telemetry/flag/soak overhead. If you ever want telemetry, that's a separate conversation.
- **The killed framework** — no chat-room, no worktrees, no session-A/B/C, no decision-log directory, no wakeup loops. Single session, finish, hand back. See `feedback_single_session.md` in memory.
- **The `feat/optimizer-iteration-loop` branch's stale Phase-3 deletions** (`2d45fb0` accidentally bundled ~30 unrelated admin-marketing route deletions). Cut from `main`, not from that branch. Reference the blueprint via `git show origin/feat/optimizer-iteration-loop:docs/optimizer-iteration-blueprint.md`.
- **Don't open PRs for issues #2-#8 in parallel.** This branch closes only issue #1. Per `feedback_max_orders_per_route.md` and other op-flow memories, ship one fix at a time.

---

## Quick references

- **GH issue #1**: https://github.com/nami-works/cpg-labs/issues/1
- **Blueprint** (read §0, §13, §5, §9): `git show origin/feat/optimizer-iteration-loop:docs/optimizer-iteration-blueprint.md`
- **Memory entries that apply** (auto-loaded — don't re-read unless relevant): `project_auto_delivery_pipeline.md`, `project_route_optimizer_tuning.md`, `feedback_max_orders_per_route.md`, `feedback_route_clustering_sanity_check.md`, `feedback_fulfill_notify_default.md`, `feedback_commit_then_push.md`, `feedback_single_session.md`.
- **CloudWatch for verification**: `/ecs/omnify-full` in `us-east-1`. Use `scripts/logs.ps1 local-delivery` or PowerShell + `aws logs filter-log-events`.
- **Deploy queue**: `.claude/deploy-queue.md` — append a Pending entry before claiming the task is done.

---

## Yield protocol

After the `/product-manager` deep-dive: yield to Lucas with the brief. He decides the open questions before any code lands. After mockup: yield again. After implementation: yield with manual smoke steps + the deploy-queue entry. Lucas runs the deploy himself.
