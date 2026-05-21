

### Summary
Depends on Issue 2. Once cost-aware lands on programmatic paths, the optimizer can compare primary and secondary vehicle types per partition — but only if the call sites pass `vehicleOptions`. Today they don't, so the optimizer defaults to a single vehicle type and the LALAGO-vs-CAR cost comparison is lost on CLI/cron/auto-routing.

### Defect class
`service-type`.

### Evidence
- `LalamoveConfig.preferredServiceType` (primary) and `CarrierServiceConfigData.lalamoveSecondaryServiceType` are populated in production.
- `optimizeByCarrierQuotation` accepts `vehicleOptions: { primary, secondary? }` and quotes both.
- UI path passes them; programmatic paths don't (will become apparent after Issue 2 lands).

### Proposed fix direction
At each programmatic call site, pass `{ primary: config.preferredServiceType, secondary: carrierConfig.lalamoveSecondaryServiceType }`.

### Acceptance criteria
- [ ] When both vehicle types configured, optimize logs show quotes against both.
- [ ] Cheapest-of-both selected per cluster.

---

