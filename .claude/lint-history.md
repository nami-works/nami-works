# Lint History

Daily totals after each `/clean-one` session. Each row records the post-cleanup
lint count (errors + warnings) that the session expects on `main` once its PRs
land. Append a new row at the end of every `/clean-one` run.

| Date       | Start | End  | Cleared | PR(s)            | File(s)                                                |
| ---------- | ----- | ---- | ------- | ---------------- | ------------------------------------------------------ |
| 2026-05-04 | 574   | 569  | 5       | #14 (merged 5/5) | app/retail-footprint/analytics-queries.server.ts       |
| 2026-05-05 | 569   | 563  | 6       | #17 (#16 dup)    | app/services/carrier/sample-rate-db.server.ts          |
| 2026-05-05 | 569   | 563  | 6       | #18              | app/retail-footprint/storage.server.ts                 |
| 2026-05-05 | —     | 552  | —       | merge sweep      | #14 + #17 + #18 squash-merged → main now reads 552     |
| 2026-05-09 | 544   | 537  | 7       | #29              | app/routes/api.kpi.monthly-average.tsx                 |
| 2026-05-09 | 544   | 536  | 8       | #30              | tests/webhooks.test.ts                                 |
| 2026-05-09 | 544   | 538  | 6       | #31              | app/services/auto-routing.server.ts                    |
| 2026-05-09 | 544   | 538  | 6       | #32              | app/routes/api.cron.auto-delivery.tsx                  |
| 2026-05-09 | 544   | 537  | 7       | #33              | app/routes/app.retail-sales/campaigns-tab.tsx          |
| 2026-05-09 | 544   | 530  | 14      | #34              | scripts/seed-local-delivery-orders.ts                  |
| 2026-05-09 | 544   | 533  | 11      | #35              | trivial-sweep across 11 files (1 issue each)           |
| 2026-05-09 | —     | 485  | —       | merge sweep      | #29+#30+#31+#32+#33+#34+#35 squash-merged → main reads 485 (deployed full rev 31 / omnify rev 53) |
| 2026-05-10 | 485   | 469  | 16      | #36              | app/routes/app.goals.tsx                               |
| 2026-05-10 | 485   | 469  | 16      | #37              | app/routes/app.carrier-service.tsx                     |
| 2026-05-10 | 485   | 479  | 6       | #38              | price-tags trivial × 3 files                           |
| 2026-05-10 | 485   | 478  | 7       | #39              | shared-i18n + multi-select × 3 files                   |
| 2026-05-10 | 485   | 483  | 2       | #40              | app/services/lalamove-sync.server.ts                   |
| 2026-05-10 | 485   | 481  | 4       | #41              | bulk-price/campaign + app.settings × 2 files           |
| 2026-05-10 | 485   | 481  | 4       | #42              | app/routes/app.retail-sales.tsx                        |
| 2026-05-10 | 485   | 483  | 2       | #43              | app/routes/webhooks.lalamove.tsx                       |
| 2026-05-10 | 485   | 483  | 2       | #44              | app/routes/api.cron.lalamove-watchdog.tsx              |
| 2026-05-10 | 485   | 477  | 8       | #45              | app/services/lalamove.server.ts (+1 cascade)           |
| 2026-05-10 | —     | 418  | —       | merge sweep      | #36..#45 squash-merged → main reads 418 (deployed full rev 32 / omnify rev 54) |
| 2026-05-10 | 418   | 410  | 8       | #46              | feat: @types/google.maps + SModalElement (3 modal-ref any cleared + 5 cascade fixes; unlocks ~5 files) |
| 2026-05-10 | 418   | 408  | 10      | #47              | app/routes/app.merchandising.sale._index.tsx (post-unlock final)        |
| 2026-05-10 | 418   | 393  | 25      | #48              | app/routes/app.merchandising.sale.quick-apply.tsx (post-unlock final)   |
| 2026-05-10 | —     | 380  | —       | merge sweep      | #46+#47+#48 squash-merged → main reads 380 (deployed full rev 33 / omnify rev 55) |

Notes:
- 2026-05-04 baseline (`574`) is reconstructed: yesterday's PR #14 cleared 5
  issues against a backlog that read `569` after its fix, so the pre-fix total
  was `574`.
- 2026-05-05 saw one duplicate (PR #16, against the same file as #14) — closed
  without merge — and one new file (PR #17 on sample-rate-db).
- 2026-05-09: 4-day gap since last session (5/5 → 5/9). Session-start total
  was 544, down from 552 — 8 issues got cleared incidentally between sessions
  by feature PRs (#19–#26 + today's #27 + #28 touching lintable files).
- 2026-05-09 (extended): user invoked `/clean-one` six times in one session
  ("5 more times" override on top of the initial run). 6 PRs opened (#29–#34),
  48 issues cleared in aggregate. Each PR's per-row End column shows what main
  would read if ONLY that PR merged. The sweep-target row shows the cumulative
  End if all six land. Three additional candidates (lalamove-escalation.server,
  lalamove.server, affiliates/sync.server) were ABORTED per the skill's
  guardrails — `prismaAny`/`admin: any` patterns are systemic across helpers
  and would require touching 3+ call sites or files outside the chosen target.
- The `scripts/lint-pick.ts` picker referenced in the skill prose does not
  exist in the repo. Targets were picked manually using the documented
  heuristics (5–25 issues, no `inputs/`, no `react-hooks/exhaustive-deps`
  dominant, no in-flight `chore/lint-cleanup-*` PRs). Worth either building
  the picker or updating the skill prose to match reality.
