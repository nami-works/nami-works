# Local Delivery Playbook — GE Beauty

You (a Claude Code session running in `nami-works/`) can drive GE Beauty's entire same-day delivery pipeline — cluster orders into routes, dispatch drivers on Lalamove, watch them approach pickup, decide whether to reorder, close routes, and fulfill orders in Shopify. This file tells you how to do that safely without the embedded UI.

Read this top-to-bottom the first time a user asks anything about Local Delivery, dispatch, routes, Lalamove, or `ld_rota-*` tags. Skim the relevant section on repeat visits.

---

## 1. Mental model

### Three layers

| Layer | Where it runs | What it owns |
|---|---|---|
| **Server** — VRP optimizer, Lalamove adapter, HTTP API | `cpg-labs` repo, deployed at `omnify.cpg-labs.io/full` (AWS ECS) | Clustering logic, driver quoting/dispatch, route state, tag writes |
| **HTTP control surface** — `/api/control/*` | Same deploy, bearer-auth | One intent per URL (`optimize`, `dispatch`, …) |
| **Operator client** — `cpg_control.py` | This workspace (`gebeauty/scripts/`) | CLI wrapper, map download, JSON printing |

You are the operator. You call `cpg_control.py` subcommands, read the JSON responses, look at the downloaded route-map PNGs, and decide what to do next. You never write TypeScript or server-side code from this workspace — that lives in the cpg-labs repo. If a server-side bug blocks you, report it back to the user so they can open the cpg-labs repo.

### Route state model — tags, not Shopify fulfillments

- An order becomes "on route 03" when it carries the Shopify tag `ld_rota-03`. That tag is the route assignment. No Shopify fulfillment is created at this point — the order stays **Unfulfilled** in Shopify admin.
- A route has up to 20 slots, numbered `ld_rota-01` .. `ld_rota-20`. In the API, these are **0-based indexes**: route 01 → `routeIndex=0`, route 07 → `routeIndex=6`. The CLI takes the 0-based index too.
- Dispatching a route means a Lalamove driver is quoted + placed against the set of orders carrying that tag.
- When the route completes, tags are archived: `ld_rota-03` → `ld_rota-03_YY.MM.DD`. This happens automatically during `check-dispatches` when the Lalamove order transitions to COMPLETED. After archival, slot 3 is free for the next day.
- The Shopify fulfillment + DELIVERED event are created separately by `fulfill-route` (Phase B) — intentionally gated so a human can confirm before orders flip to Fulfilled.

### Two driver-paths share the same slots

There is an **auto-delivery cron** on the server that, on locations with `autoDeliveryEnabled: true`, runs `optimize` every 5 minutes after an order-cutoff time and fires `dispatch` at a configured hour. This is the hands-off flow.

Claude-driven runs via this client use the **same slots and same tags**. That means:

- Always call `state` first to see what's already assigned or dispatched before you optimize or dispatch.
- If cron already dispatched `ld_rota-01`, do not dispatch it again. `state` will show `dispatch.status: "ASSIGNING_DRIVER"` or similar.
- `check-dispatches` works across both paths — it polls live driver position for every active Lalamove order regardless of who placed it.

---

## 2. Setup — verify before you do anything

```bash
# From repo root
cat gebeauty/.env | grep -E "^CPG_LABS_CONTROL_(URL|TOKEN)=" | sed 's/=.*/=***/'
```

You should see both `CPG_LABS_CONTROL_URL=***` and `CPG_LABS_CONTROL_TOKEN=***`. If either is missing, populate from SSM:

```bash
npx tsx scripts/ssm-to-env.ts --tenant gebeauty
```

Python: `C:/Python314/python.exe` on Windows, `python3` elsewhere. No dependencies needed — `cpg_control.py` uses stdlib `urllib` only.

Smoke test (read-only, safe to run anytime):

```bash
python gebeauty/scripts/cpg_control.py check-dispatches
```

Expected output shape:
```json
{
  "ok": true,
  "checkedAt": "2026-04-23T17:22:14.551Z",
  "dispatches": [],
  "elapsedMs": 312
}
```

An empty `dispatches: []` with `ok: true` means auth works and nothing is currently dispatched. If you see `{"ok": false, "error": "Missing..."}` the `.env` is wrong or stale.

---

## 3. Locations

GE Beauty has 4 physical stores that act as pickup points: **Recife (2 locations)**, **São Paulo**, **Rio de Janeiro**. Each has its own Lalamove config, pickup coordinates, timezone, and auto-delivery settings.

**You do not need to memorize the location GIDs.** Ask the user which store they mean, or enumerate what's active:

```bash
python gebeauty/scripts/cpg_control.py check-dispatches
```

The response lists `locationId` per active dispatch. For a full inventory, run `state` against each suspected location and collect the `location.name` + `location.id` fields from the response.

Location IDs are Shopify GIDs: `gid://shopify/Location/97784398144`. Legacy numeric IDs (just `97784398144`) are also accepted — the server normalizes both. Always pass the full GID when you have it — it's unambiguous.

---

## 4. Command reference

Every subcommand is `python gebeauty/scripts/cpg_control.py <subcommand> [args]`. Shortened below to `cpg <subcommand>`.

### state — read what's happening

```bash
cpg state --location gid://shopify/Location/97784398144
cpg state --location gid://shopify/Location/97784398144 --live
```

`--live` refreshes each active Lalamove order from the carrier API (+1-2s per dispatched route) — use when you need current driver status. Without `--live` the response is DB-cached (stale up to ~5min for in-flight routes).

**Response shape** (trimmed):
```json
{
  "ok": true,
  "shop": "ge-beauty-cosmeticos.myshopify.com",
  "location": {
    "id": "gid://shopify/Location/97784398144",
    "name": "São Paulo — Itaim Bibi",
    "address": {...}
  },
  "routes": [
    {
      "slot": 0,
      "tag": "ld_rota-01",
      "orders": [
        { "id": "gid://...", "name": "#12345", "customer": "...",
          "address": { "line1": "...", "lat": ..., "lng": ... },
          "total": { "amount": "189.50", "currencyCode": "BRL" },
          "tags": ["ld_rota-01", ...], "note": null }
      ],
      "dispatch": {
        "lalamoveOrderId": "...",
        "status": "ASSIGNING_DRIVER" | "ON_GOING" | "COMPLETED" | "CANCELED" | null,
        "shareLink": "https://share.lalamove.com/...",
        "driverId": "...",
        "priceBreakdown": { "total": "42.30", "currency": "BRL", "base": "..." },
        "refreshed": true
      }
    }
  ],
  "addressReview": [ /* orders tagged ld_address_review */ ],
  "refreshedDispatches": 2
}
```

Read carefully:
- `routes[].orders[].address.lat` / `.lng` is null when Shopify couldn't geocode. An order without coords will NOT be picked up by `optimize` — it needs address repair first (see §8 Failure modes).
- `routes[].dispatch` is `null` when the route has orders but no driver has been requested yet. It's populated once `dispatch` runs.
- `addressReview` lists orders tagged `ld_address_review` — these were flagged during a prior optimize run as having a bad street address. They won't cluster until fixed.

### optimize — cluster unassigned orders into routes

```bash
cpg optimize --location gid://shopify/Location/97784398144
cpg optimize --location gid://shopify/Location/97784398144 --max-per-route 5
```

Pulls every **unassigned LOCAL** order at the location (local-delivery fulfillment type, unshipped, no `ld_rota-*` tag yet, no `ld_address_review` tag), runs the VRP pipeline, writes `ld_rota-NN` tags, and returns the clustering.

**Server default `maxPerRoute` is 7** (the hard driver-capacity cap). The `--max-per-route` flag's help text says "default 10" — that's stale; the server enforces 7 when the flag is omitted. Pass `--max-per-route 5` or lower if a user wants smaller clusters for a test run. **Never pass anything >7.** See §6.

**After optimize succeeds, the client auto-downloads Google Static Map PNGs** to `gebeauty/route-maps/YYYY-MM-DD/<location>.png`. One PNG per location. You must Read each PNG before proposing dispatches. See §6.

Response shape:
```json
{
  "ok": true,
  "location": "gid://...",
  "orders": 14,
  "flagged": [
    { "id": "gid://...", "name": "#12300", "issue": "Missing street number" }
  ],
  "routes": [
    { "slot": 0, "tag": "ld_rota-01", "orders": [{ "id": "...", "name": "#12301" }] },
    { "slot": 1, "tag": "ld_rota-02", "orders": [...] }
  ],
  "elapsedMs": 8421,
  "routeMaps": ["C:/.../gebeauty/route-maps/2026-04-23/são_paulo.png"]
}
```

Timing: ~1.6s per order. 8-9 orders takes 7-12s; 20+ orders can take 60s+. The ALB idle timeout is 90s — on very large batches you may see a timeout even though the optimize completed server-side. If that happens, run `state` to observe the applied tags.

`flagged[]` lists orders tagged `ld_address_review` (server adds the tag when address validation fails — missing street number, placeholder ZIP, etc.). These need manual repair before they can be optimized. Pass `--no-flag-addresses` to skip this tagging (rare; use only when diagnosing why orders aren't clustering).

### quote — price-check a hypothetical clustering (read-only)

```bash
cpg quote --location gid://... \
  --route "gid://shopify/Order/1,gid://shopify/Order/2,gid://shopify/Order/3" \
  --route "gid://shopify/Order/4,gid://shopify/Order/5"
```

Prices each clustering via Lalamove's `/v3/quotations` endpoint without placing an order. Use to A/B test alternative route compositions before dispatching. Repeat `--route` once per proposed cluster; each `--route` takes a comma-separated list of order GIDs.

Response gives `routes[].total` per route and `grandTotal` — the sum across all clusters. A good sanity check: optimize-as-is vs. optimize-with-your-manual-swap. Pick whichever is cheaper while still respecting §6 rules.

### unassign — strip a route tag

```bash
cpg unassign --route ld_rota-02 --orders gid://shopify/Order/1 gid://shopify/Order/2
```

Removes the tag from those orders. They fall back into the unassigned pool and will be picked up by the next `optimize` call (or by the cron's next run).

Use when:
- You want to rebalance after optimize but before dispatch (move one order from `ld_rota-02` to `ld_rota-03`).
- An order shouldn't have been clustered (last-minute cancellation, address issue surfaced late).

Do NOT use after dispatch — once a Lalamove order is placed with those stops, unassigning the tag doesn't cancel the Lalamove order. Use `reorder` instead.

### dispatch — place a Lalamove order for one route

```bash
cpg dispatch --location gid://... --route-index 0
```

Quotes the route via Lalamove, places the order, writes `LalamoveDispatchJob` + `LalamoveDispatchOrderMap` rows, and returns the dispatch details.

**This spends money.** The user must approve each dispatch unless they explicitly delegate a batch. Default posture: run `state`, summarize cost per route (from the `quote` preview or from the optimizer's returned `lalamove` field), ask the user which routes to dispatch, then fire them one at a time.

The route index is 0-based: `--route-index 0` dispatches `ld_rota-01`.

Response includes the Lalamove order ID, share link, driver info once assigned, and the price breakdown.

Idempotent per `(shop, locationId, routeId, day)` — re-running returns the existing dispatch rather than placing a duplicate. Safe to retry on network hiccup.

### check-dispatches — poll driver GPS across all in-flight routes

```bash
cpg check-dispatches
```

No arguments — scans every non-terminal `LalamoveDispatchJob` in the last 24h across all locations. For each `ON_GOING` dispatch with an assigned driver it:

1. Refreshes Lalamove order status (persists if changed).
2. If status just transitioned to COMPLETED: **auto-archives route tags** (`ld_rota-NN` → `ld_rota-NN_YY.MM.DD`). This is Phase A of the close — no Shopify fulfillment is created yet.
3. Computes haversine distance driver → pickup, compares to previous sample, updates `approachFailCount`.
4. If `approachFailCount ≥ 3` and past the 4-minute grace window, suggests `"reorder"`.

Response shape:
```json
{
  "ok": true,
  "dispatches": [
    { "routeId": "gid://.../Location/97784398144-0",
      "lalamoveOrderId": "...",
      "status": "ON_GOING",
      "driverId": "...",
      "distanceM": 1840,
      "deltaM": -310,
      "approachFailCount": 0,
      "suggested": null,
      "ok": true }
  ]
}
```

Run periodically during active delivery windows (every 3-5 min is reasonable). When `suggested: "reorder"` appears, surface it to the user with context (route ID, driver ID, current distance, how long the driver has been stationary) and ask whether to reorder.

### reorder — cancel current driver and request a new one

```bash
cpg reorder --location gid://... --route-index 0
```

Cancels the active Lalamove order for this route (at Lalamove AND in DB), then calls `dispatch` again to request a fresh driver. Orders + stops + route composition stay the same; only the driver changes.

**This costs money** (a second dispatch). Only fire on user approval or after `check-dispatches` has returned `suggested: "reorder"` for 3+ consecutive samples. Don't reorder on a single non-approach sample — drivers stop at lights, route-select, get stuck in traffic.

### render-routes — re-render the route-map PNGs manually

```bash
cpg render-routes --location gid://...
cpg render-routes   # all active-route locations
```

`optimize` already downloads these automatically. Use `render-routes` standalone when:
- You want to regenerate after a manual `unassign` + re-tag.
- Something failed in the auto-download and `routeMaps` is empty in the optimize response.
- You want to review the current assignment without re-optimizing.

Output goes to `gebeauty/route-maps/YYYY-MM-DD/<location>.png`. Folders older than 30 days are auto-pruned.

**Marker legend:**
- Pickup: black **P**
- Routes 1-7: red, blue, green, orange, purple, yellow, brown — matches `ld_rota-01..07` in order
- Orders within a route: labeled A, B, C, … in Shopify-ID order

### close-route + fulfill-route — two-phase delivery close

```bash
cpg close-route  --location gid://... --route-index 0        # Phase A: archive tags + DB close
cpg fulfill-route --location gid://... --route-index 0        # Phase B: Shopify fulfillment + DELIVERED
```

**Phase A (`close-route`)** — archives `ld_rota-NN` → `ld_rota-NN_YY.MM.DD`, flips the dispatch job to FULFILLED in the DB. Does NOT create a Shopify fulfillment. Orders stay "Unfulfilled" in Shopify admin. Run this when you want to free up the slot without yet flipping order status.

Note: `check-dispatches` already auto-archives when the Lalamove order transitions to COMPLETED. You only need to call `close-route` manually if the Lalamove driver reports completion via some channel other than the Lalamove API status.

**Phase B (`fulfill-route`)** — creates one Shopify fulfillment per order in the route and adds a DELIVERED event. Assumes Phase A already ran. By default `--notify-customer` is off (no shipping email). Pass `--notify-customer` to send the email.

**For new Claude-driven workflows, use this two-phase flow.** The legacy single-shot `mark-delivered` is kept for backward compat.

### mark-delivered — legacy single-shot close

```bash
cpg mark-delivered --location gid://... --route-index 0
cpg mark-delivered --location gid://... --route-index 0 --keep-lalamove --skip-shopify-fulfillment
```

Does close + fulfill in one call (and optionally cancels any pending Lalamove order). Flags:
- `--keep-lalamove` — don't cancel the Lalamove order (default: cancels)
- `--skip-shopify-fulfillment` — don't create Shopify fulfillment (default: creates)
- `--notify-customer` — send customer email (default: off)

Prefer `close-route` + `fulfill-route` for new workflows — it's clearer to the user which step is happening.

### mark-all-today — bulk close every dispatch from the last 24h at a location

```bash
cpg mark-all-today --location gid://...
```

End-of-day cleanup. Iterates every dispatch job from the last 24h at the given location and runs the legacy single-shot mark-delivered on each. Useful when cron + Claude both ran dispatches and you want to close everything without picking through the list.

Uses a 24h sliding lookback, NOT strict UTC midnight — Brazil timezone straddles UTC boundaries and this avoids losing or double-counting routes.

---

## 5. Standard operating procedures

### SOP-1 — Morning dispatch (full flow)

The canonical flow when a user says "dispatch deliveries for Rio today" or similar:

1. **Orient.** Run `cpg state --location <gid>` to see current route state at that location. Identify:
   - Orders already on routes (from yesterday's leftovers, from cron, or from a prior Claude session)
   - Active dispatches (driver in flight — do NOT touch these)
   - Address-review orders (can't be clustered until fixed)
2. **Optimize.** If there are unassigned LOCAL orders and no active dispatches conflicting, run `cpg optimize --location <gid>`. Wait for it to complete. Note the returned `routes[]` and `flagged[]`.
3. **Read the map.** The optimize response's `routeMaps[]` lists the downloaded PNG paths. Read each PNG with your vision capability. Look for:
   - Orders on the wrong side of a water barrier or highway from their route-mates
   - Clusters that cross a dense-traffic corridor the centroid math missed
   - Anomalous single-point outliers that should be moved to a neighboring route
4. **Sanity-check with nearest-centroid.** For each order, compute which route's centroid it's closest to. If any order is assigned to a route whose centroid isn't its nearest, flag to the user — may indicate the optimizer's cost function made a suboptimal call. Real example (2026-04-21): this check caught a R$17.89 savings opportunity in Recife.
5. **Quote alternatives if needed.** If the map + nearest-centroid review suggest a swap, run `cpg quote --route "..." --route "..."` to compare the current clustering vs. your proposed swap. Present both totals to the user.
6. **Apply swaps (only with user approval).** If the user approves a swap, use `cpg unassign` to strip the current tag from the order(s), then re-tag via a follow-up `optimize` or via a direct Shopify `tagsAdd` mutation (if you need fine-grained control — but prefer re-optimize).
7. **Summarize cost per route and ask.** Present: per-route order count, per-route estimated cost, total across all routes. Ask the user to confirm which routes to dispatch. Default to all unless the user says otherwise.
8. **Dispatch.** Run `cpg dispatch --location <gid> --route-index N` one at a time. Read each response — confirm `lalamoveOrderId` is populated and `status` is `ASSIGNING_DRIVER`.
9. **Monitor.** Run `cpg check-dispatches` 3-5 minutes after the last dispatch. If every dispatch shows a driver id and either arrival-zone or decreasing distance, you're good. Surface any `suggested: "reorder"` to the user.
10. **Close at end of day.** Once all routes show COMPLETED (via `check-dispatches` live status or the `state --live` call), run `cpg fulfill-route` per route to create Shopify fulfillments. Tags were already archived by `check-dispatches`.

### SOP-2 — Driver not approaching pickup

When `check-dispatches` returns `suggested: "reorder"` for a dispatch:

1. **Don't reorder immediately.** Run `check-dispatches` 1-2 more times, 60-90s apart, to confirm the non-approach is persistent. A single stalled sample can be a traffic light or a stop.
2. **Present context to the user.** Current distance to pickup, distance delta across samples, how long the driver has been in flight, the share-link URL so they can see it in the Lalamove web UI.
3. **On user approval, run `cpg reorder --location <gid> --route-index N`.** Confirms the cancellation at Lalamove and requests a fresh driver. The route composition (orders + stops) stays the same.
4. **Monitor the new driver.** Run `check-dispatches` again in 3-5 min.

### SOP-3 — Manual swap between two routes

User asks: "move order #12345 from rota-02 to rota-03 — it's closer to the rota-03 cluster."

1. Confirm with `state` that `#12345` is currently on `ld_rota-02` and that rota-02 has NOT been dispatched yet.
2. **If dispatched, stop.** Once a Lalamove order exists, you can't cheaply restructure without canceling + requoting the affected route(s). Surface this to the user and suggest waiting for the current dispatch to complete, or fully canceling rota-02 via `reorder` + re-optimize.
3. If undispatched, `cpg unassign --route ld_rota-02 --orders <gid>`.
4. Add to rota-03 via a Shopify `tagsAdd` mutation (there's no dedicated subcommand for this — use `find_order` + direct GraphQL, or run a fresh `optimize` that will pick it up as unassigned).
5. Re-render the map with `cpg render-routes --location <gid>` and show it to the user.
6. Quote the new clustering with `cpg quote` to confirm the cost change is what you expected.
7. Proceed to dispatch on user approval.

### SOP-4 — End-of-day bulk close

After all routes have arrived + customer receipt confirmed (user tells you, or Lalamove shows COMPLETED):

1. Run `cpg state --location <gid> --live` to get fresh Lalamove statuses.
2. For each route with `dispatch.status: "COMPLETED"`, run `cpg fulfill-route --location <gid> --route-index N`. The tags were already archived by `check-dispatches`.
3. If routes are mixed (some COMPLETED, some canceled earlier, some still running), use `cpg mark-all-today --location <gid>` to bulk-close everything from the 24h window. Verify the response `fulfilled[]` list matches expectations.

---

## 6. Hard rules

These are user-enforced policies. Never deviate without explicit override per-session.

### 6.1 Max 7 orders per route

A single driver cannot carry or reliably drop off more than 7 packages — carrying capacity + identification-at-drop-off + pickup-time constraint. This is real operational data from GE Beauty's side.

- Never pass `--max-per-route` higher than 7 to optimize. Prefer omitting the flag (server default is 7).
- When reviewing the optimize output, reject any route with `orders.length > 7`. Split the excess into another route via `unassign` + `optimize`.
- When proposing A/B swaps via `quote`, reject any configuration where any route has >7 orders. Even if the clustering is geographically perfect.
- When the user overrides and asks you to create an 8+ route anyway, flag the rule, confirm they want to override, then proceed.

### 6.2 Read the route-map PNGs before dispatching

After every `optimize`, PNGs land in `gebeauty/route-maps/YYYY-MM-DD/`. Read each one with your vision capability. Apply spatial reasoning the centroid math misses:

- **Water barriers** — an order in Niterói should not be on the same route as Ipanema orders even if their centroids are close; the ferry/bridge adds 40+ min.
- **Highway crossings** — Marginal Tietê, Rio-Niterói bridge, Rebouças tunnel during rush hour turn short distances into long drives.
- **Neighborhood gravity** — a Zona Sul order grouped with Zona Oeste orders because of centroid placement is usually wrong; local geography matters more than coordinate distance.

If you spot one of these, run `cpg quote` to compare the current clustering vs. your proposed swap, then present both to the user.

### 6.3 Nearest-centroid sanity check

For each order, compute which route's centroid is closest to the order's coordinates. If any order is NOT on its nearest-centroid route, flag it. The optimizer sometimes prefers a farther route for tour-length reasons — which is valid — but surface the anomaly so the user can verify it was intentional.

This check has caught real money: 2026-04-21, a Recife rota-03 order was closer to rota-02's centroid, and re-quoting showed R$17.89 savings from the swap.

### 6.4 Confirm before money-spending

`dispatch` and `reorder` both spend money. Default posture:

- Never fire them without explicit user approval for this session.
- Approval can be batched ("dispatch all 4 routes for Rio") but not implicit.
- Always surface the per-route cost first, pulled from the optimize response's `lalamove` field or from a `quote` call.

`optimize`, `unassign`, `state`, `quote`, `check-dispatches`, `render-routes`, and `close-route` are all free and can run without per-call confirmation.

### 6.5 Don't fight the cron

Locations with `autoDeliveryEnabled: true` have a server-side cron running optimize + dispatch on a schedule. If you call `optimize` on such a location and the cron fires 3 minutes later with new orders, you get overlapping runs. Before a manual Claude-driven run:

- Check `state --live` to see what's already active.
- If the cutoff time for that location is in the past and cron already dispatched, don't re-dispatch the same slots.
- If the user wants Claude to override cron for today, tell them they need to disable auto-delivery for that location in the Shopify embedded app (or ask the user with cpg-labs access to do it) — there's no control-API endpoint for toggling that flag yet.

### 6.6 Brazil timezone

All the server's logging and windowing uses Brazil-local time (`America/Sao_Paulo`) for date-stamping archived tags. `mark-all-today` uses a 24h sliding lookback, not strict UTC midnight. When reasoning about "today's" routes near midnight BRT, always think in BRT, not UTC.

---

## 7. Observability & artifacts

Everything this workspace writes to disk:

| Path | What | Lifetime |
|---|---|---|
| `gebeauty/route-maps/YYYY-MM-DD/<location>.png` | Static map PNGs from each optimize run | Auto-pruned after 30 days |
| `gebeauty/shipping-journal/` | Dated markdown journal (see below) | Manual |

**Shipping journal:** Historically there was a plan for a standalone Python `shipping_journal.py` script — it never shipped in this workspace. The journal capability now lives as an MCP tool at `src/tools/shopify/shipping-journal.ts` in the nami-works project root, callable from sessions using the tenant's MCP server. If the user asks you to write a journal entry from this workspace and the MCP tool isn't available, a plain `Write` of a markdown file to `gebeauty/shipping-journal/YYYY-MM-DD.md` with the session's dispatch summary (locations, route counts, total spend, driver status per route, anomalies) is the acceptable fallback.

**Server-side logs:** Every control API call writes structured logs to CloudWatch:

```bash
aws logs tail /ecs/omnify-gebeauty --since 15m --region us-east-1
```

Look for `[control]` prefix. Every request logs `START`, `OK` (with counts), and `FAILED` (with error). When the CLI returns an obscure error, check CloudWatch.

---

## 8. Failure modes & recovery

### F-1 — optimize returns `flagged[]` with address issues

Orders are tagged `ld_address_review` when address validation fails (missing street number, placeholder ZIP, bad format). The `state` response lists them under `addressReview`.

**Recovery:**
1. Surface the flagged orders to the user with their current shipping addresses.
2. User will provide corrected addresses (often from WhatsApp / customer support).
3. Update the order via Shopify `orderUpdate` mutation (or guide the user to do it in Shopify admin).
4. Remove the `ld_address_review` tag via `tagsRemove` or inline GraphQL.
5. Re-run `cpg optimize` — the order will be picked up.

### F-2 — dispatch succeeds but driver never accepts

Lalamove returns `ASSIGNING_DRIVER` and it stays there for >10 min. The `check-dispatches` approach detection won't trigger (no driver, no GPS sample).

**Recovery:** Run `cpg reorder --location <gid> --route-index N`. This cancels the stuck order and requests a fresh one.

### F-3 — Lalamove returns an error on dispatch

Common causes:
- Missing `specialRequests` for a city within the market (special requests vary per city, not just per market — see the carrier service docs for the rule).
- Order addresses outside Lalamove's serviced area.
- A stop is geocoded to a location Lalamove considers inaccessible (e.g., far inside a favela with restricted access).

**Recovery:**
1. Check CloudWatch logs for the exact error message.
2. If it's a per-order issue, `unassign` the problematic order and re-optimize the rest.
3. If it's a config issue, surface to the user — they need to update the location config in the cpg-labs embedded app.

### F-4 — `route-maps/YYYY-MM-DD/*.png` is empty or `routeMaps` is empty in the response

The client couldn't download the Static Maps PNG (network issue, missing `GOOGLE_MAPS_API_KEY` on the server, or the server-side render-routes returned no URL).

**Recovery:** Re-run `cpg render-routes --location <gid>`. If it still fails, check the response for `"note"` fields — the server logs "missing pickup coords" or similar when the location config is incomplete.

### F-5 — tag archived but Shopify order still shows Unfulfilled

This is expected and intentional. Tag archival is Phase A (close-route); Shopify fulfillment is Phase B (fulfill-route). The user must explicitly fulfill. If a user says "the order shows delivered on Lalamove but still Unfulfilled in Shopify", that means Phase A ran (automatically via check-dispatches) but Phase B hasn't. Run `cpg fulfill-route --location <gid> --route-index N`.

### F-6 — "Unknown intent" error from CLI

The client sent an intent the server doesn't handle. This means the cpg-labs server is older than the CLI — the `.env`'s `CPG_LABS_CONTROL_URL` points at a stale deploy, or a new intent was added to the client but the deploy lag hasn't caught up. Confirm with `curl -s $CPG_LABS_CONTROL_URL/healthz` (or equivalent) and surface to the user.

---

## 9. What NOT to do

- **Don't call Lalamove's API directly from this workspace.** Always go through `/api/control/*`. Credentials are server-side only.
- **Don't write route-assignment tags (`ld_rota-*`) directly via Shopify GraphQL.** Tag writes must go through `optimize` so the correction-tracking snapshot gets recorded and the route cache stays consistent.
- **Don't create a route with >7 orders** even if the user asks, without flagging the rule and getting explicit override.
- **Don't dispatch, reorder, or fulfill without confirmation.** These are the three money/customer-visible actions.
- **Don't modify `cpg_control.py` to add new subcommands from this workspace.** The server-side handler lives in the cpg-labs repo. Tell the user you need the cpg-labs repo to extend the API.
- **Don't try to toggle auto-delivery from here.** There's no endpoint; the user must do it in the embedded app.
- **Don't assume cron and Claude won't collide.** They can and do share slots. Always `state` first.
- **Don't write to `.env`** or try to rotate the bearer token from here. The token comes from SSM (`/omnify/CLAUDE_CONTROL_TOKEN`).

---

## 10. Cross-reference

Server-side code lives in the cpg-labs repo (on disk at `Desktop/cpg-labs/`):

| Concern | File |
|---|---|
| Control API handlers | `app/routes/api.control.$intent.tsx` |
| Bearer auth | `app/services/claude-control-auth.server.ts` |
| VRP optimizer | `app/services/carrier-quotation-optimizer.server.ts` |
| Lalamove adapter | `app/services/carrier/lalamove-adapter.server.ts` |
| Auto-delivery cron | `app/routes/api.cron.auto-delivery.tsx` |
| Route optimizer handover doc | `docs/handover-route-optimizer.md` |
| Carrier services reference | `docs/carrier-services.md` |

If a question requires reading or editing any of those files, the user needs to switch you to the cpg-labs workspace. From here, your surface is HTTP-only.
