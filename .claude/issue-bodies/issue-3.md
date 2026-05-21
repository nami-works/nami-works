

### Summary
The auto-delivery cron passes `10` as `maxPerRoute` to `clusterOrders`. The operator's hard cap is 7 (single-driver carrying capacity, recorded in `feedback_max_orders_per_route.md`). The optimizer's own constant declares `MAX_STOPS_PER_ROUTE = 7`. On high-volume days the cron silently produces 8–10-stop routes that the operator manually splits.

### Defect class
`capacity-overflow`.

### Evidence
- Hardcoded value: [app/routes/api.cron.auto-delivery.tsx:199](../../app/routes/api.cron.auto-delivery.tsx#L199) — `clusterOrders(optimizerOrders, routeCount, 10)`.
- Optimizer constant: [app/services/carrier-quotation-optimizer.server.ts:83](../../app/services/carrier-quotation-optimizer.server.ts#L83) — `const MAX_STOPS_PER_ROUTE = 7`.
- Operator memory: `feedback_max_orders_per_route.md`.

### Proposed fix direction
Replace `10` with `config.lalamoveMaxOrdersPerRoute ?? MAX_STOPS_PER_ROUTE`. Read from per-tenant `LalamoveConfig`. No flag needed — constraint correctness, low risk.

### Acceptance criteria
- [ ] No production cron run produces a route with > 7 stops.
- [ ] `LalamoveConfig` admin UI exposes `lalamoveMaxOrdersPerRoute`.
- [ ] Migration backfills existing tenants to the 7 default.

---

