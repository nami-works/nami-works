

### Summary
`/api/control/state` returns `route.dispatch.status` and `requestedAt` for each slot regardless of whether the orders currently tagged with `ld_rota-NN` match the orders that were dispatched. After fresh optimize moves new orders into a slot, the state still shows yesterday's COMPLETED Lalamove order ID. Confirmed live on 2026-05-01 across SP slot 0, PE slot 0, RJ slots 0 + 1.

### Defect class
State integrity. Blocks Issue 1 (mark-delivered bucketing depends on trustworthy state).

### Evidence
- Reproduced 2026-05-01: state returned `requestedAt: 2026-04-30T20:08:54.963Z`, `status: COMPLETED` for slots holding fresh orders.
- Slot metadata is cached against the slot, not against the order set.

### Proposed fix direction
Two options, prefer option 2:
1. **Invalidate slot metadata on tag change.** When `ld_rota-NN` is added/removed, clear cached `dispatch` on that slot.
2. **`Dispatch` table keyed by `lalamoveOrderId` with `orderIds[]` snapshot.** State queries the latest dispatch whose `orderIds` exactly matches the current tag-grouped order set; if no match, slot is fresh. Better audit, full dispatch history per slot.

### Acceptance criteria
- [ ] State for a slot whose order set differs from any historical dispatch returns `dispatch: null`.
- [ ] State for a slot whose orders match a prior dispatch returns that dispatch's metadata.
- [ ] Live refresh by `lalamoveOrderId` is on-demand via `--live`, not cached against the slot.

---

