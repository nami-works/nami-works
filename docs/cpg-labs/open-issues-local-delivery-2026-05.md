# Open issues — Local Delivery watchdog + dispatch lifecycle

**Captured:** 2026-05-18
**Owner:** Lucas (to triage when bandwidth allows)
**Status:** All open. Two known incidents already shipped fixes (see "Recently shipped" footer); the items below are uncovered gaps surfaced during diagnosis of those incidents.

This doc is the canonical map of every known watchdog/dispatch-lifecycle gap as of this session, so the next round of work doesn't have to rediscover them. Each item is self-contained: what's wrong, why it matters operationally, where the code lives, and a sketched fix direction.

---

## 1. Re-dispatch loop after manual Lalamove cancellation

### What's wrong
When an operator manually cancels a Lalamove order in Lalamove's UI, the cancellation propagates back as `CANCELED`/`REJECTED`/`EXPIRED` on `LalamoveDispatchJob.status`. The watchdog's Section 2 (failed-retry) treats this as a recoverable failure and fires `autoRetryDispatchJob` on the next 5-min tick, creating a fresh Lalamove order for the same Shopify orders. Operator cancels again, loop repeats.

### Operational impact
Real money / driver minutes burned on cancellation fees. Customer-facing confusion if a driver eventually accepts a re-dispatched leg the operator was trying to kill. The 2026-05-18 incident where Lucas was chasing #80669 and #80741 was driven by this loop (the agent killed it but the underlying mechanism is still in place).

### Where the code is
- [app/routes/api.cron.lalamove-watchdog.tsx](app/routes/api.cron.lalamove-watchdog.tsx) — Section 2 "failed-retry" block, the `failedJobs` query + `autoRetryDispatchJob` call.
- `MAX_AUTO_RETRIES = 2` cap exists but the 30-min `updatedAt` window means each retry resets the window.

### Fix direction
- New dispatch-status value `CANCELED_BY_OPERATOR` (already used ad-hoc by the kill-agent) that the watchdog's failed-retry query explicitly excludes.
- Surface a "cancel + lock" CLI intent: `POST /api/control/cancel-and-lock-dispatch` that cancels at Lalamove AND sets the status to `CANCELED_BY_OPERATOR`. The route-card cancel button in the UI should call this, not the bare cancel.
- Mirror the change in the auto-retry path: if a fresh retry detects the Lalamove order it's about to replace is `CANCELED` and the original job is now `CANCELED_BY_OPERATOR`, abort.

### Lucas's note on this issue
Lucas does NOT believe Hexagon is the source of this loop — he thinks the cron is responsible. The kill-agent reported "no `LalamoveDispatchJob` row" for both bad Lalamove order IDs, but that's most likely because the auto-retry path updates `lalamoveOrderId` on the existing row to point to the new Lalamove order, so when the agent looked up the OLD Lalamove order ID it found no match. The DB row exists; it just holds the latest retry's order ID. Worth confirming during the fix.

---

## 2. Cutoff not enforced on dispatch-creation paths

### What's wrong
The 17:30 BRT cutoff time (`LalamoveLocationConfig.retryCutoffTime`) is enforced ONLY in the watchdog cron — specifically in Section 1's stale-ON_GOING path and Section 2's failed-retry path. The dispatch-creation paths do NOT check the cutoff:
- Operator-initiated "Request Driver" / "Dispatch all routes" in `/app/local-delivery` UI
- Auto-assign cron when it dispatches assigned routes
- `/api/control/dispatch` REST endpoint

### Operational impact
On 2026-05-17, the operator clicked Dispatch at 17:36 and 17:37 BRT — both 6–7 min past cutoff. Lalamove accepted the orders, drivers were assigned, deliveries went out at the time of day Lucas wanted to prevent (drivers delivering late, customers receiving late at night).

### Lucas's stated intent
> "The cutoff should PREVENT LATE STARTS."

The cutoff should block ANY new dispatch (whether auto-retry, auto-assign, or operator UI click) past the configured time. Currently it only blocks one of the three.

### Where the code is
- [app/routes/api.control.$intent.tsx](app/routes/api.control.$intent.tsx) → `handleDispatch` (line ~483), `handleQuote` (line ~1999) — these are the operator/auto-assign dispatch paths. None call `isPastRetryCutoff`.
- The cutoff helper itself: `isPastRetryCutoff` in [app/routes/api.cron.lalamove-watchdog.tsx](app/routes/api.cron.lalamove-watchdog.tsx) (line ~35) — extract to shared helper if we're going to reuse it across routes.

### Fix direction
- Extract `isPastRetryCutoff` to a shared helper (e.g. `app/services/lalamove-cutoff.server.ts`).
- Call it at the top of `handleDispatch` — if past cutoff, return 409 with a structured error the UI can surface ("Cutoff has passed — dispatches blocked until tomorrow").
- Optional: surface the cutoff status in the UI's Route Manager card (e.g. show a "Cutoff reached" badge after 17:30 instead of the Request Driver button).
- Same for auto-assign cron when it triggers a fresh dispatch.

---

## 3. PICKED_UP webhook drops leave orders stuck

### What's wrong
The watchdog's reconcile sweep filters `status IN [terminal_statuses]` where terminal = `COMPLETED / CANCELED / CANCELLED / REJECTED / EXPIRED / DELIVERED / FULFILLED`. Section 1's stale-handler queries `status = 'ON_GOING'`. **`PICKED_UP` falls in neither.** When Lalamove transitions a driver from ASSIGNING → ON_GOING → PICKED_UP → COMPLETED but the COMPLETED webhook drops (or is delayed past the watchdog tick), the dispatch is stuck at PICKED_UP in our DB:
- Reconcile sweep skips it (not "terminal" by the current list)
- Section 1 skips it (not "ON_GOING")
- No fulfillment is ever created in Shopify
- The `ld_rota-NN` tag stays on the order forever

### Concrete example
2026-05-17 dispatch `2zkcjb5hdp` (Lalamove `3497575112121729913`) — driver completed (Lalamove status COMPLETED, all 5 stops have signed POD), our DB still says PICKED_UP, 5 orders (#80578, #80691, #80722, #80746, #80749) sitting at UNFULFILLED with `ld_rota-02` tags.

### Where the code is
- [app/routes/api.cron.lalamove-watchdog.tsx](app/routes/api.cron.lalamove-watchdog.tsx) — Section 1 query (`status: "ON_GOING"`) and Section 4 reconcile sweep (`RECONCILE_TERMINAL_STATUSES` const).

### Fix direction
- Add `PICKED_UP` to the watchdog's Section 1 query — `status: { in: ['ON_GOING', 'PICKED_UP'] }`. Same stale-detection logic applies.
- Alternative: change Section 1 to be the canonical "any non-terminal stale dispatch" handler — fetch live Lalamove status FIRST, then act.
- The reconcile sweep doesn't need PICKED_UP — that's an in-flight status. Section 1 catching it and flipping the DB to whatever Lalamove now says (COMPLETED → reconcile fires from Section 4 next tick, or directly inline) covers it.

---

## 4. Pre-fulfilled orders get re-dispatched

### What's wrong
When an operator manually fulfills a Shopify order (via the route-card UI, the `mark-stop-delivered` CLI, or the Shopify admin directly), the system does NOT cancel any pending Lalamove dispatches that include that order. If the watchdog's auto-retry path was scheduled to re-dispatch, it will fire and create a fresh Lalamove order for an order Shopify already shows as delivered.

### Concrete example
- 2026-05-18 #80669 (Eliana da Nobrega): manually fulfilled at 09:23 BRT today; an auto-retry created a fresh Lalamove dispatch at 09:25 BRT (2 min after fulfillment) — driver was being assigned for an order already marked delivered.
- 2026-05-18 #80741 (Luciana Oliveira): manually fulfilled at 09:23 BRT today; auto-retry had ALREADY fired at 09:00 BRT — Lalamove dispatch was sitting in ASSIGNING_DRIVER for 23 min before the fulfillment, and didn't stop after fulfillment.

### Operational impact
Drivers could show up at the store expecting to pick up items that were marked delivered. Awkward for the store (have to explain to the driver), potentially a Lalamove cancellation fee, and operational confusion.

### Fix direction
Two complementary changes (cheap to do both):

**(a) At dispatch-creation time**: before placing the Lalamove order, query Shopify for each order's `displayFulfillmentStatus`. If any is `FULFILLED` or `PARTIALLY_FULFILLED`, exclude it from the dispatch. If the dispatch ends up empty, abort.

**(b) At fulfillment time**: when `fulfillOrderWithVerification` succeeds (or `mark-stop-delivered` returns OK), look up any open `LalamoveDispatchJob` whose order maps include this order GID. If the job is in `ASSIGNING_DRIVER`/`ON_GOING`/`PICKED_UP` status AND the operator is fulfilling all remaining stops via this manual path, call `cancelLalamoveOrder` to terminate the pending dispatch.

Option (b) is harder to get right (mid-route manual fulfills shouldn't kill the whole Lalamove order if other stops are still in-flight). Option (a) is the safer baseline — at the very least, fresh dispatches must skip already-fulfilled orders.

### Where the code is
- Dispatch creation: [app/routes/api.control.$intent.tsx](app/routes/api.control.$intent.tsx) → `handleDispatch`. The Lalamove API call goes through helpers in `app/services/lalamove*.server.ts`.
- Fulfillment path: `fulfillOrderWithVerification` in [app/services/lalamove-reconcile.server.ts](app/services/lalamove-reconcile.server.ts).

---

## 5. Watchdog reconcile-sweep bumps `updatedAt` on stale jobs → revives them for failed-retry

### What's wrong
The Section 4 reconcile sweep persists `podBucket` on every job it touches. The persist update bumps Prisma's `@updatedAt`. The Section 2 failed-retry section then sees the just-bumped job in its `updatedAt >= NOW() - 30min` window and processes it through the CUTOFF path.

### Concrete example
2026-05-16 19:00–19:35 BRT: 11 historical EXPIRED jobs from March–May 2026 sat dormant for weeks. My new reconcile sweep touched them at 22:00 UTC (bucketed all as `held` because no `ordersData`). Within 5–35 min, the failed-retry section's CUTOFF path stripped their tags because they were now "freshly updated REJECTED/EXPIRED" past cutoff.

### Status
**Partially mitigated** by the 2026-05-17 fix (`cutoff = reconcile-first`, see footer) — the cutoff no longer blindly strips tags; it calls reconcile first. But the chain reaction (sweep touches stale → failed-retry sees it as fresh) is still possible for OTHER paths in Section 1 / Section 2 that might do destructive things on `updatedAt-fresh` REJECTED/EXPIRED jobs.

### Fix direction
The conservative fix: change `persistBucketingResults` to write `podBucket` and `lastBucketingAt` while leaving `updatedAt` alone (Prisma can't normally do this — would need a raw SQL update or `prismaAny.lalamoveDispatchJob.update({ data: { ..., updatedAt: existingUpdatedAt }})` to preserve the original).

More robust: stop using `updatedAt` as the freshness signal in Section 2. Use `lastRetryAt` (already a column on the model) or a new dedicated `lastFailureAt` column.

### Where the code is
- [app/services/lalamove-reconcile.server.ts](app/services/lalamove-reconcile.server.ts) → `persistBucketingResults`
- [app/routes/api.cron.lalamove-watchdog.tsx](app/routes/api.cron.lalamove-watchdog.tsx) → Section 2 `failedJobs` query

---

## 6. Lalamove order-level status mismatch with per-stop POD

### What's wrong
Lalamove's `order.status` can lie. Drivers complete deliveries (POD images, signed, timestamped) but the order-level status reads `REJECTED` or `EXPIRED` or `CANCELED`. We have at least four real-world patterns documented:

- **Edge case 1 (Ana Castro, 2026-05-15)**: order `COMPLETED` but a return-to-pickup stop appended at the end signaled the last delivery actually failed. Last stop's POD said DELIVERED anyway.
- **Edge case 2 (Driver mid-route cancel)**: 4 of 5 stops delivered, driver hit "cannot deliver" on stop 5, Lalamove cancelled the WHOLE order. Order-level says CANCELED, 4 stops have signed POD.
- **2026-05-16 incident**: 10 dispatches that drove the cutoff investigation. All COMPLETED on Lalamove, all stops signed, our DB stuck at ON_GOING because the COMPLETED webhook dropped. Cutoff stripped their tags.
- **2026-05-18 historical pickup**: same shape, lying status, different incident.

### Status
**Mostly fixed** by the 2026-05-17 watchdog refactor: per-stop POD is now the source of truth in `pod-bucketing.server.ts`, four "needs-review" detection rules surface contradictions to the operator, the cutoff calls reconcile first. The remaining gap is paths OUTSIDE the watchdog that still trust order-level status (e.g. the loader's status-sync at [app/routes/app.local-delivery.tsx](app/routes/app.local-delivery.tsx) line 8761 just flips DB status to match Lalamove's `apiStatus` without bucketing first).

### Fix direction
Audit every place we read `details.status` from Lalamove. Wherever it influences a write (DB status, tag mutation, fulfillment decision), wrap it with a reconcile-first guard. The pattern: if the status is non-terminal, trust it; if terminal, reconcile per-stop POD before any destructive action.

---

## 7. CLAUDE.md needs a small correction re: Lalamove creds

### What's wrong
CLAUDE.md / earlier session briefings assumed Lalamove API creds live in container env vars. They don't — they're AES-256-GCM-encrypted in the `LalamoveShopCredential` table, decrypted via `APP_ENCRYPTION_KEY` (also encrypted). Scripts that want to call Lalamove from a one-off context must either:
- Run inside the container with `getRuntimeCredentialsForShop(shop)` to decrypt
- Or pull creds from the local `.env` (where Lucas has added prod copies for the inspector scripts)

### Fix
Update CLAUDE.md's "Carrier Services" / "Logging" section to note credential location. The kill-agent flagged this during its run.

---

## 8. Hexagon: pickup orders posted as SHIPPING

Already documented in detail at [docs/handover-hexagon-pickup-fix.md](handover-hexagon-pickup-fix.md). Summary:
- Hexagon orders meant for in-store pickup arrive in Shopify with `fulfillmentOrders[0].deliveryMethod.methodType = "SHIPPING"` and the customer's home address on `shippingAddress` + `destination`.
- Native pickup orders have `methodType = "PICK_UP"` and `null` everywhere else.
- Three fields need to change in Hexagon's order-creation payload. Self-contained handover doc for the Hexagon team.

This is independent of the cron issues above — it's about the SHAPE of orders entering our system, not the watchdog's behavior. Lucas's clarification: Hexagon is NOT the source of the re-dispatch loop in issue 1; that's a watchdog problem. The pickup-as-shipping bug is real but separate.

---

## 9. Hexagon: local-delivery orders also posted as SHIPPING

### What's wrong
Same root bug as the pickup case (issue 8) — Hexagon hardcodes `methodType=SHIPPING` regardless of customer intent. Verified by comparing `#80841` (Hexagon local-delivery) with `#80835` (native web local-delivery, same Shops Jardins location, same day).

Diff highlights:
- `methodType` is `SHIPPING` on Hexagon, should be `LOCAL` for local-delivery
- `deliveryMethod.additionalInformation.phone` is `null` on Hexagon, should be the recipient phone (driver uses it to call ahead)
- Order-level `shippingAddress` IS populated correctly (unlike pickup where it must be null) — local-delivery legitimately needs the customer's address

### Operational impact
Less catastrophic than the pickup case (a delivery order being routed as a shipping order is at least going to the right physical address), but it means:
- Our local-delivery auto-assign filters on `deliveryMethod === "LOCAL"` — Hexagon's `SHIPPING` orders SKIP local-delivery routing entirely. The operator has to manually intervene.
- The hidden-warehouse routing logic + driver-contact phone are bypassed.

### Status
**Same handoff document covers it.** Appended a "local-delivery appendix" to [docs/handover-hexagon-pickup-fix.md](handover-hexagon-pickup-fix.md) with the three-mode summary table (SHIPPING / LOCAL / PICK_UP). The fix is the same shape — Hexagon already populates `customAttributes.shipping_additional_delivery_method_type` with the right intent; they just need to map that to the correct `deliveryMethod.methodType` value at order-create time instead of always sending `SHIPPING`.

---

## 11. Escalation `reorderJob` doesn't update `requestedAt` → reorders fire on every tick forever

### What's wrong
[app/services/lalamove-escalation.server.ts:305-306](app/services/lalamove-escalation.server.ts#L305-L306) computes `elapsedMinutes = (Date.now() - job.requestedAt) / 60_000` and triggers `reorderJob` when `elapsedMinutes >= REORDER_MINUTES` (40 min). But `reorderJob` creates a new Lalamove order and does NOT update `LalamoveDispatchJob.requestedAt`. So on every subsequent watchdog tick (every 5 min) the same job is still "stale" and `reorderJob` fires again. Cancel-and-re-request loop, indefinitely, until a real driver finally accepts one of the offers OR the operator notices.

### Operational impact (just measured, 2026-05-18)
**28 surplus Lalamove driver-invitations sent today across just 2 dispatch jobs.** Each invitation is a real push notification to nearby drivers via the Lalamove app, and any driver who hopped on the gig before Lalamove auto-cancelled the slot drove to the GE Beauty store expecting a pickup. **This is the source of the "unexpected drivers showing up at our POS" report Lucas's team flagged.**

| Store | Job | Reorder attempts | Real driver eventually | Real driver at try # |
|---|---|---|---|---|
| Shops Jardins | `…3565zu` | 13 | driver 559185 | 13th |
| Quiosque Recife | `…43t1sb` | 15 | driver 1878325 | 15th |

Both jobs are now COMPLETED, no active loop — but tomorrow's traffic will recreate the pattern unless this is fixed.

### Where the code is
- [app/services/lalamove-escalation.server.ts](app/services/lalamove-escalation.server.ts) — `reorderJob()` around line 305-319.
- Caller: the watchdog cron / `checkAndApplyEscalations()`.

### Fix direction
**One-line fix** (P0 — should ship next):
In `reorderJob()`, after the new Lalamove order is created successfully:

```ts
await prisma.lalamoveDispatchJob.update({
  where: { id: job.id },
  data: {
    lalamoveOrderId: newOrder.orderId,
    requestedAt: new Date(),       // ← THE FIX
    priorityFeeLevel: 0,            // ← ramp re-starts on the new order
    updatedAt: new Date(),
  },
});
```

**Defence-in-depth** (P1):
- Add `reorderCount` column to `LalamoveDispatchJob` (or repurpose `retryCount` — careful: today `retryCount` counts `autoRetryDispatchJob` invocations, NOT escalation reorders. Two distinct concepts now share no counter).
- Hard cap reorders at e.g. 3. After cap → `status = NEEDS_REVIEW`, emit an operator-visible signal in the route card, stop auto-acting.
- The hard cap is what stops "we kept paying for invitations all afternoon, and the cost in driver goodwill / fake show-ups was higher than what a successful delivery would've cost."

### Why this didn't surface earlier
- `retryCount` (the existing counter, capped at 2) only tracks `autoRetryDispatchJob` — the full re-create-the-Lalamove-order path. Escalation `reorderJob` is a different path that ALSO creates a new Lalamove order but doesn't increment `retryCount`. So we had a "max 2 retries" mental model that didn't cover what was actually happening.
- The kill-agent yesterday locked 36 jobs but only via the `retryCount=99` mechanism. Escalation reorders were never on the kill-list because they don't show up as REJECTED/EXPIRED+retryCount<2.

---

## 12. Driver-not-moving (approach tracking) scaffolded but inert

### What's wrong
There's a parallel mechanism for detecting "driver accepted but isn't actually approaching the pickup" — `handleCheckDispatches` in [app/routes/api.control.$intent.tsx](app/routes/api.control.$intent.tsx) (line ~1739). It samples driver GPS via Lalamove, computes haversine distance to pickup, increments `LalamoveDispatchJob.approachFailCount` when distance doesn't decrease.

Constants:
- `APPROACH_STRIKE_LIMIT = 3`
- `APPROACH_ARRIVAL_RADIUS_M = 300`
- `APPROACH_GRACE_MINUTES = 4`

The endpoint correctly identifies stuck drivers and returns a "suggest reorder" telemetry payload — **but nothing consumes the suggestion.** The watchdog cron polls the endpoint but doesn't auto-trigger reorderJob, and the route-card UI doesn't surface the strike count to the operator. Data is collected, threshold logic is sound, but the loop is open.

### Operational impact
Drivers can accept the gig and then park / hunt for parking / never actually approach the store. Until they finally move (or Lalamove auto-cancels them after some upstream timeout), the dispatch sits idle. Today the operator only finds out by manually checking the Lalamove app or when the customer calls asking where their delivery is.

### Where the code is
- [api.control.$intent.tsx](app/routes/api.control.$intent.tsx) — `handleCheckDispatches` (line ~1739), `APPROACH_STRIKE_LIMIT` const (line ~1563).
- DB columns: `lastDriverLat`, `lastDriverLng`, `lastDriverSampledAt`, `lastDistanceToPickupM`, `approachFailCount` on `LalamoveDispatchJob`.
- The polling cron is in `api.cron.check-dispatches` or similar — confirm exact filename before editing.

### Fix direction
Three pieces, in order of value:

1. **Auto-trigger reorder** at `approachFailCount >= APPROACH_STRIKE_LIMIT`. Same code path as the 40-min escalation reorder — call `reorderJob`. The hard-cap fix shipped 2026-05-19 (`reorderCount` + `MAX_REORDER_ATTEMPTS = 3`) protects this path too because `reorderJob` is the single point of entry. So adding approach-triggered reorders does NOT risk the runaway-reorder problem we just fixed.

2. **Route-card badge** at `approachFailCount >= APPROACH_STRIKE_LIMIT - 1` (one strike before action). "Driver stuck — may auto-reorder soon" warning so the operator can pre-empt manually or call the driver.

3. **Last-driver-location tooltip** on the badge: show the driver's last known coords + distance + how many minutes since the last forward progress. Operational context for the on-call deciding whether to override.

### Why this didn't surface earlier
The mechanism was added during the original watchdog work but the auto-trigger wiring was deferred. Likely intentional ("collect data first, validate the heuristic, THEN auto-act") that just never got followed up.

---

## 10. CLI gaps for the needs-review resolution workflow

Already partially shipped — `mark-stop-delivered`, `mark-stop-failed`, `clear-needs-review` exist as `/api/control/*` intents. Still missing:
- Python wrapper in `nami-works/sandbox/gebeauty/scripts/cpg_control.py` for `mark-stop-failed` and `clear-needs-review` (only `mark-stop-delivered` is wired today).
- The route-details modal banner exists (per [inputs/mockups/watchdog-mark-delivered-ui-v1.html](../inputs/mockups/watchdog-mark-delivered-ui-v1.html)) but currently the operator has no in-UI affordance to act on it; the implied workflow is to use the CLI. Long-term that's fine; short-term the operator has no way to dispatch from the UI without dropping to terminal.

---

## Recently shipped (context — for the curious / for diffing)

| Date | Change | What it covers |
|---|---|---|
| 2026-05-16 | `feat(local-delivery): watchdog auto mark-as-delivered + needs-review bucket` (commit `8717026`) | The main watchdog reconcile-sweep + needs-review bucket + per-stop POD-aware bucketing |
| 2026-05-16 | `fix(local-delivery): watchdog held-retry + newest-first reconcile sweep` (commit `67c7f09`) | Held jobs get retried hourly + newest-first ordering so today's orders process before historical backlog |
| 2026-05-17 | `fix(local-delivery): cutoff = reconcile-first, never strip in-progress tags` (commit `9dd1ab2`) | The cutoff path no longer blindly strips tags; reconciles first and only adds `ld_failed-dispatch` for the genuinely-no-driver case |

The three items above closed the **majority** of the bug shapes we discovered this week, but the issues in 1–10 above are uncovered gaps the diagnoses surfaced. Triage them when bandwidth allows.
