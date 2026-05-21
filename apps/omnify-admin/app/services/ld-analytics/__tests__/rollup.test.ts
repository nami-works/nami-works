/**
 * Pure-helper tests for rollup.server.ts. Full integration test (with seeded
 * LalamoveDispatchJob + ShopOrder rows + mocked aggregator) is left for a
 * follow-up — see docs/plans/local-delivery-analytics.md §16.5.
 *
 * Run: npx tsx --test app/services/ld-analytics/__tests__/rollup.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCity, startOfDayUtc } from "../rollup.server";

test("normalizeCity — handles common BR city forms", () => {
  assert.equal(normalizeCity("São Paulo"), "sao-paulo");
  assert.equal(normalizeCity(" SAO  PAULO "), "sao-paulo");
  assert.equal(normalizeCity("Rio de Janeiro"), "rio-de-janeiro");
  assert.equal(normalizeCity("Brasília"), "brasilia");
  assert.equal(normalizeCity("São José dos Campos"), "sao-jose-dos-campos");
});

test("normalizeCity — empty / null falls back to 'unknown'", () => {
  assert.equal(normalizeCity(""), "unknown");
  assert.equal(normalizeCity(null), "unknown");
  assert.equal(normalizeCity(undefined), "unknown");
  assert.equal(normalizeCity("   "), "unknown");
});

test("startOfDayUtc — truncates to UTC midnight", () => {
  const noon = new Date("2026-05-10T12:34:56.789Z");
  const start = startOfDayUtc(noon);
  assert.equal(start.toISOString(), "2026-05-10T00:00:00.000Z");
});

test("startOfDayUtc — returns a copy, doesn't mutate input", () => {
  const original = new Date("2026-05-10T12:34:56.789Z");
  startOfDayUtc(original);
  assert.equal(original.toISOString(), "2026-05-10T12:34:56.789Z");
});
