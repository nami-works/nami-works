

### Summary
After Issues 2 + 5 + 6 ship, two parallel optimization paths remain: the UI's `optimizeByVRP` (Google Routes-based) and the programmatic `optimizeByCarrierQuotation` (Lalamove-pricing-only). Operators get different clusterings depending on which path runs. ~2-week project, files as an epic with sub-issues. Does not block day-zero work.

### Evidence
- `optimizeByVRP` at [carrier-quotation-optimizer.server.ts:1504](../../app/services/carrier-quotation-optimizer.server.ts#L1504).
- `optimizeByCarrierQuotation` at [carrier-quotation-optimizer.server.ts:670](../../app/services/carrier-quotation-optimizer.server.ts#L670).

### Proposed fix direction
Audit divergences. Pick one. Migrate callers. Remove the loser.

### Acceptance criteria
- [ ] Single optimization function across all call sites.
- [ ] No call site imports both functions.
- [ ] Removed function fully deleted.

---

