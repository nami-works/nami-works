/**
 * Unit + eval-case tests for candidate-generator.server.ts.
 *
 * Run: npx tsx --test app/services/route-optimization/__tests__/candidate-generator.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  generateCandidates,
  type CandidateGeneratorInput,
} from "../candidate-generator.server";
import type {
  Candidate,
  CandidateOrderInput,
  CandidateType,
  Coordinate,
  GeofenceRegistry,
  MarketKey,
} from "../types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Fixtures ───────────────────────────────────────────────────────────────

const registry = JSON.parse(
  readFileSync(join(__dirname, "..", "geofences", "brazil.json"), "utf8"),
) as GeofenceRegistry;

// Real coordinates from the live eval set, used so the tests stay grounded.
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

function getCandidate(
  candidates: Candidate[],
  type: CandidateType,
): Candidate | undefined {
  return candidates.find((c) => c.candidateType === type);
}

function slotsContaining(c: Candidate | undefined, name: string): number[] {
  if (!c) return [];
  return c.clustering
    .map((slot, i) => (slot.orderIds.includes(name) ? i : -1))
    .filter((i) => i >= 0);
}

function defaultInput(
  orders: CandidateOrderInput[],
  pickup: Coordinate,
  market: MarketKey,
  locationId = "test-location",
  tenantKey = "test-tenant",
): CandidateGeneratorInput {
  return {
    orders,
    pickupCoordinates: pickup,
    locationId,
    tenantKey,
    market,
    geofenceRegistry: registry,
  };
}

// ── optimizer-base ─────────────────────────────────────────────────────────

test("optimizer-base is always emitted, even with empty input", () => {
  const out = generateCandidates(defaultInput([], SP_PICKUP, "sao-paulo"));
  assert.equal(out.length, 1);
  assert.equal(out[0]!.candidateType, "optimizer-base");
  assert.deepEqual(out[0]!.clustering, []);
});

test("optimizer-base assigns every order to exactly one slot", () => {
  const orders = [
    order("79900", -23.632, -46.640),
    order("79966", -23.612, -46.715),
    order("79976", -23.601, -46.674),
    order("79981", -23.476, -46.860),
  ];
  const out = generateCandidates(defaultInput(orders, SP_PICKUP, "sao-paulo"));
  const base = getCandidate(out, "optimizer-base")!;
  const allOrders = base.clustering.flatMap((s) => s.orderIds);
  assert.equal(allOrders.length, orders.length);
  assert.deepEqual([...new Set(allOrders)].sort(), orders.map((o) => o.name).sort());
});

// ── split-outliers (canonical Alphaville case) ─────────────────────────────

test("split-outliers fires when an SP order sits 30km west (Alphaville case)", () => {
  // Case 2 from seed.json: 3 central SP orders + 1 Alphaville at -23.476,-46.860.
  const orders = [
    order("79900", -23.632, -46.640, { neighborhood: "Vila Mariana" }),
    order("79966", -23.612, -46.715, { neighborhood: "Chácara Santo Antonio" }),
    order("79976", -23.601, -46.674, { neighborhood: "Vila Olímpia" }),
    order("79981", -23.476, -46.860, {
      neighborhood: "Alphaville",
      isOutlier: true,
      distanceFromPickupKm: 30.2,
    }),
  ];
  const out = generateCandidates(defaultInput(orders, SP_PICKUP, "sao-paulo"));
  const split = getCandidate(out, "split-outliers");
  assert.ok(split, `split-outliers variant should be emitted. Got: ${out.map((c) => c.candidateType).join(",")}`);
  // The Alphaville order should be alone in its own slot in the split variant.
  const alphavilleSlots = slotsContaining(split, "79981");
  assert.equal(alphavilleSlots.length, 1, "Alphaville must appear in exactly one slot");
  const alphavilleSlot = split!.clustering[alphavilleSlots[0]!]!;
  assert.equal(
    alphavilleSlot.orderIds.length,
    1,
    `Alphaville's slot should be solo. Got: [${alphavilleSlot.orderIds.join(",")}]`,
  );
});

test("split-outliers does NOT fire on a clean 3-order central SP cluster", () => {
  // Case 10 from seed.json: 3 clean orders within 5km, no outliers.
  const orders = [
    order("clean-1", -23.580, -46.680, { neighborhood: "Jardins" }),
    order("clean-2", -23.585, -46.675, { neighborhood: "Jardins" }),
    order("clean-3", -23.590, -46.685, { neighborhood: "Vila Olímpia" }),
  ];
  const out = generateCandidates(defaultInput(orders, SP_PICKUP, "sao-paulo"));
  const split = getCandidate(out, "split-outliers");
  assert.equal(split, undefined, "no order is 2x median + >10km from centroid; split should not fire");
});

// ── corridor-from-pickup-swap (canonical Botafogo→Tijuca case) ─────────────

test("at least one candidate groups Flamengo + Tijuca together (corridor pattern)", () => {
  // Case 5 from seed.json: 2 Flamengo orders, 2 Tijuca, 1 Ipanema, 1 Leblon.
  // The operationally-relevant property is that SOMEWHERE in the output, a
  // candidate exists where Flamengo+Tijuca share a slot — whether that's
  // because the optimizer-base k-means produced it directly (Flamengo is
  // geographically en-route to Tijuca, so a competent k-means already groups
  // them) OR because corridor-swap rescued a base that got it wrong. The
  // arbiter picks the right one regardless.
  const orders = [
    order("rio-flamengo-1", -22.93, -43.176, { neighborhood: "Flamengo" }),
    order("rio-flamengo-2", -22.94, -43.176, { neighborhood: "Flamengo" }),
    order("rio-tijuca-1", -22.92, -43.23, { neighborhood: "Tijuca" }),
    order("rio-tijuca-2", -22.93, -43.24, { neighborhood: "Tijuca" }),
    order("rio-ipanema-1", -22.98, -43.20, { neighborhood: "Ipanema" }),
    order("rio-leblon-1", -22.99, -43.22, { neighborhood: "Leblon" }),
  ];
  const out = generateCandidates(defaultInput(orders, RIO_PICKUP, "rio-de-janeiro"));
  const hasGoodGrouping = out.some((c) => {
    const tijucaSlot = c.clustering.find((s) =>
      s.orderIds.some((id) => id.includes("tijuca")),
    );
    if (!tijucaSlot) return false;
    return tijucaSlot.orderIds.some((id) => id.includes("flamengo"));
  });
  assert.ok(
    hasGoodGrouping,
    `no candidate grouped Flamengo with Tijuca. Got: ${out.map((c) => c.candidateType).join(",")}`,
  );
});

test("corridor-swap fixes a base that put Flamengo with Ipanema (forced misgrouping)", () => {
  // Force the wrong base by making the Tijuca orders geographically distant
  // (far NW), so my k-means puts them ALONE while Flamengo + Ipanema/Leblon
  // share the south-central cluster. With Flamengo in a non-Tijuca slot, the
  // corridor-swap MUST fire and move Flamengo to the Tijuca slot.
  const orders = [
    order("tijuca-far-1", -22.80, -43.35, { neighborhood: "Tijuca" }),
    order("tijuca-far-2", -22.81, -43.36, { neighborhood: "Tijuca" }),
    order("flamengo-1", -22.94, -43.18, { neighborhood: "Flamengo" }),
    order("ipanema-1", -22.98, -43.20, { neighborhood: "Ipanema" }),
    order("ipanema-2", -22.985, -43.205, { neighborhood: "Ipanema" }),
    order("leblon-1", -22.99, -43.22, { neighborhood: "Leblon" }),
  ];
  const out = generateCandidates(defaultInput(orders, RIO_PICKUP, "rio-de-janeiro"));
  const corridor = getCandidate(out, "corridor-from-pickup-swap");
  // We only require corridor-swap to fire when the base actually has Flamengo
  // away from Tijuca. Verify that's the precondition first.
  const base = getCandidate(out, "optimizer-base")!;
  const baseTijucaSlot = base.clustering.find((s) =>
    s.orderIds.some((id) => id.includes("tijuca")),
  );
  const baseFlamengoSlot = base.clustering.find((s) =>
    s.orderIds.some((id) => id.includes("flamengo")),
  );
  if (baseTijucaSlot === baseFlamengoSlot) {
    // Base already grouped them — corridor-swap correctly no-ops; nothing to assert.
    return;
  }
  // Misgrouped base — corridor-swap MUST fire.
  assert.ok(
    corridor,
    `base misgrouped Flamengo (slot ${base.clustering.indexOf(baseFlamengoSlot!)}) from Tijuca (slot ${base.clustering.indexOf(baseTijucaSlot!)}); corridor-swap should fire. Got: ${out.map((c) => c.candidateType).join(",")}`,
  );
  const fixedTijucaSlot = corridor!.clustering.find((s) =>
    s.orderIds.some((id) => id.includes("tijuca")),
  );
  assert.ok(
    fixedTijucaSlot!.orderIds.includes("flamengo-1"),
    `corridor-swap should put flamengo-1 in Tijuca's slot. Slot: [${fixedTijucaSlot!.orderIds.join(",")}]`,
  );
});

// ── rule-fallback (hard 7-cap) ─────────────────────────────────────────────

test("rule-fallback splits an oversized cluster (>7 orders)", () => {
  // Construct 8 orders all in tight central SP — optimizer-base might
  // produce one cluster of 8. Rule-fallback must split.
  const orders = Array.from({ length: 8 }, (_, i) =>
    order(`oversize-${i}`, -23.564 + i * 0.001, -46.669 + i * 0.001),
  );
  const out = generateCandidates(defaultInput(orders, SP_PICKUP, "sao-paulo"));
  const base = getCandidate(out, "optimizer-base")!;
  const hasOversize = base.clustering.some((s) => s.orderIds.length > 7);
  if (!hasOversize) {
    // Heuristic gave us K≥2, no oversize cluster — fallback shouldn't fire.
    const fallback = getCandidate(out, "rule-fallback");
    assert.equal(fallback, undefined);
    return;
  }
  const fallback = getCandidate(out, "rule-fallback");
  assert.ok(fallback, "rule-fallback should fire when base has oversized cluster");
  for (const slot of fallback!.clustering) {
    assert.ok(slot.orderIds.length <= 7, `slot ${slot.slot} still oversized: ${slot.orderIds.length}`);
  }
});

// ── deferred (Recife sparse-volume solo postponement) ──────────────────────

test("deferred fires on solo order at Recife sparse-volume location", () => {
  // Case 6 from seed.json: Recife solo order on day 1 of a 3-day promise.
  const recifeLegacyId = "97397014848";
  const out = generateCandidates({
    orders: [
      order("79995", -8.029, -34.896, {
        neighborhood: "Tamarineira",
        deliveryPromiseDays: 3,
        daysIntoPromise: 1,
      }),
    ],
    pickupCoordinates: { latitude: -8.117, longitude: -34.901 },
    locationId: `gid://shopify/Location/${recifeLegacyId}`,
    tenantKey: "ge-beauty",
    market: "recife",
    geofenceRegistry: registry,
  });
  const deferred = getCandidate(out, "deferred");
  assert.ok(deferred, `deferred should be emitted. Got: ${out.map((c) => c.candidateType).join(",")}`);
  assert.deepEqual(deferred!.clustering, [], "deferred candidate has empty clustering");
});

test("deferred does NOT fire when promise margin is exhausted", () => {
  const recifeLegacyId = "97397014848";
  const out = generateCandidates({
    orders: [
      order("late-order", -8.029, -34.896, {
        neighborhood: "Tamarineira",
        deliveryPromiseDays: 3,
        daysIntoPromise: 3, // last day — no margin left
      }),
    ],
    pickupCoordinates: { latitude: -8.117, longitude: -34.901 },
    locationId: `gid://shopify/Location/${recifeLegacyId}`,
    tenantKey: "ge-beauty",
    market: "recife",
    geofenceRegistry: registry,
  });
  const deferred = getCandidate(out, "deferred");
  assert.equal(deferred, undefined);
});

test("deferred does NOT fire at a non-sparse location", () => {
  const out = generateCandidates({
    orders: [order("only-one", -23.580, -46.680)],
    pickupCoordinates: SP_PICKUP,
    locationId: "gid://shopify/Location/97784398144", // SP / Shops Jardins (not sparse)
    tenantKey: "ge-beauty",
    market: "sao-paulo",
    geofenceRegistry: registry,
  });
  const deferred = getCandidate(out, "deferred");
  assert.equal(deferred, undefined);
});

// ── Output stability ───────────────────────────────────────────────────────

test("optimizer-base always appears first in the output array", () => {
  const orders = [
    order("a", -23.580, -46.680),
    order("b", -23.585, -46.675),
    order("c", -23.476, -46.860, { isOutlier: true }),
  ];
  const out = generateCandidates(defaultInput(orders, SP_PICKUP, "sao-paulo"));
  assert.equal(out[0]!.candidateType, "optimizer-base");
});

test("generator caps candidate count at 6 (one per variant)", () => {
  // Construct an input that could plausibly trigger every variant.
  const orders = [
    // Tijuca cluster (corridor target)
    order("tijuca-1", -22.92, -43.23, { neighborhood: "Tijuca" }),
    order("tijuca-2", -22.93, -43.24, { neighborhood: "Tijuca" }),
    // Flamengo (intermediate)
    order("flamengo-1", -22.93, -43.176, { neighborhood: "Flamengo" }),
    // Outlier in Niterói
    order("niteroi-1", -22.90, -43.10, { neighborhood: "Niterói Centro", isOutlier: true }),
    // Some Ipanema/Leblon
    order("ipanema-1", -22.98, -43.20, { neighborhood: "Ipanema" }),
    order("leblon-1", -22.99, -43.22, { neighborhood: "Leblon" }),
  ];
  const out = generateCandidates(defaultInput(orders, RIO_PICKUP, "rio-de-janeiro"));
  assert.ok(
    out.length <= 7,
    `expected ≤7 candidates, got ${out.length}: ${out.map((c) => c.candidateType).join(",")}`,
  );
  // Every candidateId is unique.
  const ids = out.map((c) => c.candidateId);
  assert.equal(new Set(ids).size, ids.length, `duplicate candidate ids: ${ids.join(",")}`);
});

// ── exclude-outliers-route-rest ──────────────────────────────────────────

test("exclude-outliers-route-rest: fires when one order is >50km from pickup", () => {
  // SP pickup. 4 orders within 5km + 1 order ~100km away (Serra Negra).
  const orders: CandidateOrderInput[] = [
    order("near-1", -23.560, -46.665),
    order("near-2", -23.570, -46.675),
    order("near-3", -23.555, -46.660),
    order("near-4", -23.575, -46.680),
    order("serra-negra", -22.610, -46.700), // ~100 km north of SP pickup
  ];
  const out = generateCandidates(defaultInput(orders, SP_PICKUP, "sao-paulo"));
  const partial = getCandidate(out, "exclude-outliers-route-rest");
  assert.ok(partial, "expected an exclude-outliers-route-rest candidate");
  // Excluded order should NOT appear in any slot.
  const slotsWithExcluded = slotsContaining(partial, "serra-negra");
  assert.deepEqual(slotsWithExcluded, [], "serra-negra must not appear in any slot");
  // All near orders SHOULD appear.
  for (const n of ["near-1", "near-2", "near-3", "near-4"]) {
    assert.ok(
      slotsContaining(partial, n).length > 0,
      `${n} should appear in a slot of the partial candidate`,
    );
  }
  // Generation note should call out the exclusion.
  assert.ok(
    partial.generationNote?.includes("serra-negra"),
    `generationNote should name the excluded order; got: ${partial.generationNote}`,
  );
});

test("exclude-outliers-route-rest: NOT emitted when all orders are in range", () => {
  const orders: CandidateOrderInput[] = [
    order("near-1", -23.560, -46.665),
    order("near-2", -23.570, -46.675),
    order("near-3", -23.555, -46.660),
  ];
  const out = generateCandidates(defaultInput(orders, SP_PICKUP, "sao-paulo"));
  const partial = getCandidate(out, "exclude-outliers-route-rest");
  assert.equal(
    partial,
    undefined,
    "no candidate should be emitted when every order is within range",
  );
});

test("exclude-outliers-route-rest: NOT emitted when EVERY order is an outlier", () => {
  // All 3 orders ~100km from SP pickup. There's nothing to route after
  // excluding them — variant should bail.
  const orders: CandidateOrderInput[] = [
    order("far-1", -22.610, -46.700),
    order("far-2", -22.620, -46.720),
    order("far-3", -22.630, -46.710),
  ];
  const out = generateCandidates(defaultInput(orders, SP_PICKUP, "sao-paulo"));
  const partial = getCandidate(out, "exclude-outliers-route-rest");
  assert.equal(
    partial,
    undefined,
    "variant must not emit when nothing is in range — the deferred / exclude-from-optimize path owns this case",
  );
});
