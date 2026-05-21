

### Summary
Multiple optimizer constants are hardcoded across the codebase: `CLAUDE_OPTIMIZE_MAX_ROUTES = 20`, `CLAUDE_OPTIMIZE_TARGET_PER_ROUTE = 5`, the `10` from Issue 3, and various detour/proximity thresholds. Invisible while gebeauty is the only tenant; hostile defaults the moment a second tenant has different driver capacity, fleet density, or city geography.

### Defect class
Multi-tenant readiness.

### Proposed fix direction
Move each constant onto `LalamoveConfig` (or `CarrierServiceConfigData`) as an `OptimizerTuning` record. Defaults preserved as code-level constants but read from config first. Admin UI surfaces them under "Advanced" per location.

### Acceptance criteria
- [ ] Every numeric tuning parameter readable per-tenant from config.
- [ ] Defaults match today's hardcoded values to avoid behavior change for existing tenants.
- [ ] Admin UI exposes the fields with inline help text.

---

