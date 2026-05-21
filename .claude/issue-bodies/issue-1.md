

### Summary
`handleMarkDelivered` in `app/routes/api.control.$intent.tsx` operates on a whole route as one indivisible unit. Every order in the route is fulfilled in Shopify and gets a DELIVERED event regardless of per-stop POD outcome. On a 4-of-5 DELIVERED + 1 FAILED route, the failed customer receives a "your order has been delivered" email anyway. Confirmed by the Yasmin #78301 incident.

The inverse — Beatriz #77793 — is also unhandled: an order physically delivered but stuck UNFULFILLED, with no surgical "mark this one stop delivered" path because mark-delivered is route-level only.

### Defect class
`pod-mismatch` (1st occurrence in the structured backlog; recurring in operator notes).

### Evidence
- Route-level treatment: [app/routes/api.control.$intent.tsx:1181](../../app/routes/api.control.$intent.tsx#L1181) — `handleMarkDelivered` iterates `lalamoveDispatchOrderMap` with no per-stop POD branching.
- DELIVERED event return value ignored: [api.control.$intent.tsx:1417](../../app/routes/api.control.$intent.tsx#L1417) — `await addDeliveredEvent(fulfillmentId, shopifyOrderId)` — return is `false` on userErrors but the call site doesn't check, and `shopifyFulfilled` is incremented on line 1416 before the event call. Same pattern at [line 1367](../../app/routes/api.control.$intent.tsx#L1367) for the existing-fulfillment branch.
- No post-write verification of `fulfillment.displayStatus`. Operators report orders showing FULFILLED instead of DELIVERED post-call.
- Per-stop POD data exists in `state.routes[].dispatch.stops[]` and is currently unused by the mark-delivered path.
- Memory: `project_beatriz_77793_pending.md`, `feedback_fulfill_notify_default.md`.

### Operator impact
~1–3 mis-fulfillments per week on gebeauty volume. Each requires customer apology, refund processing, and re-dispatch reconciliation. Multi-tenant: catastrophic — first "Delivered" email screenshot next to an empty doorstep is a trust kill.

### Proposed fix direction
1. New `app/services/pod-bucketing.server.ts` with `summarizeRoutePOD(route)` and `bucketRouteForFulfillment(route)` returning `clean | mixed | held | skip`.
2. Stop-to-order matching: phone (E.164) → fuzzy name → 50m coords → first-stop=pickup heuristic.
3. `handleMarkDelivered` calls bucketing first and branches:
   - **clean** — fulfill all, verify `displayStatus === "DELIVERED"` post-write, retry with `IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED` chain if not progressed.
   - **mixed** — fulfill DELIVERED stops only; tag FAILED stops `ld_redelivery_pending`, never email them.
   - **held** — `{ ok: false, status: "held", retryAfter }`, no Shopify writes.
   - **skip** — `{ ok: false, status: "manual-review" }`, return unmatched-stop summary.
4. New endpoint `mark-stop-delivered` for surgical single-order interventions (Beatriz case). Idempotent.
5. Response shape exposes `partialDelivery: true` when `shopifyFulfilled !== deliveredEventsCreated`.
6. Behind flag `optimizer.mark-delivered.per-stop-bucketing`. Legacy route-level path stays as flag-off rollback for 30 days.

### UI changes (embedded admin)
- Existing **Mark as delivered** button: server response now includes bucket. UI toasts per bucket and renders per-stop status pills (Delivered/Failed/Pending/Unknown) on the dispatched-route card.
- Per-stop overflow `⋯` menu with **Mark this stop delivered** (calls new endpoint, confirmation modal, notify-customer toggle defaulting ON).
- See chat thread for the layout sketch; will land as a follow-up `/design-engineer` mockup before code.

### Acceptance criteria
- [ ] Clean-bucket: identical behavior to today + post-write `displayStatus === "DELIVERED"` verified.
- [ ] Mixed-bucket: only DELIVERED stops fulfilled; FAILED stops tagged `ld_redelivery_pending`, no DELIVERED email.
- [ ] Held-bucket: `{ ok: false, status: "held", retryAfter }`, zero Shopify writes.
- [ ] Skip-bucket: `{ ok: false, status: "manual-review" }` with unmatched-stop summary.
- [ ] `addDeliveredEvent` return value checked; `shopifyFulfilled` only increments when both fulfillment and event succeed.
- [ ] `partialDelivery: true` surfaced in response when `shopifyFulfilled !== deliveredEventsCreated`.
- [ ] `mark-stop-delivered` endpoint creates a single fulfillment + DELIVERED event, idempotent.
- [ ] `notifyCustomer` policy: ON for clean DELIVERED, OFF for FAILED, OFF for held.
- [ ] Regression fixture: Yasmin #78301 (4 DELIVERED + 1 FAILED) → 4 fulfillments + 1 redelivery-pending tag, no FAILED email.
- [ ] Regression fixture: Beatriz #77793 → `mark-stop-delivered` clears the order with `displayStatus === "DELIVERED"`.
- [ ] Regression fixture: clean route where prior `addDeliveredEvent` silently failed → `partialDelivery: true` instead of false success.

---

