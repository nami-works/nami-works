/**
 * Pure-helper tests for aside.server.ts.
 *
 * computeAsideData itself is integration-shaped (prisma + aggregator) and
 * out of scope for unit tests — covered by the manual smoke list in
 * docs/plans/local-delivery-analytics-aside.md §10. We unit-test the pure
 * pieces: date math, sparkline grouping, MoM %.
 *
 * Run: npx tsx --test app/services/ld-analytics/__tests__/aside.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  computeMomPercent,
  groupDailyToWeekly,
  startOfDayUtc,
  startOfWeekSunday,
  subWeeks,
} from "../aside.server";

// ────────────────────────────────────────────────────────────
//  Date helpers
// ────────────────────────────────────────────────────────────

test("startOfDayUtc — truncates to UTC midnight", () => {
  const noon = new Date("2026-05-11T12:34:56.789Z");
  assert.equal(startOfDayUtc(noon).toISOString(), "2026-05-11T00:00:00.000Z");
});

test("startOfWeekSunday — Monday 2026-05-11 → Sunday 2026-05-10", () => {
  const monday = new Date("2026-05-11T15:00:00.000Z");
  assert.equal(
    startOfWeekSunday(monday).toISOString(),
    "2026-05-10T00:00:00.000Z",
  );
});

test("startOfWeekSunday — Sunday returns itself at UTC midnight", () => {
  const sun = new Date("2026-05-10T22:00:00.000Z");
  assert.equal(startOfWeekSunday(sun).toISOString(), "2026-05-10T00:00:00.000Z");
});

test("subWeeks — subtracts whole weeks (7d)", () => {
  const d = new Date("2026-05-11T00:00:00.000Z");
  assert.equal(subWeeks(d, 1).toISOString(), "2026-05-04T00:00:00.000Z");
  assert.equal(subWeeks(d, 4).toISOString(), "2026-04-13T00:00:00.000Z");
});

// ────────────────────────────────────────────────────────────
//  groupDailyToWeekly — sparkline bucket math
// ────────────────────────────────────────────────────────────

function row(date: string, ldCost: number, whCost: number) {
  return {
    date: new Date(date),
    ldRevenueSubunits: 0,
    ldCarrierCostSubunits: ldCost,
    warehouseCounterfactualSubunits: whCost,
    warehouseCustomerRateSubunits: 0,
    taxSavingsSubunits: 0,
  };
}

test("groupDailyToWeekly — empty rows produce zero-valued buckets, never skipped", () => {
  const weekStarts = [
    new Date("2026-04-26T00:00:00.000Z"),
    new Date("2026-05-03T00:00:00.000Z"),
    new Date("2026-05-10T00:00:00.000Z"),
  ];
  const out = groupDailyToWeekly([], "net_cost_delta", weekStarts);
  assert.equal(out.length, 3);
  for (const p of out) assert.equal(p.valueSubunits, 0);
  assert.deepEqual(
    out.map((p) => p.week),
    weekStarts.map((d) => d.toISOString()),
  );
});

test("groupDailyToWeekly — buckets rows by their week-start, sums then frames", () => {
  // net_cost_delta = ldCost - whCost
  const rows = [
    row("2026-05-04T10:00:00.000Z", 100, 250), // wk of 2026-05-03 → -150
    row("2026-05-05T10:00:00.000Z", 200, 300), // wk of 2026-05-03 → -100
    row("2026-05-11T10:00:00.000Z", 50, 200), // wk of 2026-05-10 → -150
  ];
  const weekStarts = [
    new Date("2026-04-26T00:00:00.000Z"),
    new Date("2026-05-03T00:00:00.000Z"),
    new Date("2026-05-10T00:00:00.000Z"),
  ];
  const out = groupDailyToWeekly(rows, "net_cost_delta", weekStarts);
  assert.equal(out[0]!.valueSubunits, 0); // empty week
  assert.equal(out[1]!.valueSubunits, 100 + 200 - (250 + 300)); // -250
  assert.equal(out[2]!.valueSubunits, 50 - 200); // -150
});

test("groupDailyToWeekly — rows outside requested window are dropped silently", () => {
  const rows = [
    row("2024-01-01T00:00:00.000Z", 100, 200), // way out of window
    row("2026-05-04T10:00:00.000Z", 50, 100),
  ];
  const weekStarts = [new Date("2026-05-03T00:00:00.000Z")];
  const out = groupDailyToWeekly(rows, "net_cost_delta", weekStarts);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.valueSubunits, 50 - 100);
});

// ────────────────────────────────────────────────────────────
//  computeMomPercent
// ────────────────────────────────────────────────────────────

test("computeMomPercent — prior 30d zero → returns 0 (no infinity)", () => {
  const now = new Date("2026-05-11T00:00:00.000Z");
  const last30Row = row("2026-05-01T00:00:00.000Z", 100, 200);
  const result = computeMomPercent([last30Row], "net_cost_delta", now);
  assert.equal(result, 0);
});

test("computeMomPercent — last 30d larger than prior → positive %", () => {
  const now = new Date("2026-05-11T00:00:00.000Z");
  // prior 30 (between -60 and -30 from now): -60d = 2026-03-12, -30d = 2026-04-11
  // last 30 (between -30 and now): -30d = 2026-04-11, now = 2026-05-11
  // pl_impact = (ldRev + tax - ldCost) - (whCustRate - whCost)
  // With only ldCost/whCost set: pl_impact = -ldCost - (-whCost) = whCost - ldCost
  const rows = [
    row("2026-04-01T00:00:00.000Z", 0, 100), // prior 30: pl_impact = 100
    row("2026-05-01T00:00:00.000Z", 0, 200), // last 30: pl_impact = 200
  ];
  const result = computeMomPercent(rows, "pl_impact", now);
  // (200 - 100) / |100| * 100 = 100
  assert.equal(result, 100);
});

test("computeMomPercent — last 30d smaller than prior → negative %", () => {
  const now = new Date("2026-05-11T00:00:00.000Z");
  const rows = [
    row("2026-04-01T00:00:00.000Z", 0, 200), // prior pl_impact = 200
    row("2026-05-01T00:00:00.000Z", 0, 100), // last  pl_impact = 100
  ];
  const result = computeMomPercent(rows, "pl_impact", now);
  // (100 - 200) / 200 * 100 = -50
  assert.equal(result, -50);
});

test("computeMomPercent — no rows in either window → 0", () => {
  const now = new Date("2026-05-11T00:00:00.000Z");
  assert.equal(computeMomPercent([], "net_cost_delta", now), 0);
});

test("computeMomPercent — both windows equal → 0", () => {
  const now = new Date("2026-05-11T00:00:00.000Z");
  const rows = [
    row("2026-04-01T00:00:00.000Z", 0, 100), // prior pl_impact = 100
    row("2026-05-01T00:00:00.000Z", 0, 100), // last  pl_impact = 100
  ];
  assert.equal(computeMomPercent(rows, "pl_impact", now), 0);
});
