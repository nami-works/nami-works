

### Summary
Depends on Issue 2. `optimizeByCarrierQuotation` accepts `specialRequests?: string[]` (e.g., `DOOR_TO_DOOR` for `BR_SAO`). `CarrierServiceConfigData.lalamoveSpecialRequests` is per-market. UI path passes them; programmatic paths don't.

### Evidence
- Per-market special-requests config exists in production.
- `optimizeByCarrierQuotation` 7th argument unused on programmatic call sites.
- Per-city availability quirk: `BR_SAO` market contains multiple cities with different special-request availability — config stores city in `lalamoveLocationConfig.data.city`. (Recorded in CLAUDE.md "Carrier Services" section.)

### Proposed fix direction
At each programmatic call site, look up `lalamoveSpecialRequests[market]` (filtered by city when applicable) and pass as the 7th argument.

### Acceptance criteria
- [ ] When `lalamoveSpecialRequests[market]` non-empty, array passed to every Lalamove quote call.
- [ ] Quotes reflect special-request surcharge where applicable.

---

