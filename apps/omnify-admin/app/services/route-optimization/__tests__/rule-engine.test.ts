/**
 * Unit + eval-case tests for rule-engine.server.ts.
 *
 * Run: npx tsx --test app/services/route-optimization/__tests__/rule-engine.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { evaluateCandidates } from "../rule-engine.server";
import type {
  Candidate,
  CandidateOrderInput,
  Coordinate,
  GeofenceRegistry,
  MarketKey,
} from "../types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const registry = JSON.parse(
  readFileSync(join(__dirname, "..", "geofences", "brazil.json"), "utf8"),
) as GeofenceRegistry;

const SP_PICKUP: Coordinate = { latitude: -23.5645, longitude: -46.669 };
const RIO_PICKUP: Coordinate = { latitude: -22.957, longitude: -43.176 };

function order(
  name: string,
  lat: number,
  lng: number,
  extra: Partial<CandidateOrderInput> = {},
): CandidateOrderInput {
  return {
    name,
    coordinates: { latitude: lat, longitude: lng },
    ...extra,
  };
}

function singleCandidate(slots: { slot: number; orderIds: string[] }[]): Candidate {
  return {
    candidateId: "test-candidate",
    candidateType: "optimizer-base",
    clustering: slots,
  };
}

function defaultInput(
  candidates: Candidate[],
  orders: CandidateOrderInput[],
  pickup: Coordinate,
  market: MarketKey,
  locationId = "test-location",
  tenantKey = "test-tenant",
) {
  return {
    candidates,
    orders,
    pickupCoordinates: pickup,
    market,
    locationId,
    tenantKey,
    geofenceRegistry: registry,
  };
}

// ── Barrier crossings ──────────────────────────────────────────────────────

test("rio-guanabara-bay fires when a Rio-side + Niterói-side order share a slot", () => {
  // Eval case 1 shape.
  const orders = [
    order("79960", -22.97, -43.21, { neighborhood: "Lagoa" }),
    order("79964", -22.89, -43.12, { neighborhood: "Niterói Centro" }),
  ];
  const candidate = singleCandidate([{ slot: 0, orderIds: ["79960", "79964"] }]);
  const [result] = evaluateCandidates(
    defaultInput([candidate], orders, RIO_PICKUP, "rio-de-janeiro"),
  );
  assert.ok(result);
  const barrierViolation = result!.ruleViolations.find(
    (v) => v.ruleId === "rio-guanabara-bay",
  );
  assert.ok(
    barrierViolation,
    `expected rio-guanabara-bay violation. Got: [${result!.ruleViolations.map((v) => v.ruleId).join(", ")}]`,
  );
  assert.equal(barrierViolation!.severity, "soft");
  assert.equal(result!.severityVerdict, "soft-violation");
});

test("rio-guanabara-bay does NOT fire when both orders are on rio-side", () => {
  const orders = [
    order("a", -22.97, -43.21, { neighborhood: "Lagoa" }),
    order("b", -22.96, -43.18, { neighborhood: "Botafogo" }),
  ];
  const candidate = singleCandidate([{ slot: 0, orderIds: ["a", "b"] }]);
  const [result] = evaluateCandidates(
    defaultInput([candidate], orders, RIO_PICKUP, "rio-de-janeiro"),
  );
  const barrierViolation = result!.ruleViolations.find(
    (v) => v.ruleId === "rio-guanabara-bay",
  );
  assert.equal(barrierViolation, undefined);
});

test("split-by-side variant doesn't trigger barrier crossing", () => {
  const orders = [
    order("79960", -22.97, -43.21, { neighborhood: "Lagoa" }),
    order("79964", -22.89, -43.12, { neighborhood: "Niterói Centro" }),
  ];
  const splitCandidate: Candidate = {
    candidateId: "split-by-side",
    candidateType: "split-outliers",
    clustering: [
      { slot: 0, orderIds: ["79960"] },
      { slot: 1, orderIds: ["79964"] },
    ],
  };
  const [result] = evaluateCandidates(
    defaultInput([splitCandidate], orders, RIO_PICKUP, "rio-de-janeiro"),
  );
  assert.equal(result!.severityVerdict, "clear");
});

// ── Outlier detection ──────────────────────────────────────────────────────

test("outlier-detected fires when Alphaville order shares a slot with central SP", () => {
  // Eval case 2 shape.
  const orders = [
    order("79900", -23.632, -46.640),
    order("79966", -23.612, -46.715),
    order("79976", -23.601, -46.674),
    order("79981", -23.476, -46.860, { distanceFromPickupKm: 30.2 }),
  ];
  const candidate = singleCandidate([
    { slot: 0, orderIds: ["79900", "79966", "79976", "79981"] },
  ]);
  const [result] = evaluateCandidates(
    defaultInput([candidate], orders, SP_PICKUP, "sao-paulo"),
  );
  const outlier = result!.ruleViolations.find((v) => v.ruleId === "outlier-detected");
  assert.ok(
    outlier,
    `expected outlier-detected. Got: [${result!.ruleViolations.map((v) => v.ruleId).join(", ")}]`,
  );
  assert.equal(outlier!.severity, "soft");
});

test("outlier check ignores solo-order slots", () => {
  // Same input as above but Alphaville is solo.
  const orders = [
    order("79900", -23.632, -46.640),
    order("79966", -23.612, -46.715),
    order("79976", -23.601, -46.674),
    order("79981", -23.476, -46.860),
  ];
  const candidate: Candidate = {
    candidateId: "split-alphaville",
    candidateType: "split-outliers",
    clustering: [
      { slot: 0, orderIds: ["79900", "79966", "79976"] },
      { slot: 1, orderIds: ["79981"] }, // solo — can't have an intra-route outlier
    ],
  };
  const [result] = evaluateCandidates(
    defaultInput([candidate], orders, SP_PICKUP, "sao-paulo"),
  );
  const outlier = result!.ruleViolations.find((v) => v.ruleId === "outlier-detected");
  assert.equal(outlier, undefined);
});

// ── Hard 7-cap ─────────────────────────────────────────────────────────────

test("hard-7-cap fires on a single 8-order slot and produces hard-violation verdict", () => {
  const orders = Array.from({ length: 8 }, (_, i) => order(`o-${i}`, -23.564, -46.669));
  const candidate = singleCandidate([
    { slot: 0, orderIds: orders.map((o) => o.name) },
  ]);
  const [result] = evaluateCandidates(
    defaultInput([candidate], orders, SP_PICKUP, "sao-paulo"),
  );
  const cap = result!.ruleViolations.find((v) => v.ruleId === "hard-7-cap");
  assert.ok(cap);
  assert.equal(cap!.severity, "hard");
  assert.equal(result!.severityVerdict, "hard-violation");
});

test("hard-7-cap does NOT fire on a 4+4 split", () => {
  const orders = Array.from({ length: 8 }, (_, i) => order(`o-${i}`, -23.564, -46.669));
  const candidate = singleCandidate([
    { slot: 0, orderIds: orders.slice(0, 4).map((o) => o.name) },
    { slot: 1, orderIds: orders.slice(4).map((o) => o.name) },
  ]);
  const [result] = evaluateCandidates(
    defaultInput([candidate], orders, SP_PICKUP, "sao-paulo"),
  );
  const cap = result!.ruleViolations.find((v) => v.ruleId === "hard-7-cap");
  assert.equal(cap, undefined);
});

// ── Absorption candidate ───────────────────────────────────────────────────

test("absorption-test-candidate fires on a 2-order route with ≥5km spread", () => {
  const orders = [
    order("grajau", -22.92, -43.27),
    order("saoconrado", -22.99, -43.27), // ~8km spread along longitude
  ];
  const candidate = singleCandidate([{ slot: 0, orderIds: ["grajau", "saoconrado"] }]);
  const [result] = evaluateCandidates(
    defaultInput([candidate], orders, RIO_PICKUP, "rio-de-janeiro"),
  );
  const abs = result!.ruleViolations.find((v) => v.ruleId === "absorption-test-candidate");
  assert.ok(
    abs,
    `expected absorption-test-candidate. Got: [${result!.ruleViolations.map((v) => v.ruleId).join(", ")}]`,
  );
  assert.equal(abs!.severity, "soft");
});

test("absorption rule does NOT fire on a 2-order route with <5km spread", () => {
  const orders = [
    order("a", -23.580, -46.680),
    order("b", -23.585, -46.685),
  ];
  const candidate = singleCandidate([{ slot: 0, orderIds: ["a", "b"] }]);
  const [result] = evaluateCandidates(
    defaultInput([candidate], orders, SP_PICKUP, "sao-paulo"),
  );
  const abs = result!.ruleViolations.find((v) => v.ruleId === "absorption-test-candidate");
  assert.equal(abs, undefined);
});

// ── Corridor matches (rules passed) ────────────────────────────────────────

test("corridor match logged when Flamengo + Tijuca share a slot", () => {
  const orders = [
    order("flamengo-1", -22.93, -43.176, { neighborhood: "Flamengo" }),
    order("tijuca-1", -22.92, -43.23, { neighborhood: "Tijuca" }),
  ];
  const candidate = singleCandidate([
    { slot: 0, orderIds: ["flamengo-1", "tijuca-1"] },
  ]);
  const [result] = evaluateCandidates(
    defaultInput([candidate], orders, RIO_PICKUP, "rio-de-janeiro"),
  );
  assert.ok(
    result!.rulesPassed.includes("rio-botafogo-to-tijuca"),
    `expected rio-botafogo-to-tijuca in rulesPassed. Got: [${result!.rulesPassed.join(",")}]`,
  );
});

// ── Sparse volume ──────────────────────────────────────────────────────────

test("sparse-volume-solo logged for a solo route at Recife sparse location", () => {
  const orders = [order("79995", -8.03, -34.9, { neighborhood: "Tamarineira" })];
  const candidate = singleCandidate([{ slot: 0, orderIds: ["79995"] }]);
  const [result] = evaluateCandidates(
    defaultInput(
      [candidate],
      orders,
      { latitude: -8.117, longitude: -34.901 },
      "recife",
      "gid://shopify/Location/97397014848",
      "ge-beauty",
    ),
  );
  assert.ok(
    result!.rulesPassed.includes("sparse-volume-solo"),
    `expected sparse-volume-solo in rulesPassed. Got: [${result!.rulesPassed.join(",")}]`,
  );
});

test("sparse-volume rule does NOT fire at a non-sparse location", () => {
  const orders = [order("only-one", -23.580, -46.680)];
  const candidate = singleCandidate([{ slot: 0, orderIds: ["only-one"] }]);
  const [result] = evaluateCandidates(
    defaultInput(
      [candidate],
      orders,
      SP_PICKUP,
      "sao-paulo",
      "gid://shopify/Location/97784398144", // SP / Shops Jardins (not sparse)
      "ge-beauty",
    ),
  );
  assert.equal(result!.rulesPassed.includes("sparse-volume-solo"), false);
});

// ── Deferred candidate (no clustering) ─────────────────────────────────────

test("deferred candidate (empty clustering) gets clear verdict + no rules fired", () => {
  const deferred: Candidate = {
    candidateId: "postpone-tomorrow",
    candidateType: "deferred",
    clustering: [],
  };
  const [result] = evaluateCandidates(
    defaultInput([deferred], [], SP_PICKUP, "sao-paulo"),
  );
  assert.equal(result!.severityVerdict, "clear");
  assert.equal(result!.ruleViolations.length, 0);
});

// ── Aggregate evaluation ───────────────────────────────────────────────────

test("evaluates multiple candidates in input order", () => {
  const orders = [
    order("79960", -22.97, -43.21, { neighborhood: "Lagoa" }),
    order("79964", -22.89, -43.12, { neighborhood: "Niterói Centro" }),
  ];
  const combined: Candidate = {
    candidateId: "combined",
    candidateType: "optimizer-base",
    clustering: [{ slot: 0, orderIds: ["79960", "79964"] }],
  };
  const split: Candidate = {
    candidateId: "split",
    candidateType: "split-outliers",
    clustering: [
      { slot: 0, orderIds: ["79960"] },
      { slot: 1, orderIds: ["79964"] },
    ],
  };
  const results = evaluateCandidates(
    defaultInput([combined, split], orders, RIO_PICKUP, "rio-de-janeiro"),
  );
  assert.equal(results.length, 2);
  assert.equal(results[0]!.candidateId, "combined");
  assert.equal(results[0]!.severityVerdict, "soft-violation");
  assert.equal(results[1]!.candidateId, "split");
  assert.equal(results[1]!.severityVerdict, "clear");
});
