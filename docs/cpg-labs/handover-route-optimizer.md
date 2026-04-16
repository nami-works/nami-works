# Session Handover — Route Optimizer (2026-04-09 through 2026-04-12)

## What was done

This was a multi-day iterative session focused on improving the VRP route optimizer in `app/services/carrier-quotation-optimizer.server.ts`. Changes were driven by analyzing real correction data from production — comparing what the optimizer proposed vs what the user dispatched.

### Corrections tracking fix
- **Stale snapshot bug** — correction tracker now only compares against snapshots from the last 4 hours (was comparing against all-time most recent, producing ghost corrections with null coordinates)

### Route clustering improvements
- **12km max-spread constraint** — routes exceeding 12km haversine spread between any two orders get split via 2-means bisection. Enforced at 4 pipeline stages: Phase 2c, Phase 3 conditional insertion, Phase 4b relocate, and consolidation
- **Distance-matrix-based spread** — `clusterSpread()` now accepts optional `(matrix, idxMap)` params and uses real Google driving distance when available. Critical for Rio (Guanabara Bay makes haversine understate by 2-3x). Falls back to haversine when matrix isn't available
- **Solo routes allowed** — `enforceMinOrdersPerRoute` no longer force-merges isolated orders if the nearest route would blow the spread constraint. Barra da Tijuca-type orders stay solo

### Phase 5b: Detour-cost refinement (NEW pipeline phase)
- Runs after polylines are rendered, before the final summary
- For each order: computes `removal_saving_from_src - insertion_cost_to_dst` using nearest-neighbor TSP estimation (`estimateRouteTotalDistance`)
- Relocates if net gain exceeds adaptive threshold
- **Adaptive threshold**: `max(150, min(300, orders * 15))` meters. 8 orders = 150m, 20 orders = 300m. Derived from correction data showing small batches have subtle border-zone differences
- **Solo-route dissolution**: size-1 routes can donate their order. Adds a R$14 base-fee reward (5000m equivalent) to the gain. Spread constraint relaxed 1.75x for dissolution moves
- 3 iterations max, 1 move per route per iteration, re-renders polylines + re-quotes Lalamove after each batch of moves
- **Key bug caught and fixed**: the original polyline-distance approach had `distanceToPolyline(order, ownPoly)` always returning ~0 because the order is itself a waypoint on its own polyline. Replaced with TSP-based detour cost

### Consolidation tolerance
- Consolidation now accepts route merges up to R$3 (300 subunits) more expensive than separate. Rationale: fewer dispatches = less operational overhead

### Split Routes feature removal
- Removed the "Split routes" button, action handler, fetcher, state, i18n string, and the `splitRoutesByDepotDistance` + `trySplitSegmentByDepot` + `detectSplitCandidates` + `clarkeWrightSavings` + `splitTourByGaps` functions. Phase 5b now handles splitting automatically
- Removed `hasSplitCandidates` from `VRPQuotationResult` type

### Infrastructure
- **ALB idle timeout**: 60s -> 90s (`infra/terraform/alb.tf`). Applied via `terraform apply -target=aws_lb.app`
- **ASCII log characters**: replaced Unicode arrows and em-dashes in console.info calls with `->` and `--` (Windows AWS CLI crashes on non-cp1252 characters)

## Key decisions

- **12km was chosen from correction data**: routes with >15km spread were consistently split by the user. 12km is conservative to avoid borderline cases
- **Solo dissolution 1.75x factor**: user accepted ~17km spread when absorbing a solo order in SP. Rio with bay may need stricter tuning — the distance-matrix-based spread now partially addresses this
- **Detour cost over polyline distance**: polyline proximity was the initial approach but had a fundamental flaw (own-polyline distance always ~0). TSP-based detour is correct and doesn't require polylines at all — no extra API cost
- **R$3 consolidation tolerance**: derived from SP correction where user merged two 3-order routes that Lalamove quoted marginally higher combined. The operational cost of managing extra dispatches justifies accepting a small cost increase
- **Adaptive threshold**: 300m was too strict for 8-9 order batches where border-zone differences are 50-200m. Formula `orders * 15` scales naturally

## What's pending

### Optimizer UX for long runs (NEXT SESSION FOCUS)

The optimizer currently blocks the UI synchronously. For large batches this causes ALB timeouts and poor UX. The next session should build a more user-friendly approach.

**Timing data from production (last 3 days, 10 runs):**

| Orders | Routes | Duration | Per-order |
|--------|--------|----------|-----------|
| 3 | 1 | 4.0s | 1.34s |
| 5 | 1-2 | 8-11s | 1.77-2.25s |
| 8-9 | 3 | 7-12s | 0.88-1.46s |
| 13 | 4 | 15.9s | 1.22s |
| 20 | 5 | 29.3s | 1.47s |
| 22 | 5 | 61.1s | 2.78s |

**Key observations:**
- **Average per-order time: ~1.6 seconds** across all batch sizes
- **The 22-order run (61s) is the only one that exceeded the ALB timeout** (now 90s). It had 2.78s/order — higher than average because Phase 5b did 4 relocations across 3 iterations, each requiring polyline re-renders + Lalamove re-quotes
- **Under 10 orders: always under 12 seconds** — no UX issue
- **10-20 orders: 15-30 seconds** — noticeable but tolerable
- **20+ orders: 30-60+ seconds** — needs async handling

**Where the time goes in a 22-order run (~61s):**
- Phase 1 (Distance Matrix): ~2.4s (9 chunks of 10x10)
- Phase 2a-2c (TSP + split + spread): <1s
- Phase 4 (Lalamove quoting per route, ~5 routes): ~15s
- Phase 4b (local search relocate): ~5s
- Phase 5 (polyline rendering, ~5 routes): ~10s
- Phase 5b (detour refinement, 3 iterations x re-render + re-quote): ~25s

Phase 5b is the new bottleneck for large batches. Each iteration re-renders polylines (1 Google Routes API call per touched route) and re-quotes with Lalamove (1 API call per touched route per vehicle type).

**Recommended approach for next session:**
- Make optimize-fleet **async**: return immediately with a "calculating..." state, poll for completion
- Show a progress indicator with phase labels ("Building distance matrix...", "Optimizing routes...", "Refining assignments...")
- OR: cap Phase 5b iterations to 2 for batches > 15 orders (saves ~8-12s)

### Other pending items
- **Per-city spread threshold auto-tuning** — collect 2+ weeks of clean correction data, compute P75 of accepted route spreads per location, store as DB column
- **Terraform ALB change committed but not git-pushed** — `idle_timeout = 90` is applied to infra but the `alb.tf` change needs committing (it's in the working tree diff)

## Modified files

### Complete (deployed)
- `app/services/carrier-quotation-optimizer.server.ts` — all optimizer changes
- `app/routes/app.local-delivery.tsx` — stale snapshot fix, Split routes removal
- `app/i18n/locales/en/local-delivery.json` — removed `splitRoutes` key

### Complete (applied via Terraform)
- `infra/terraform/alb.tf` — `idle_timeout = 90` (needs git commit)

### Not touched (unchanged from other sessions)
- `app/utils/polyline.server.ts` — existing polyline decode/distance utilities. Phase 5b no longer uses `distanceToPolyline` but the utilities remain for other consumers (map rendering)

## Current state

All changes are deployed to production (`omnify-gebeauty-task:168`). The ALB timeout is live at 90s. To verify:
1. Open Local Delivery in Shopify admin
2. Select SP location with 8+ orders
3. Click "Auto-assign" — should complete in <15s
4. Check ECS logs: `aws logs filter-log-events --log-group-name /ecs/omnify-gebeauty --filter-pattern '"detour refinement"'` should show threshold and order count

## Context the next session needs

- **The optimizer file is ~1900 lines.** Key function is `optimizeByVRP()` starting around line 1500. The pipeline is: Phase 1 (distance matrix) -> Phase 2a (TSP) -> Phase 2b (max-stop split) -> Phase 2c (max-spread enforcement) -> Phase 3 (conditional insertion) -> Phase 4 (min-size enforcement + Lalamove quoting + consolidation) -> Phase 4b (local search relocate) -> Phase 5 (polyline render) -> Phase 5b (detour-cost refinement) -> cache + summary
- **Correction tracking** lives in the `lalamove-place-order` intent handler in `app.local-delivery.tsx` (~line 9110). It compares dispatched orders against the most recent snapshot (within 4 hours)
- **The deploy script** (`scripts/deploy-cpg-labs.ps1`) was locally modified in another session with a `Cleanup-StaleTargets` function that breaks PowerShell parsing. The stashed original works fine. The modified version needs fixing (Python dict comprehension inside PS string)
- **DB access** requires one-off ECS tasks through the VPC — can't connect directly from local. Pattern: write a JSON override file, `aws ecs run-task`, wait, then pull results from CloudWatch logs
- **Windows + AWS CLI encoding**: CloudWatch filter patterns are finicky. `"vrp-optimizer"` (quoted) matches but `vrp-optimizer` (unquoted) doesn't. Non-ASCII in log messages crashes the CLI — all log strings are now ASCII-only
