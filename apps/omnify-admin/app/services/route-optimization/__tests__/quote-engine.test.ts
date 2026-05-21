/**
 * Unit tests for quote-engine.server.ts.
 *
 * Run: npx tsx --test app/services/route-optimization/__tests__/quote-engine.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import { quoteCandidates, rankByCost, type Quoter } from "../quote-engine.server";
import type {
  Candidate,
  CandidateOrderInput,
  Coordinate,
  QuoteResult,
} from "../types";

const PICKUP: Coordinate = { latitude: -23.5645, longitude: -46.669 };

function order(name: string, lat: number, lng: number): CandidateOrderInput {
  return { name, coordinates: { latitude: lat, longitude: lng } };
}

function candidate(id: string, slots: number[][]): Candidate {
  return {
    candidateId: id,
    candidateType: "optimizer-base",
    clustering: slots.map((ids, slotIdx) => ({
      slot: slotIdx,
      orderIds: ids.map(String),
    })),
  };
}

/**
 * Deterministic mock quoter: cost = base fee + per-stop surcharge, scaled by
 * the number of stops. Distance = sum of pairwise haversine approximations.
 */
const mockQuoter: Quoter = async (input) => {
  if (input.stops.length === 0) return { ok: false, error: "no_stops" };
  // Cost in subunits: R$22 base + R$3.33 per additional stop.
  const baseSubunits = 2200;
  const perStopSubunits = 333;
  const costSubunits = baseSubunits + (input.stops.length - 1) * perStopSubunits;
  return {
    ok: true,
    costSubunits,
    costTotal: (costSubunits / 100).toFixed(2),
    costCurrency: "BRL",
    serviceType: input.serviceType,
    distanceMeters: input.stops.length * 5000, // 5km per stop approximation
  };
};

const failingQuoter: Quoter = async () => ({ ok: false, error: "lalamove_timeout" });

const throwingQuoter: Quoter = async () => {
  throw new Error("network reset");
};

// ── Basic shape ────────────────────────────────────────────────────────────

test("quotes each candidate once and preserves input order", async () => {
  const orders = [
    order("1", -23.58, -46.68),
    order("2", -23.59, -46.67),
    order("3", -23.60, -46.69),
  ];
  const candidates = [
    candidate("base", [[1, 2, 3]]),
    candidate("split", [[1], [2, 3]]),
  ];
  const results = await quoteCandidates({
    candidates,
    orders,
    pickupCoordinates: PICKUP,
    market: "BR_SAO",
    serviceType: "MOTORCYCLE",
    quoter: mockQuoter,
  });
  assert.equal(results.length, 2);
  assert.equal(results[0]!.candidateId, "base");
  assert.equal(results[1]!.candidateId, "split");
});

test("aggregates per-slot quotes into grandTotal", async () => {
  const orders = [order("1", -23.58, -46.68), order("2", -23.59, -46.67)];
  const candidates = [candidate("two-slots", [[1], [2]])];
  const results = await quoteCandidates({
    candidates,
    orders,
    pickupCoordinates: PICKUP,
    market: "BR_SAO",
    serviceType: "MOTORCYCLE",
    quoter: mockQuoter,
  });
  const r = results[0]! as Extract<QuoteResult, { ok: true }>;
  assert.equal(r.ok, true);
  // 2 routes × R$22 each (single-stop) = R$44.00
  assert.equal(r.grandTotalSubunits, 2200 * 2);
  assert.equal(r.grandTotalDisplay, "44.00");
  assert.equal(r.routes.length, 2);
});

test("multi-stop pricing dominance: combined cheaper than split", async () => {
  const orders = [
    order("a", -23.58, -46.68),
    order("b", -23.59, -46.67),
    order("c", -23.60, -46.69),
    order("d", -23.61, -46.70),
  ];
  const candidates = [
    candidate("combined", [[1, 2, 3, 4].map(() => 0 /* placeholder */)]),
    candidate("split", [[1, 2], [3, 4]]),
  ];
  // Replace placeholder slots with actual order ids.
  candidates[0]!.clustering = [{ slot: 0, orderIds: ["a", "b", "c", "d"] }];
  candidates[1]!.clustering = [
    { slot: 0, orderIds: ["a", "b"] },
    { slot: 1, orderIds: ["c", "d"] },
  ];
  const results = await quoteCandidates({
    candidates,
    orders,
    pickupCoordinates: PICKUP,
    market: "BR_SAO",
    serviceType: "MOTORCYCLE",
    quoter: mockQuoter,
  });
  const combined = results[0]! as Extract<QuoteResult, { ok: true }>;
  const split = results[1]! as Extract<QuoteResult, { ok: true }>;
  // Combined 4-stop: 2200 + 3*333 = 3199 subunits
  // Split (2-stop × 2): 2 * (2200 + 333) = 5066 subunits
  assert.ok(
    combined.grandTotalSubunits < split.grandTotalSubunits,
    `combined should beat split. combined=${combined.grandTotalSubunits} split=${split.grandTotalSubunits}`,
  );
});

// ── Deferred ───────────────────────────────────────────────────────────────

test("deferred candidate (empty clustering) returns zero-cost ok result", async () => {
  const orders = [order("only", -23.58, -46.68)];
  const candidates: Candidate[] = [
    {
      candidateId: "postpone-tomorrow",
      candidateType: "deferred",
      clustering: [],
    },
  ];
  const results = await quoteCandidates({
    candidates,
    orders,
    pickupCoordinates: PICKUP,
    market: "BR_SAO",
    serviceType: "MOTORCYCLE",
    quoter: mockQuoter,
  });
  const r = results[0]! as Extract<QuoteResult, { ok: true }>;
  assert.equal(r.ok, true);
  assert.equal(r.grandTotalSubunits, 0);
  assert.deepEqual(r.routes, []);
});

// ── Failure handling ───────────────────────────────────────────────────────

test("candidate is marked failed when any slot fails to quote", async () => {
  const orders = [order("a", -23.58, -46.68)];
  const candidates = [candidate("c1", [[1]])];
  candidates[0]!.clustering[0]!.orderIds = ["a"];
  const results = await quoteCandidates({
    candidates,
    orders,
    pickupCoordinates: PICKUP,
    market: "BR_SAO",
    serviceType: "MOTORCYCLE",
    quoter: failingQuoter,
  });
  const r = results[0]!;
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.deepEqual(r.failedSlots, [0]);
    assert.ok(r.error.includes("lalamove_timeout"));
  }
});

test("quoter exceptions are caught and surfaced as failure", async () => {
  const orders = [order("a", -23.58, -46.68)];
  const candidates = [candidate("c1", [[1]])];
  candidates[0]!.clustering[0]!.orderIds = ["a"];
  const results = await quoteCandidates({
    candidates,
    orders,
    pickupCoordinates: PICKUP,
    market: "BR_SAO",
    serviceType: "MOTORCYCLE",
    quoter: throwingQuoter,
  });
  const r = results[0]!;
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.error.includes("network reset"));
  }
});

test("partial-failure: one slot fails, the candidate is still marked failed with that slot listed", async () => {
  let calls = 0;
  const partialQuoter: Quoter = async () => {
    calls += 1;
    if (calls === 2) return { ok: false, error: "rate_limited" };
    return {
      ok: true,
      costSubunits: 2200,
      costTotal: "22.00",
      costCurrency: "BRL",
      serviceType: "MOTORCYCLE",
    };
  };
  const orders = [order("a", -23.58, -46.68), order("b", -23.59, -46.67)];
  const candidates: Candidate[] = [
    {
      candidateId: "two-slots",
      candidateType: "optimizer-base",
      clustering: [
        { slot: 0, orderIds: ["a"] },
        { slot: 1, orderIds: ["b"] },
      ],
    },
  ];
  const results = await quoteCandidates({
    candidates,
    orders,
    pickupCoordinates: PICKUP,
    market: "BR_SAO",
    serviceType: "MOTORCYCLE",
    quoter: partialQuoter,
  });
  const r = results[0]!;
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.deepEqual(r.failedSlots, [1]);
  }
});

// ── rankByCost ─────────────────────────────────────────────────────────────

test("rankByCost sorts ok candidates cheapest first; failed candidates last", () => {
  const r1: QuoteResult = {
    candidateId: "expensive",
    ok: true,
    routes: [],
    grandTotalSubunits: 9000,
    grandTotalDisplay: "90.00",
    grandTotalCurrency: "BRL",
  };
  const r2: QuoteResult = {
    candidateId: "cheap",
    ok: true,
    routes: [],
    grandTotalSubunits: 4000,
    grandTotalDisplay: "40.00",
    grandTotalCurrency: "BRL",
  };
  const r3: QuoteResult = {
    candidateId: "failed",
    ok: false,
    error: "x",
    failedSlots: [0],
  };
  const r4: QuoteResult = {
    candidateId: "medium",
    ok: true,
    routes: [],
    grandTotalSubunits: 6000,
    grandTotalDisplay: "60.00",
    grandTotalCurrency: "BRL",
  };
  const ranked = rankByCost([r1, r3, r2, r4]);
  assert.deepEqual(ranked, ["cheap", "medium", "expensive", "failed"]);
});

// ── Distance aggregation ───────────────────────────────────────────────────

test("grandTotalDistanceMeters sums per-route distances when all present", async () => {
  const orders = [order("a", -23.58, -46.68), order("b", -23.59, -46.67)];
  const candidates: Candidate[] = [
    {
      candidateId: "c",
      candidateType: "optimizer-base",
      clustering: [
        { slot: 0, orderIds: ["a"] },
        { slot: 1, orderIds: ["b"] },
      ],
    },
  ];
  const results = await quoteCandidates({
    candidates,
    orders,
    pickupCoordinates: PICKUP,
    market: "BR_SAO",
    serviceType: "MOTORCYCLE",
    quoter: mockQuoter,
  });
  const r = results[0]! as Extract<QuoteResult, { ok: true }>;
  // mockQuoter returns distance = stops*5000. Each slot has 1 stop → 5000 + 5000 = 10000.
  assert.equal(r.grandTotalDistanceMeters, 10000);
});

test("grandTotalDistanceMeters is undefined when any route is missing distance", async () => {
  const orders = [order("a", -23.58, -46.68), order("b", -23.59, -46.67)];
  let i = 0;
  const sometimesDistance: Quoter = async () => {
    const base = {
      costSubunits: 2200,
      costTotal: "22.00",
      costCurrency: "BRL",
      serviceType: "MOTORCYCLE",
    };
    if (i === 0) {
      i += 1;
      return { ok: true, ...base, distanceMeters: 5000 };
    }
    return { ok: true, ...base }; // no distance
  };
  const candidates: Candidate[] = [
    {
      candidateId: "c",
      candidateType: "optimizer-base",
      clustering: [
        { slot: 0, orderIds: ["a"] },
        { slot: 1, orderIds: ["b"] },
      ],
    },
  ];
  const results = await quoteCandidates({
    candidates,
    orders,
    pickupCoordinates: PICKUP,
    market: "BR_SAO",
    serviceType: "MOTORCYCLE",
    quoter: sometimesDistance,
  });
  const r = results[0]! as Extract<QuoteResult, { ok: true }>;
  assert.equal(r.grandTotalDistanceMeters, undefined);
});
