# **Local delivery** backlog

## Route optimization

### Assignment logic
- *DO NOT EVER* add orders tagged with 'ld_failed-dalivery' to any route
- *DO NOT EVER* add orders tagged with 'ld_address-confirmation' to any route

### Traffic_aware config
- drop for **ALL** calls: Lalamove already uses traffic_aware on their side to optimize, so we do not need it
### route's polyline handling
- add 'Edit' + 'Confirm'/'Cancel' icon buttons to the map block

#### 'Edit':
- visible by default
- when clicked:
  - unlocks drag+drop feature
  - formats all current polylines as dotted and subdued colors
  - Edit button itself disappears to reveal 'Confirm' + 'Cancel'
#### 'Confirm':
- hidden by default
- visible when 'Edit' is clicked
- when clicked:
  - calls API to recalculate routes (no traffic_aware)
  - new routes polylines are rendered in default format
  - previous routes polylines are erased completely
#### - 'Cancel': 
- hidden by default
- visible when 'Edit' is clicked
- when clicked:
  - clears all changes made since last auto-assignment or last click on *Confirm*
  - original routes polylines are rendered back in the default format

## Address errors management
- add the *parsing/correction process* built at Nami Works, to manage trivial corrections automatically
- for cases that the *parsing/correction process* can't handle
  - if issue is **duplicated number**: both number in adr1 and adr2 are equal (eg.: "Endereço: Rua Forte William, ⁠11; Complemento: 11 Matizes, ⁠Panamby), add tag 'ld_number-confirm' to the order
  - if issue is not **duplicated number**:  add tag 'ld_address-confirm' to the order
- study how to leverage addresses from previous orders to confirm an order is correct
   eg: I've seen a suspect order by a customer who placed another few days prior, and we confirmed it was right; we should assume it is right (what are the rules for that?)

### "Potential address errors: n" badge
- make the badge visible when 'All locations' is selected
- rewire the modal to:
  - display a list of orders with address errors, with *no per-order* CTA
  - wire a single primary button "Fix addresses", that when clicked:
    - opens *a new tab* with Shopify's native order list view, filtering all orders containing the tag 'ld_address-confirm'
      - the goal here is to allow users to fix all orders at once, instead of opening each order in a new window, since the order list allow address editing

## UI/UX adjustments
- Verify logs from 05-05-26 16h15 BRT to understand 502 error
### Orders and routes status:
- Standardize all badges:
  - "[icon] Failed delivery: 2"
    - icon: *alert-octagon* Shopify web-component
    - <s-badge tone="warning">
    - ": n" instead of "(n)"
  - "[icon] Potential address errors: 1" > no change 
  - "[icon] Shipment requests to process (6)" > completely remove *UI and logic* from codebase
  - "[icon] Orders to deliver: 17" > suggest icon; blue info bagde
    - icon: suggest a Shopify web-component;
    - <s-badge tone="info">
    - ": n" instead of "(n)"
- Dispatching UI feedback: "Dispatching: 1/3" > remove space before and after "/"
- Per-route cards
  - Place delivery status bagdes ("Looking for driver", "Driver heading to pickup") at the same row as the main action button, to the left of the button
  - Move secondary actions inside a per-route action menu ("Manage", "Details", "Clear route")
    - **Preserve the visibility logic** (when each button must be displayed/hidden); only the placement of buttons change
- Expanded layout
  - Render sidebar blocks (*Route manager* and *Auto-assign accuracy*) at the same relative positions to the main block

### Analytics aside block
- Replace the simple "View analytics" button (currently in the LD page header) with a full aside block surfacing main analytics inline:
  - Headline metric (total savings) visible without clicking through
  - "See more" button leading to the full `/app/local-delivery/analytics` panel
- Goal: make the value of the analytics panel obvious from the LD operational page, instead of hiding it behind a single button click

## Route dispatching
- Verify why 'Dispatch all' button is not working and propose a fix
- Suggest  field mapping to update order's delivery status on Shopify according to Lalamove's status
   - notes: we will use this to trigger new whatsapp messages
     - with order tracking for user when status = deliery on the way
     - requesting address confirmation for user when status = failed delivery

## Performance / reliability — LD loader (`/app/local-delivery`)
*Migrated from `inputs/ideas-backlog.md` on 2026-05-08.*

Diagnosed 2026-05-07 after a single 502 on `/app/local-delivery.data` at 22:12:26 UTC. Container did NOT crash; the 502 is upstream connection close mid-stream, not 504 timeout.

**Symptom:** every fire of the LD loader takes ~14–17 seconds. ALB returns 502 when overlapping concurrent loader fires + cron-pool contention causes one request to close prematurely. From CloudWatch (8 successful fires preceded the 502, all 14–17s):
```
22:10:31  /app/local-delivery.data  200  15.9s
22:11:43  /app/local-delivery.data  200  15.5s
22:12:16  /app/local-delivery.data  200  16.6s
22:12:26  /app/local-delivery.data  502   9.6s   ← upstream closed mid-stream
```

**Root causes (compound):**
1. **Loader is slow — ~15s per fire.** Likely culprits: `pendingDeliveryRoute.findMany` + `lalamoveDispatchJob.findMany` + `shopOrder.findMany` joined with `lalamoveDispatchOrderMap` for the map markers. No per-query latency telemetry today.
2. **Aggressive auto-revalidation pile-up.** React Router's `useRevalidator` fires a fresh `.data` fetch on every action submission. With a 15s loader, eight loaders can be in flight concurrently within ~2 minutes. Saturates the Node event loop + Prisma pool.
3. **Three `shop-ingest:reconcile` crons finished simultaneously** at 22:11:16–34, each having run ~19 minutes. They burn DB connections + memory and all hit the same hourly cron tick. The 502 fired ~52s after they completed, while the tail was still draining.

**Fix plan (rank-ordered, single chore branch when in-flight branches close):**

| # | Fix | Effort | Impact |
|---|---|---|---|
| 1 | Speed up the LD loader. Add per-query `durationMs=` logging in `app/routes/app.local-delivery.tsx` loader following the `CLAUDE.md` "Logging" `[module:context]` convention. Profile and rewrite the slow queries (likely candidates: paginated joins, missing indexes, N+1 patterns in the order-marker projection). Target: median loader latency < 2s. | M | High |
| 2 | Stagger the 3 `shop-ingest:reconcile` crons. Today they fire from a single hourly tick. Chain sequentially OR split into separate EventBridge schedules (orders @ :00, customers @ :20, products @ :40). Removes the 18-second contention window every hour. | S | High |
| 3 | Throttle auto-revalidation on LD route — debounce concurrent `.data` fetches so an action mid-loader doesn't trigger a parallel loader. Coalesce into a single revalidation when the prior one returns. | M | Medium |
| 4 | Idempotent `orders/create` auto-routing webhook handler. Same orderId triggers 2–4× per Shopify retry burst (observed: order `7207971422528` triggered 4 times in 4 min). Add an `AutoAssignLog` lookup at the top: if a row exists for the order in the last N seconds with status `assigned`, no-op. | S | Medium |
| 5 | Lalamove escalation: GET order status before bumping priority fee. The escalation cron threw `422: You are trying to add priority fee beyond allowable order status(es)` at 22:05:12 — driver was already past the priority-fee-eligible window. A pre-check would prevent the 422. | S | Low |
| 6 | Prisma connection pool sizing review. If `connection_limit` is still default and #1 doesn't fully solve it, bumping the pool (or moving long-running crons to a read replica) would let user-facing loaders breathe through cron storms. | S | Low (band-aid for #1) |

**Sequencing:** #1 + #2 first as a single chore branch — they're the actual root cause and measurable (median latency, 502 count). #3 is a hardening follow-up. #4 + #5 can ride along whenever LD is next touched. #6 only if needed after #1.

**Adjacent finding (not 502-related, flag don't fix):** `[shop-ingest:reconcile]` jobs threw a burst of `401 Unauthorized` from Shopify at 21:51:34–21:51:43 (~30 errors in 9s). Likely token refresh storm or per-shop rate limit hitting all reconcile workers in parallel. Worth a separate audit when integrations sessions free up.

## Deployment ops
*Migrated from `inputs/ideas-backlog.md` on 2026-05-08. Lives here because the incidents that motivated these are LD-deploy-driven, but the fixes apply to every app deploy.*

### `deploy.ps1` pre-flight Docker health check
- **Why:** 2026-05-08 — Docker Desktop's WSL VM crashed mid-deploy with a SIGBUS bus error during the Vite SSR bundle build (`EIO: i/o error` on `/tmp/esbuild-*.code` first, then the named pipe `dockerDesktopLinuxEngine` disappeared on retry). The script ran `docker build` for ~20s before hitting the wall, then surfaced confusing "Docker build failed. Aborting deploy." with no diagnosis. A pre-flight check would have failed in 1s with a clear "Docker engine unreachable, fix it before continuing" message.
- **What it'd do:** add a small first step in `scripts/deploy.ps1` (before the build) that runs `docker info` (or `docker version`), captures the exit code, and short-circuits with a friendly error if Docker is unreachable. Optionally also check Docker Desktop's allocated memory via `docker info --format '{{.MemTotal}}'` and warn if < 6 GB (the SSR build is memory-heavy and OOM-mapped pages can SIGBUS).
- **Effort:** ~10 lines of PowerShell. Single chore branch.
- **Wire-in:** also call `scripts/disk-watch.ps1 -Check` (see below) before the build — same fail-fast principle for the disk-full case.
- **Out of scope:** retry logic, auto-restart Docker Desktop, memory-limit hints on the build itself.

### Disk monitor + Docker VHDX reclaim script (proposed)
- **Why:** 2026-05-08 follow-up to the VHDX-fills-disk incident — `docker_data.vhdx` grew to 228 GB, filled C:, Docker Desktop crashed with SIGBUS. The recovery (stop Docker → `wsl --shutdown` → delete VHDX) reclaimed 228 GB but cost ~30 min of incident response + a cold-cache rebuild on the next deploy. A scheduled cleanup running before the disk fills would prevent the outage.
- **What it'd do:** new `scripts/disk-watch.ps1` with three modes:
  - **`-Check` (default, no mutations):** report `Get-PSDrive C` free space + `docker_data.vhdx` size + `docker system df`. Exit `0` if free > threshold (default 30 GB), exit `2` if below — suitable for Task Scheduler email-on-failure.
  - **`-Cleanup`:** ladder of progressively-destructive reclamations, each gated on free-space measurement:
    1. `docker system prune -af --volumes` — removes unused images, containers, networks, volumes. Doesn't shrink the VHDX itself, but stops it from growing.
    2. If still < threshold AND `Optimize-VHD` is available (Hyper-V module): stop Docker → `wsl --shutdown` → `Optimize-VHD -Path <vhdx> -Mode Full` → restart Docker. Compacts the VHDX in place, preserves cached images.
    3. If still critical (< 5 GB) AND `-Force` flag passed: nuke the VHDX entirely (the playbook from today). Otherwise exit with "manual intervention required".
  - **`-Schedule`:** registers a Windows Task Scheduler entry running `-Check` weekly Mondays 9 AM BRT (matches the lint-cleanup cadence). Balloon notification on threshold trip.
- **Effort:** M (~80–120 lines of PowerShell + a small Task Scheduler XML). Single chore branch.
- **Out of scope:** automatic VHDX nuke without `-Force` opt-in (too destructive); cross-platform support (deploy box is Windows-only).
- **Sequencing:** ship `disk-watch.ps1 -Check` first as a standalone script, register the schedule, then add the `deploy.ps1` wire-in. Don't add `-Cleanup` automation until `-Check` has run for a few weeks and we have a feel for the threshold + cadence.

