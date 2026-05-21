

### Summary
The cost-aware functions `optimizeByCarrierQuotation` / `optimizeByVRP` / `addToExistingRoutesByCarrierQuotation` are invoked only from the embedded admin UI. CLI, auto-delivery cron, and auto-routing all use geometric-only `clusterOrders`, which picks a fixed `routeCount = ceil(orders / TARGET_PER_ROUTE)` without consulting Lalamove pricing, vehicle-type tradeoffs, or special-request surcharges.

### Defect class
`cost-aware` (broad — drives most other optimizer defects).

### Evidence
- UI cost-aware: [app/routes/app.local-delivery.tsx:7223](../../app/routes/app.local-delivery.tsx#L7223), [app/routes/app.local-delivery.tsx:7387](../../app/routes/app.local-delivery.tsx#L7387)
- CLI geometric: [app/routes/api.control.$intent.tsx:989](../../app/routes/api.control.$intent.tsx#L989)
- Cron geometric: [app/routes/api.cron.auto-delivery.tsx:199](../../app/routes/api.cron.auto-delivery.tsx#L199)
- Auto-routing geometric: [app/services/auto-routing.server.ts:433](../../app/services/auto-routing.server.ts#L433)
- `optimizeByCarrierQuotation` exists and is wired: [app/services/carrier-quotation-optimizer.server.ts:670](../../app/services/carrier-quotation-optimizer.server.ts#L670).

### Operator impact
~15–30% cost overhead on imbalanced batches. Geometric clustering produces "outlier-loner" routes that cost-aware Phase A would have rejected in favor of cheaper k-trial partitions. The CLI and cron are where the bulk of optimize decisions are made — this is the largest unlock.

### Proposed fix direction
Replace each programmatic `clusterOrders` call site with `optimizeByCarrierQuotation`. Plumb credentials from the same source as the dispatch path. Pull `vehicleOptions` from `LalamoveConfig` (depends on Issue 5) and `specialRequests` from `CarrierServiceConfigData` (depends on Issue 6). Behind flag `optimizer.cost-aware.programmatic-paths`.

### Acceptance criteria
- [ ] CLI, auto-delivery cron, and auto-routing all invoke `optimizeByCarrierQuotation`.
- [ ] Regression fixtures (≥3 historical batches) prove cost reductions vs geometric path.
- [ ] Flag-off preserves legacy geometric clustering for 30-day rollback.
- [ ] CloudWatch shows `optimize.candidate_evaluated` events firing per partition trial in the new path.

---

