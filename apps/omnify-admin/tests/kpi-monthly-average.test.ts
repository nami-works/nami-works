import test from "node:test";
import assert from "node:assert/strict";
import {
  getMonthsIncluded,
  bucketByMonth,
  monthlyAverageFromBuckets,
} from "../app/utils/kpi-monthly-average";

test("getMonthsIncluded - single month", () => {
  const start = new Date("2024-06-01T00:00:00Z");
  const end = new Date("2024-06-15T12:00:00Z");
  const months = getMonthsIncluded(start, end);
  assert.deepStrictEqual(months, ["2024-06"]);
});

test("getMonthsIncluded - multi month", () => {
  const start = new Date("2024-01-01T00:00:00Z");
  const end = new Date("2024-03-31T23:59:59Z");
  const months = getMonthsIncluded(start, end);
  assert.deepStrictEqual(months, ["2024-01", "2024-02", "2024-03"]);
});

test("getMonthsIncluded - partial intersecting months", () => {
  const start = new Date("2024-01-15T00:00:00Z");
  const end = new Date("2024-02-20T00:00:00Z");
  const months = getMonthsIncluded(start, end);
  assert.deepStrictEqual(months, ["2024-01", "2024-02"]);
});

test("bucketByMonth - no records", () => {
  const start = new Date("2024-01-01Z");
  const end = new Date("2024-03-31Z");
  const buckets = bucketByMonth([], () => null, () => 1, start, end, "UTC");
  assert.strictEqual(buckets["2024-01"], 0);
  assert.strictEqual(buckets["2024-02"], 0);
  assert.strictEqual(buckets["2024-03"], 0);
});

test("bucketByMonth - single month count", () => {
  const start = new Date("2024-06-01T00:00:00Z");
  const end = new Date("2024-06-30T23:59:59Z");
  const items = [
    { createdAt: "2024-06-05T10:00:00Z" },
    { createdAt: "2024-06-20T10:00:00Z" },
  ];
  const buckets = bucketByMonth(
    items,
    (i) => i.createdAt,
    () => 1,
    start,
    end,
    "UTC",
  );
  assert.strictEqual(buckets["2024-06"], 2);
});

test("bucketByMonth - multi month with values", () => {
  const start = new Date("2024-01-01Z");
  const end = new Date("2024-03-31Z");
  const items = [
    { ts: "2024-01-10Z", value: 100 },
    { ts: "2024-01-20Z", value: 50 },
    { ts: "2024-02-15Z", value: 200 },
  ];
  const buckets = bucketByMonth(
    items,
    (i) => i.ts,
    (i) => i.value,
    start,
    end,
    "UTC",
  );
  assert.strictEqual(buckets["2024-01"], 150);
  assert.strictEqual(buckets["2024-02"], 200);
  assert.strictEqual(buckets["2024-03"], 0);
});

test("monthlyAverageFromBuckets - single month", () => {
  const avg = monthlyAverageFromBuckets({ "2024-01": 120 }, ["2024-01"]);
  assert.strictEqual(avg, 120);
});

test("monthlyAverageFromBuckets - multi month", () => {
  const avg = monthlyAverageFromBuckets(
    { "2024-01": 100, "2024-02": 200, "2024-03": 300 },
    ["2024-01", "2024-02", "2024-03"],
  );
  assert.strictEqual(avg, 200);
});

test("monthlyAverageFromBuckets - no months", () => {
  const avg = monthlyAverageFromBuckets({}, []);
  assert.strictEqual(avg, 0);
});

test("monthlyAverageFromBuckets - partial months with zeros", () => {
  const avg = monthlyAverageFromBuckets(
    { "2024-01": 100, "2024-02": 0, "2024-03": 50 },
    ["2024-01", "2024-02", "2024-03"],
  );
  assert.strictEqual(Math.round(avg * 100) / 100, 50);
});
